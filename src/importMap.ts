import type {ProjectDependency} from './runtime/projectFormat.ts'

export const RUNTIME_SPECIFIERS = [
    'threepipe',
    'three',
    'uiconfig.js',
    'ts-browser-helpers',
    '@blitzdev/engine',
] as const

/** Create one safe import map for both editor play mode and published games. */
export function dependencyImportMap(
    dependencies: ProjectDependency[],
    runtimeUrl = './_blitz/runtime.js',
): {imports: Record<string, string>} {
    const extras = uniqueDependencies(dependencies).filter(isMappableDependency)
    const externals = [...RUNTIME_SPECIFIERS, ...extras.map(({key}) => key)]
    const imports: Record<string, string> = Object.fromEntries(
        RUNTIME_SPECIFIERS.map((specifier) => [specifier, runtimeUrl]),
    )
    for (const dependency of extras) {
        const baseUrl = dependency.url || `https://esm.sh/${dependency.key}@${dependency.version}`
        const separator = baseUrl.includes('?') ? '&' : '?'
        imports[dependency.key] = `${baseUrl}${separator}external=${externals.join(',')}`
    }
    return {imports}
}

/** Read dependency declarations without exposing package-manager-only specs. */
export function projectDependencies(packageJson: Record<string, unknown>): ProjectDependency[] {
    const result: ProjectDependency[] = []
    const dependencies = packageJson.dependencies
    if (isRecord(dependencies)) {
        for (const [key, version] of Object.entries(dependencies)) {
            if (typeof version === 'string') result.push({key, version})
        }
    }
    const kite3d = packageJson.kite3d
    const imports = isRecord(kite3d) ? kite3d.imports : undefined
    if (isRecord(imports)) {
        for (const [key, value] of Object.entries(imports)) {
            if (typeof value !== 'string') continue
            result.push(value.startsWith('@')
                ? {key, version: value.slice(1)}
                : {key, version: '', url: value})
        }
    }
    return result
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
    if (dependency.key.startsWith('@blitzdev/')) return false
    return Boolean(dependency.url) || isSemverSpec(dependency.version)
}

function isSemverSpec(value: string): boolean {
    return /^(?:[~^]|[<>]=?)?v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value.trim())
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
