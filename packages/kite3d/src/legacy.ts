import {constants} from 'node:fs'
import {access, readFile, readdir, rename, rm, writeFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {resolve} from 'node:path'

const LEGACY_DIRECTORY = '.blitz'
const KITE3D_DIRECTORY = '.kite3d'
const LEGACY_PACKAGE = '@blitzdev/blitz'
const KITE3D_PACKAGE = 'kite3d'
const LEGACY_PLUGIN_PACKAGE = '@blitzdev/plugin-mujoco'
const KITE3D_PLUGIN_PACKAGE = '@kite3d/plugin-mujoco'
const LEGACY_SETTINGS_KEY = 'blitz'
const KITE3D_SETTINGS_KEY = 'kite3d'
const LEGACY_NPM_SCOPE = '@blitzdev'
const LEGACY_TRANSITIVE_PACKAGES = ['engine', 'editor', 'template']
    .map((name) => `${LEGACY_NPM_SCOPE}/${name}`)

export const LEGACY_PROJECT_MESSAGE = 'Legacy Blitz project detected. Run npx kite3d upgrade.'
export const LEGACY_PLUGIN_MESSAGE = `Legacy plugin ${LEGACY_PLUGIN_PACKAGE} detected. Run npx kite3d upgrade to rename it to ${KITE3D_PLUGIN_PACKAGE}.`

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

export async function legacyPluginMigrationNeeded(projectRoot = process.cwd()): Promise<boolean> {
    try {
        const manifest = JSON.parse(await readFile(resolve(projectRoot, 'package.json'), 'utf8')) as Record<string, unknown>
        return hasLegacyPlugin(manifest)
    } catch (error) {
        if (error instanceof SyntaxError || isMissing(error)) return false
        throw error
    }
}

export async function migrateLegacyProject(projectRoot: string, targetVersion: string): Promise<string[]> {
    const root = resolve(projectRoot)
    const changes: string[] = []
    const mutations: MigrationMutation[] = []
    const legacyDirectory = resolve(root, LEGACY_DIRECTORY)
    const kite3dDirectory = resolve(root, KITE3D_DIRECTORY)
    if (await exists(legacyDirectory) && !await exists(kite3dDirectory)) {
        changes.push('Renamed .blitz/ to .kite3d/.')
        mutations.push({
            step: 'rename .blitz/ to .kite3d/',
            preflight: () => access(root, constants.W_OK),
            apply: () => rename(legacyDirectory, kite3dDirectory),
            rollback: async () => {
                if (!await exists(legacyDirectory) && await exists(kite3dDirectory)) {
                    await rename(kite3dDirectory, legacyDirectory)
                }
            },
        })
    }

    const packagePath = resolve(root, 'package.json')
    const packageText = await migrationStep('read package.json', () => readFile(packagePath, 'utf8'))
    const packageJson = await migrationStep('parse package.json', async () => (
        JSON.parse(packageText) as Record<string, unknown>
    ))
    const legacyDependency = ['dependencies', 'devDependencies'].some((section) => (
        Object.prototype.hasOwnProperty.call(record(packageJson[section]), LEGACY_PACKAGE)
    ))
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
    for (const section of ['dependencies', 'devDependencies'] as const) {
        const dependencies = record(packageJson[section])
        let sectionChanged = false
        if (Object.prototype.hasOwnProperty.call(dependencies, LEGACY_PLUGIN_PACKAGE)) {
            const specifier = dependencies[LEGACY_PLUGIN_PACKAGE]
            delete dependencies[LEGACY_PLUGIN_PACKAGE]
            if (!Object.prototype.hasOwnProperty.call(dependencies, KITE3D_PLUGIN_PACKAGE)) {
                dependencies[KITE3D_PLUGIN_PACKAGE] = specifier
            }
            changes.push(`Replaced ${LEGACY_PLUGIN_PACKAGE} with ${KITE3D_PLUGIN_PACKAGE} in ${section}.`)
            sectionChanged = true
        }
        for (const packageName of LEGACY_TRANSITIVE_PACKAGES) {
            const specifier = dependencies[packageName]
            if (typeof specifier !== 'string') continue
            delete dependencies[packageName]
            changes.push(`Removed ${packageName} from ${section}; kite3d provides ${targetVersion}.`)
            sectionChanged = true
        }
        if (!sectionChanged) continue
        packageJson[section] = dependencies
        packageChanged = true
    }
    const kite3dSettings = record(packageJson[KITE3D_SETTINGS_KEY])
    if (Array.isArray(kite3dSettings.plugins)) {
        let pluginChanged = false
        const plugins = kite3dSettings.plugins.map((plugin) => {
            const rewritten = rewriteLegacyPlugin(plugin)
            pluginChanged ||= rewritten !== plugin
            return rewritten
        })
        if (pluginChanged) {
            packageJson[KITE3D_SETTINGS_KEY] = {...kite3dSettings, plugins}
            packageChanged = true
            changes.push(`Replaced ${LEGACY_PLUGIN_PACKAGE} with ${KITE3D_PLUGIN_PACKAGE} in kite3d.plugins.`)
        }
    }
    if (packageChanged) {
        mutations.push(fileMutation(
            'update package.json',
            packagePath,
            packageText,
            `${JSON.stringify(packageJson, null, 2)}\n`,
        ))
    }

    const paths = await migrationStep('scan assets for glTF files', () => gltfFiles(resolve(root, 'assets')))
    for (const path of paths) {
        const relativePath = path.slice(root.length + 1)
        const step = `rewrite legacy root paths in ${relativePath}`
        const text = await migrationStep(step, () => readFile(path, 'utf8'))
        const document = await migrationStep(step, async () => JSON.parse(text) as unknown)
        const count = rewriteLegacyRootPaths(document)
        if (!count) continue
        mutations.push(fileMutation(step, path, text, `${JSON.stringify(document, null, 2)}\n`))
        changes.push(`Rewrote ${count} legacy rootPath value${count === 1 ? '' : 's'} in ${relativePath}.`)
    }

    for (const mutation of mutations) await migrationStep(mutation.step, mutation.preflight)
    const completed: MigrationMutation[] = []
    for (const mutation of mutations) {
        try {
            await mutation.apply()
            completed.push(mutation)
        } catch (error) {
            const rollbackErrors: string[] = []
            for (const applied of [mutation, ...[...completed].reverse()]) {
                try {
                    await applied.rollback()
                } catch (rollbackError) {
                    rollbackErrors.push(`${applied.step}: ${errorMessage(rollbackError)}`)
                }
            }
            const rollbackDetail = rollbackErrors.length ? `; rollback failed during ${rollbackErrors.join('; ')}` : ''
            throw new Error(`Legacy migration failed during ${mutation.step}: ${errorMessage(error)}${rollbackDetail}`)
        }
    }
    if (legacyDependency) {
        const packageLockPath = resolve(root, 'package-lock.json')
        if (await exists(packageLockPath)) {
            await migrationStep('remove package-lock.json', () => rm(packageLockPath))
            changes.push('Removed package-lock.json.')
        }
        const nodeModulesPath = resolve(root, 'node_modules')
        if (await exists(nodeModulesPath)) {
            await migrationStep('remove node_modules/', () => rm(nodeModulesPath, {recursive: true}))
            changes.push('Removed node_modules/.')
        }
    }
    return changes
}

export async function assertLegacyEngineIsHoisted(projectRoot: string): Promise<void> {
    const root = resolve(projectRoot)
    const topLevelManifest = resolve(root, 'node_modules/@kite3d/engine/package.json')
    const nestedLocation = 'node_modules/kite3d/node_modules/@kite3d/engine'
    try {
        await access(topLevelManifest)
        createRequire(resolve(root, 'package.json')).resolve('@kite3d/engine/package.json')
    } catch {
        const nestedManifest = resolve(root, nestedLocation, 'package.json')
        if (await exists(nestedManifest)) {
            throw new Error(
                `Legacy migration installed @kite3d/engine at ${nestedLocation} instead of the project root.`,
            )
        }
        throw new Error(
            `Legacy migration could not resolve @kite3d/engine from the project root; expected node_modules/@kite3d/engine, not ${nestedLocation}.`,
        )
    }
}

interface MigrationMutation {
    step: string
    preflight(): Promise<unknown>
    apply(): Promise<unknown>
    rollback(): Promise<unknown>
}

function fileMutation(
    step: string,
    path: string,
    original: string,
    replacement: string,
): MigrationMutation {
    return {
        step,
        preflight: () => access(path, constants.W_OK),
        apply: () => writeFile(path, replacement, 'utf8'),
        rollback: () => writeFile(path, original, 'utf8'),
    }
}

async function migrationStep<T>(step: string, action: () => Promise<T>): Promise<T> {
    try {
        return await action()
    } catch (error) {
        throw new Error(`Legacy migration failed during ${step}: ${errorMessage(error)}`)
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
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
            (value as Record<string, unknown>)[key] = child.replaceAll('/blitz/@', '/kite3d/@')
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

function rewriteLegacyPlugin(plugin: unknown): unknown {
    if (typeof plugin === 'string') return rewriteLegacyPluginSpecifier(plugin)
    if (!record(plugin).import || typeof record(plugin).import !== 'string') return plugin
    const rewritten = rewriteLegacyPluginSpecifier(record(plugin).import as string)
    return rewritten === record(plugin).import ? plugin : {...record(plugin), import: rewritten}
}

function rewriteLegacyPluginSpecifier(specifier: string): string {
    if (specifier === LEGACY_PLUGIN_PACKAGE
        || specifier.startsWith(`${LEGACY_PLUGIN_PACKAGE}:`)
        || specifier.startsWith(`${LEGACY_PLUGIN_PACKAGE}(`)) {
        return `${KITE3D_PLUGIN_PACKAGE}${specifier.slice(LEGACY_PLUGIN_PACKAGE.length)}`
    }
    return specifier
}

function hasLegacyPlugin(packageJson: Record<string, unknown>): boolean {
    if (['dependencies', 'devDependencies'].some((section) => (
        Object.prototype.hasOwnProperty.call(record(packageJson[section]), LEGACY_PLUGIN_PACKAGE)
    ))) return true
    const plugins = record(packageJson[KITE3D_SETTINGS_KEY]).plugins
    return Array.isArray(plugins) && plugins.some((plugin) => rewriteLegacyPlugin(plugin) !== plugin)
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
