import {Class, EntityComponentPlugin, IViewerPlugin, ThreeViewer, TObject3DComponent} from 'threepipe'

export type ScriptModule = Record<string, unknown>

export interface WalkedScriptExports {
    plugins: Array<{name: string, value: Class<IViewerPlugin>}>
    components: Array<{name: string, value: TObject3DComponent}>
}

export function walkScriptExports(module: ScriptModule): WalkedScriptExports {
    const plugins: WalkedScriptExports['plugins'] = []
    const components: WalkedScriptExports['components'] = []
    for (const [name, value] of Object.entries(module)) {
        if (isPluginType(value)) plugins.push({name, value})
        if (isComponentType(value)) components.push({name, value})
    }
    return {plugins, components}
}

/** Register every plugin and Object3D component exported by project modules. */
export async function registerScripts(viewer: ThreeViewer, modules: Iterable<ScriptModule>): Promise<WalkedScriptExports> {
    const found: WalkedScriptExports = {plugins: [], components: []}
    const entityComponents = viewer.getPlugin(EntityComponentPlugin)
    if (!entityComponents) throw new Error('EntityComponentPlugin must be added before project scripts')

    for (const module of modules) {
        const walked = walkScriptExports(module)
        for (const plugin of walked.plugins) {
            if (!viewer.getPlugin(plugin.value)) await viewer.addPlugin(plugin.value)
            found.plugins.push(plugin)
        }
        for (const component of walked.components) {
            if (!entityComponents.hasComponentType(component.value)) {
                await entityComponents.addComponentType(component.value)
            }
            found.components.push(component)
        }
    }
    return found
}

export function isPluginType(value: unknown): value is Class<IViewerPlugin> {
    return typeof value === 'function'
        && typeof (value as unknown as {PluginType?: unknown}).PluginType === 'string'
}

export function isComponentType(value: unknown): value is TObject3DComponent {
    return typeof value === 'function'
        && typeof (value as unknown as {ComponentType?: unknown}).ComponentType === 'string'
}
