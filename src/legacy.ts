import {access, readFile, readdir, rename, writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'

const LEGACY_DIRECTORY = '.blitz'
const KITE3D_DIRECTORY = '.kite3d'
const LEGACY_PACKAGE = '@blitzdev/blitz'
const KITE3D_PACKAGE = 'kite3d'
const LEGACY_SETTINGS_KEY = 'blitz'
const KITE3D_SETTINGS_KEY = 'kite3d'

export const LEGACY_PROJECT_MESSAGE = 'Legacy Blitz project detected. Run npx kite3d upgrade.'

export async function legacyProjectMigrationNeeded(projectRoot = process.cwd()): Promise<boolean> {
    const root = resolve(projectRoot)
    if (await exists(resolve(root, KITE3D_DIRECTORY))) return false
    if (await exists(resolve(root, LEGACY_DIRECTORY))) return true
    try {
        const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as Record<string, unknown>
        return Object.prototype.hasOwnProperty.call(manifest, LEGACY_SETTINGS_KEY)
    } catch (error) {
        if (error instanceof SyntaxError || isMissing(error)) return false
        throw error
    }
}

export async function migrateLegacyProject(projectRoot: string, targetVersion: string): Promise<string[]> {
    const root = resolve(projectRoot)
    const changes: string[] = []
    const legacyDirectory = resolve(root, LEGACY_DIRECTORY)
    const kite3dDirectory = resolve(root, KITE3D_DIRECTORY)
    if (await exists(legacyDirectory) && !await exists(kite3dDirectory)) {
        await rename(legacyDirectory, kite3dDirectory)
        changes.push('Renamed .blitz/ to .kite3d/.')
    }

    const packagePath = resolve(root, 'package.json')
    const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as Record<string, unknown>
    let packageChanged = false
    if (Object.prototype.hasOwnProperty.call(packageJson, LEGACY_SETTINGS_KEY)) {
        packageJson[KITE3D_SETTINGS_KEY] = {
            ...record(packageJson[LEGACY_SETTINGS_KEY]),
            ...record(packageJson[KITE3D_SETTINGS_KEY]),
        }
        delete packageJson[LEGACY_SETTINGS_KEY]
        packageChanged = true
        changes.push('Moved package.json key "blitz" to "kite3d".')
    }

    for (const section of ['dependencies', 'devDependencies'] as const) {
        const dependencies = record(packageJson[section])
        if (!Object.prototype.hasOwnProperty.call(dependencies, LEGACY_PACKAGE)) continue
        delete dependencies[LEGACY_PACKAGE]
        dependencies[KITE3D_PACKAGE] = targetVersion
        packageJson[section] = dependencies
        packageChanged = true
        changes.push(`Replaced ${LEGACY_PACKAGE} with ${KITE3D_PACKAGE} ${targetVersion} in ${section}.`)
    }
    if (packageChanged) await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8')

    for (const path of await gltfFiles(resolve(root, 'assets'))) {
        const text = await readFile(path, 'utf8')
        const document = JSON.parse(text) as unknown
        const count = rewriteLegacyRootPaths(document)
        if (!count) continue
        await writeFile(path, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
        changes.push(`Rewrote ${count} legacy rootPath value${count === 1 ? '' : 's'} in ${path.slice(root.length + 1)}.`)
    }
    return changes
}

async function gltfFiles(root: string): Promise<string[]> {
    const files: string[] = []
    const entries = await readdir(root, {withFileTypes: true}).catch((error: unknown) => {
        if (isMissing(error)) return []
        throw error
    })
    for (const entry of entries) {
        const path = resolve(root, entry.name)
        if (entry.isDirectory()) files.push(...await gltfFiles(path))
        else if (entry.isFile() && entry.name.toLowerCase().endsWith('.gltf')) files.push(path)
    }
    return files.sort()
}

function rewriteLegacyRootPaths(value: unknown): number {
    if (!value || typeof value !== 'object') return 0
    let count = 0
    for (const [key, child] of Object.entries(value)) {
        if (key === 'rootPath' && typeof child === 'string' && child.includes('/blitz/@')) {
            ;(value as Record<string, unknown>)[key] = child.replaceAll('/blitz/@', '/kite3d/@')
            count += 1
        } else {
            count += rewriteLegacyRootPaths(child)
        }
    }
    return count
}

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

async function exists(path: string): Promise<boolean> {
    try {
        await access(path)
        return true
    } catch (error) {
        if (isMissing(error)) return false
        throw error
    }
}

function isMissing(error: unknown): boolean {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
