import {readFile, writeFile} from 'node:fs/promises'
import {basename, resolve} from 'node:path'
import {strToU8, zipSync} from 'fflate'
import {walkProject} from './filesystem.ts'
import {gitHead} from './git.ts'
import {NodeProjectDirectory} from './node-filesystem.ts'
import {publishExcludes} from './publish.ts'

const BLITZ_PACKAGES = ['blitz', 'editor', 'engine', 'template'] as const

export interface ArchiveResult {
    path: string
    files: string[]
}

export async function archiveProject(
    projectRoot = process.cwd(),
    options: {now?: Date} = {},
): Promise<ArchiveResult> {
    const root = resolve(projectRoot)
    const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as Record<string, unknown>
    const projectName = typeof packageJson.name === 'string' && packageJson.name.trim()
        ? packageJson.name.trim()
        : basename(root)
    const archiveName = `${safeArchiveName(projectName)}-source.zip`
    const archivePath = resolve(root, archiveName)
    const entries = (await walkProject(new NodeProjectDirectory(root).asHandle(), {
        exclude: publishExcludes(packageJson),
    })).filter(({path}) => path !== archiveName)
    const files: Record<string, Uint8Array> = {}
    for (const entry of entries) files[entry.path] = new Uint8Array(await entry.file.arrayBuffer())
    files['BLITZ-PROJECT.txt'] = strToU8(await provenance(root, projectName, options.now || new Date()))
    await writeFile(archivePath, zipSync(files, {level: 9}))
    return {path: archivePath, files: Object.keys(files).sort()}
}

async function provenance(root: string, projectName: string, now: Date): Promise<string> {
    const versions: string[] = []
    for (const name of BLITZ_PACKAGES) {
        let version = 'not installed'
        try {
            const manifest = JSON.parse(await readFile(
                resolve(root, `node_modules/@blitzdev/${name}/package.json`),
                'utf8',
            )) as {version?: unknown}
            if (typeof manifest.version === 'string' && manifest.version) version = manifest.version
        } catch { /* retain the explicit missing value */ }
        versions.push(`@blitzdev/${name}: ${version}`)
    }
    return [
        'Blitz project source archive',
        `Project: ${projectName}`,
        `Created: ${now.toISOString()}`,
        `Git commit: ${await gitHead(root) || 'unavailable'}`,
        ...versions,
        '',
    ].join('\n')
}

function safeArchiveName(name: string): string {
    return name.toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'blitz-project'
}
