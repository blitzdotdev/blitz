import type {InstalledPluginImport} from '@blitzdev/engine/importMap'
import {projectPluginNames} from '@blitzdev/engine/importMap'
import type {ProjectEntry} from './types.ts'

export const DEVELOPMENT_PLUGIN_URL = '/kite3d/plugins/'
export const PUBLISHED_PLUGIN_PATH = '_blitz/plugins'

export interface InstalledPluginPackage extends InstalledPluginImport {
    version: string
    directory: FileSystemDirectoryHandle
}

export async function installedPluginPackages(
    dirHandle: FileSystemDirectoryHandle,
    packageJson: Record<string, unknown>,
    rootUrl: string,
): Promise<InstalledPluginPackage[]> {
    const packages: InstalledPluginPackage[] = []
    for (const specifier of projectPluginNames(packageJson)) {
        const directory = await packageDirectory(dirHandle, specifier)
        const packageFile = await directory.getFileHandle('package.json')
        const manifest = JSON.parse(await (await packageFile.getFile()).text()) as Record<string, unknown>
        if (manifest.name !== specifier) {
            throw new Error(`Installed plugin ${specifier} has package name ${String(manifest.name)}.`)
        }
        const entry = packageEntry(manifest)
        await fileAt(directory, entry)
        packages.push({
            specifier,
            entry,
            rootUrl: `${rootUrl.replace(/\/?$/, '/')}${specifier}/`,
            version: typeof manifest.version === 'string' ? manifest.version : '',
            directory,
        })
    }
    return packages
}

export async function installedPluginEntries(packages: InstalledPluginPackage[]): Promise<ProjectEntry[]> {
    const entries: ProjectEntry[] = []
    for (const plugin of packages) {
        await walkPackage(plugin.directory, `${PUBLISHED_PLUGIN_PATH}/${plugin.specifier}`, entries)
    }
    return entries.sort((left, right) => left.path.localeCompare(right.path))
}

function packageEntry(manifest: Record<string, unknown>): string {
    const exported = exportTarget(manifest.exports)
    const selected = exported
        || (typeof manifest.module === 'string' ? manifest.module : undefined)
        || (typeof manifest.main === 'string' ? manifest.main : undefined)
        || './index.js'
    const normalized = selected.replace(/^\.\//, '').replaceAll('\\', '/')
    if (!normalized || normalized.startsWith('/')
        || normalized.split('/').some((part) => !part || part === '.' || part === '..')) {
        throw new Error(`Plugin package entry is invalid: ${selected}`)
    }
    return normalized
}

function exportTarget(value: unknown): string | undefined {
    if (typeof value === 'string') return value
    if (Array.isArray(value)) {
        for (const candidate of value) {
            const target = exportTarget(candidate)
            if (target) return target
        }
        return undefined
    }
    if (!isRecord(value)) return undefined
    if (Object.prototype.hasOwnProperty.call(value, '.')) return exportTarget(value['.'])
    for (const condition of ['browser', 'import', 'default']) {
        const target = exportTarget(value[condition])
        if (target) return target
    }
    return undefined
}

async function packageDirectory(
    project: FileSystemDirectoryHandle,
    specifier: string,
): Promise<FileSystemDirectoryHandle> {
    const parts = packageNameParts(specifier)
    let directory: FileSystemDirectoryHandle
    try {
        directory = await project.getDirectoryHandle('node_modules')
        for (const part of parts) directory = await directory.getDirectoryHandle(part)
    } catch (error) {
        if (isNotFoundError(error)) throw new Error(`Plugin ${specifier} is not installed; run npm install.`)
        throw error
    }
    return directory
}

function packageNameParts(specifier: string): string[] {
    const parts = specifier.split('/')
    const valid = parts.length === 1
        ? /^[A-Za-z0-9][A-Za-z0-9._~-]*$/.test(parts[0])
        : parts.length === 2
            && /^@[A-Za-z0-9][A-Za-z0-9._~-]*$/.test(parts[0])
            && /^[A-Za-z0-9][A-Za-z0-9._~-]*$/.test(parts[1])
    if (!valid) throw new Error(`Invalid plugin package name: ${specifier}`)
    return parts
}

async function fileAt(directory: FileSystemDirectoryHandle, path: string): Promise<File> {
    const parts = path.split('/')
    let current = directory
    try {
        for (const part of parts.slice(0, -1)) current = await current.getDirectoryHandle(part)
        return await (await current.getFileHandle(parts.at(-1)!)).getFile()
    } catch (error) {
        if (isNotFoundError(error)) throw new Error(`Plugin package entry is missing: ${path}`)
        throw error
    }
}

async function walkPackage(
    directory: FileSystemDirectoryHandle,
    prefix: string,
    entries: ProjectEntry[],
): Promise<void> {
    for await (const handle of directory.values()) {
        if (handle.name === 'node_modules') continue
        const path = `${prefix}/${handle.name}`
        if (handle.kind === 'directory') await walkPackage(handle, path, entries)
        else entries.push({path, file: await handle.getFile()})
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isNotFoundError(error: unknown): boolean {
    return error instanceof DOMException
        ? error.name === 'NotFoundError'
        : error instanceof Error && error.name === 'NotFoundError'
}
