import * as threepipe from "threepipe";
import {isDependencyModuleSpecifier, ProjectPackageJSON} from "@kite3d/engine/projectFormat";

// a project module after import: its exports, plus the plugin path it declares or the error that stopped it
export interface SupPluginModule extends Record<string, any>{
    __tpPluginPath?: string
    __tpModuleError?: any
}

/** Where the dev server serves a project file, at a revision that makes the import fresh. */
export type ProjectFileUrl = (path: string, revision: number) => string

// The editor's own modules, so the plugin list and the built-in components are the instances the
// edit viewer already runs. The import map points project scripts at these same modules.
const builtinModules: Record<string, SupPluginModule> = {threepipe}

export function isBuiltinModule(path: string){
    return Object.prototype.hasOwnProperty.call(builtinModules, path)
}

/**
 * Imports project modules. A specifier that names a declared dependency is left to the page's
 * import map, which the dev server injected; anything else is a project file the dev server serves,
 * with its own relative imports already rewritten to the sha each one resolves to.
 */
export async function loadModules(
    paths: string[],
    packageJson: ProjectPackageJSON,
    fileUrl: ProjectFileUrl,
    revision: number,
): Promise<SupPluginModule[]>{
    const modules: SupPluginModule[] = []
    for (const path of paths) {
        if (isBuiltinModule(path)) {
            modules.push(builtinModules[path])
            continue
        }
        const url = isDependencyModuleSpecifier(path, packageJson) ? path : fileUrl(path, revision)
        try {
            modules.push(await import(/* @vite-ignore */ url))
        } catch (error) {
            console.error('Error loading module:', path, error)
            modules.push({__tpModuleError: error})
        }
    }
    return modules
}
