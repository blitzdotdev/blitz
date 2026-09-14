import {readFile, stat} from 'node:fs/promises'
import {resolve, sep} from 'node:path'
import type {InstalledPluginImport} from '@kite3d/engine/importMap'
import {projectPluginNames} from '@kite3d/engine/importMap'

export const DEVELOPMENT_PLUGIN_URL = '/kite3d/plugins/'

export interface InstalledPluginPackage extends InstalledPluginImport {
    version: string
    directory: string
}

export async function installedPluginPackages(
    projectRoot: string,
    packageJson: Record<string, unknown>,
    rootUrl: string,
): Promise<InstalledPluginPackage[]> {
    const packages: InstalledPluginPackage[] = []
    for (const specifier of projectPluginNames(packageJson)) {
        assertPackageName(specifier)
        const directory = resolve(projectRoot, 'node_modules', ...specifier.split('/'))
        const expectedRoot = resolve(projectRoot, 'node_modules')
        if (!directory.startsWith(`${expectedRoot}${sep}`)) throw new Error(`Invalid plugin package name: ${specifier}`)
        let manifest: Record<string, unknown>
        try {
            manifest = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8')) as Record<string, unknown>
        } catch (error) {
            if (isMissing(error)) throw new Error(`Plugin ${specifier} is not installed; run npm install.`)
            throw error
        }
        if (manifest.name !== specifier) {
            throw new Error(`Installed plugin ${specifier} has package name ${String(manifest.name)}.`)
        }
        const entry = packageEntry(manifest)
        try {
            if (!(await stat(resolve(directory, entry))).isFile()) {
                throw new Error(`Plugin package entry is not a file: ${entry}`)
            }
        } catch (error) {
            if (isMissing(error)) throw new Error(`Plugin package entry is missing: ${entry}`)
            throw error
        }
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

function packageEntry(manifest: Record<string, unknown>): string {
    const selected = exportTarget(manifest.exports)
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

function assertPackageName(specifier: string): void {
    const parts = specifier.split('/')
    const valid = parts.length === 1
        ? /^[A-Za-z0-9][A-Za-z0-9._~-]*$/.test(parts[0])
        : parts.length === 2
            && /^@[A-Za-z0-9][A-Za-z0-9._~-]*$/.test(parts[0])
            && /^[A-Za-z0-9][A-Za-z0-9._~-]*$/.test(parts[1])
    if (!valid) throw new Error(`Invalid plugin package name: ${specifier}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isMissing(error: unknown): boolean {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
