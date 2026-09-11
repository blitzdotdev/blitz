import {spawn} from 'node:child_process'
import {access, readFile} from 'node:fs/promises'
import {dirname, parse, resolve} from 'node:path'
import {KITE3D_VERSION} from './versions.ts'

export interface PinnedProject {
    root: string
    /** The dependency spec written in package.json. */
    version: string
}

const EXACT_VERSION = /^\d+\.\d+\.\d+$/

export async function findPinnedProject(start = process.cwd()): Promise<PinnedProject | undefined> {
    let directory = resolve(start)
    const filesystemRoot = parse(directory).root
    for (;;) {
        try {
            const manifest = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8')) as {
                devDependencies?: Record<string, unknown>
            }
            const version = manifest.devDependencies?.['kite3d']
            if (typeof version === 'string' && version) return {root: directory, version}
        } catch (error) {
            if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
        }
        if (directory === filesystemRoot) return undefined
        directory = dirname(directory)
    }
}

export async function enforceVersionPin(
    command: string,
    args: string[],
    options: {cwd?: string, commandVersion?: string} = {},
): Promise<number | undefined> {
    if (process.env.KITE3D_IGNORE_VERSION_PIN === '1') return undefined
    const project = await findPinnedProject(options.cwd)
    const commandVersion = options.commandVersion || KITE3D_VERSION
    if (!project) return undefined

    const resolvedVersion = await resolvePinnedVersion(project)
    if (!resolvedVersion) {
        throw new Error(`Project uses kite3d ${project.version}, but it is not installed. Run npm install before kite3d ${command}.`)
    }
    if (resolvedVersion === commandVersion) return undefined

    const localBin = resolve(project.root, 'node_modules/.bin/kite3d')
    if (process.env.KITE3D_VERSION_DELEGATED !== '1' && await exists(localBin)) {
        console.error(`Kite3D ${commandVersion} does not match project version ${resolvedVersion}; delegating to ${localBin}`)
        return spawnAndWait(localBin, args, {
            ...process.env,
            KITE3D_VERSION_DELEGATED: '1',
        })
    }

    if (!EXACT_VERSION.test(project.version)) {
        throw new Error(`Installed kite3d is ${resolvedVersion}, but this command is ${commandVersion}. Run npm install and use the project binary.`)
    }
    throw new Error(`Project pins kite3d ${project.version}. Run npm install, or npx kite3d@${project.version} ${command}`)
}

export async function resolvePinnedVersion(project: PinnedProject): Promise<string | undefined> {
    return EXACT_VERSION.test(project.version) ? project.version : readInstalledVersion(project.root)
}

async function readInstalledVersion(projectRoot: string): Promise<string | undefined> {
    try {
        const manifest = JSON.parse(await readFile(
            resolve(projectRoot, 'node_modules/kite3d/package.json'),
            'utf8',
        )) as {version?: unknown}
        return typeof manifest.version === 'string' && EXACT_VERSION.test(manifest.version)
            ? manifest.version
            : undefined
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
        throw error
    }
}

async function exists(path: string): Promise<boolean> {
    try { await access(path); return true } catch { return false }
}

function spawnAndWait(file: string, args: string[], env: NodeJS.ProcessEnv): Promise<number> {
    return new Promise((resolveExit, reject) => {
        const child = spawn(file, args, {cwd: process.cwd(), env, stdio: 'inherit'})
        child.once('error', reject)
        child.once('exit', (code, signal) => resolveExit(code ?? (signal ? 1 : 0)))
    })
}
