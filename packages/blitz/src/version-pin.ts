import {spawn} from 'node:child_process'
import {access, readFile} from 'node:fs/promises'
import {dirname, parse, resolve} from 'node:path'
import {BLITZ_VERSION} from './versions.ts'

export interface PinnedProject {
    root: string
    version: string
}

export async function findPinnedProject(start = process.cwd()): Promise<PinnedProject | undefined> {
    let directory = resolve(start)
    const filesystemRoot = parse(directory).root
    for (;;) {
        try {
            const manifest = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8')) as {
                devDependencies?: Record<string, unknown>
            }
            const version = manifest.devDependencies?.['@blitzdev/blitz']
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
    if (process.env.BLITZ_IGNORE_VERSION_PIN === '1') return undefined
    const project = await findPinnedProject(options.cwd)
    const commandVersion = options.commandVersion || BLITZ_VERSION
    if (!project || project.version === commandVersion) return undefined

    const localBin = resolve(project.root, 'node_modules/.bin/blitz')
    if (process.env.BLITZ_VERSION_DELEGATED !== '1' && await exists(localBin)) {
        console.error(`Blitz ${commandVersion} does not match project pin ${project.version}; delegating to ${localBin}`)
        return spawnAndWait(localBin, args, {
            ...process.env,
            BLITZ_VERSION_DELEGATED: '1',
            ...(command === 'upgrade' && !args.includes('--to') ? {BLITZ_UPGRADE_TO: commandVersion} : {}),
        })
    }

    throw new Error(`Project pins @blitzdev/blitz ${project.version}. Run npm install, or npx @blitzdev/blitz@${project.version} ${command}`)
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
