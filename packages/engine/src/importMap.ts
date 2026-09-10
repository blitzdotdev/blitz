import type {ProjectDependency} from './runtime/projectFormat.ts'

const runtimeImports = ['threepipe', 'three', 'uiconfig.js', 'ts-browser-helpers']

/** Create import-map entries for dependencies declared by a project. */
export function dependencyImportMap(dependencies: ProjectDependency[]): {imports: Record<string, string>} {
    const imports: Record<string, string> = {}
    const externals = [...runtimeImports, ...dependencies.map(({key}) => key)]
    for (const dependency of dependencies) {
        imports[dependency.key] = dependency.url
            || `https://esm.sh/${dependency.key}@${dependency.version}?external=${externals.join(',')}`
    }
    return {imports}
}
