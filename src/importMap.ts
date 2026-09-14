import type {ProjectDependency} from './runtime/projectFormat.ts'

const RUNTIME_SPECIFIERS = [
    'threepipe',
    'three',
    'uiconfig.js',
    'ts-browser-helpers',
    '@kite3d/engine',
] as const

export interface InstalledPluginImport {
    specifier: string
    entry: string
    rootUrl: string
}

/** Create one safe import map for both editor play mode and published games. */
export function dependencyImportMap(
    dependencies: ProjectDependency[],
    runtimeUrl = './_blitz/runtime.js',
    installedPlugins: InstalledPluginImport[] = [],
): {imports: Record<string, string>} {
    const extras = uniqueDependencies(dependencies).filter(isMappableDependency)
    const pluginSpecifiers = installedPlugins
        .map(({specifier}) => specifier)
        .filter((specifier) => !RUNTIME_SPECIFIERS.includes(specifier as typeof RUNTIME_SPECIFIERS[number]))
    const externals = [...new Set([...RUNTIME_SPECIFIERS, ...extras.map(({key}) => key), ...pluginSpecifiers])]
    const imports: Record<string, string> = Object.fromEntries(
        RUNTIME_SPECIFIERS.map((specifier) => [specifier, runtimeUrl]),
    )
    for (const dependency of extras) {
        const baseUrl = dependency.url || `https://esm.sh/${dependency.key}@${dependency.version}`
        const separator = baseUrl.includes('?') ? '&' : '?'
        imports[dependency.key] = `${baseUrl}${separator}external=${externals.join(',')}`
    }
    // Installed plugins map their bare name to the package entry and their trailing-slash name to the package root.
    for (const plugin of installedPlugins) {
        if (RUNTIME_SPECIFIERS.includes(plugin.specifier as typeof RUNTIME_SPECIFIERS[number])) continue
        const rootUrl = plugin.rootUrl.endsWith('/') ? plugin.rootUrl : `${plugin.rootUrl}/`
        imports[plugin.specifier] = `${rootUrl}${plugin.entry.replace(/^\.\//, '')}`
        imports[`${plugin.specifier}/`] = rootUrl
    }
    return {imports}
}

/** Return configured plugin names that are exact project dependency keys. */
export function projectPluginNames(packageJson: Record<string, unknown>): string[] {
    const dependencies = isRecord(packageJson.dependencies) ? packageJson.dependencies : {}
    const kite3d = isRecord(packageJson.kite3d) ? packageJson.kite3d : {}
    const plugins = Array.isArray(kite3d.plugins) ? kite3d.plugins : []
    const names = plugins.flatMap((plugin) => {
        const specifier = typeof plugin === 'string'
            ? plugin.replace(/\(.*\)$/, '').trim()
            : isRecord(plugin) && typeof plugin.import === 'string' ? plugin.import : ''
        const matches = Object.keys(dependencies)
            .filter((name) => specifier === name || specifier.startsWith(`${name}:`))
            .sort((left, right) => right.length - left.length)
        return matches.length ? [matches[0]] : []
    })
    return [...new Set(names)]
}

function uniqueDependencies(dependencies: ProjectDependency[]): ProjectDependency[] {
    const byKey = new Map<string, ProjectDependency>()
    for (const dependency of dependencies) {
        if (!byKey.has(dependency.key)) byKey.set(dependency.key, dependency)
    }
    return [...byKey.values()]
}

function isMappableDependency(dependency: ProjectDependency): boolean {
    if (RUNTIME_SPECIFIERS.includes(dependency.key as typeof RUNTIME_SPECIFIERS[number])) return false
    if (dependency.key.startsWith('@kite3d/')) return false
    return Boolean(dependency.url) || isSemverSpec(dependency.version)
}

function isSemverSpec(value: string): boolean {
    return /^(?:[~^]|[<>]=?)?v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value.trim())
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
