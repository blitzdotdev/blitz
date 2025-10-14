import {AViewerPlugin, AViewerPluginSync, Class, IViewerPlugin, ThreeViewer, UiObjectConfig} from "threepipe";

// import {TweakpaneEditorPlugin} from "../../../threepipe/plugins/tweakpane-editor/src";

export class SandboxPlugin extends AViewerPluginSync {
    public static readonly PluginType = 'SandboxPlugin'
    enabled = true

    constructor() {
        super()
        // for vite todo
        // if (import.meta.hot) {
        //     import.meta.hot.on('custom-tp-plugin-update', async(data: any) => {
        //         const base = import.meta.hot?.ownerPath.split('/').slice(0, -1).join('/') + '/'
        //         const path = this.plugins.has(data.id) ? data.id : data.url.replace(base, './')
        //         // console.log(base, import.meta.hot, path)
        //         if (this.plugins.has(path)) {
        //             await this.unloadPlugin(path)
        //             await this.loadPlugin(path)
        //             this.uiConfig.uiRefresh?.(true, 'postFrame')
        //         }
        //         // const path = data.path.split('')
        //     })
        // }
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)

        // const editor = viewer.addPluginSync(new TweakpaneEditorPlugin())
        // editor.loadPlugins(defaultModes)
    }

    plugins = new Map<string, Class<AViewerPlugin>>
    async loadPlugin(pathOrModule: string|SupPluginModule|Promise<SupPluginModule>, key = 'default', params?: any[]) {
        const viewer = this._viewer
        if (!viewer) throw new Error('Plugin not added to viewer.')
        if (typeof pathOrModule === 'object' && typeof (pathOrModule as Promise<SupPluginModule>).then === 'function') {
            pathOrModule = await pathOrModule
        }
        const path: string = typeof pathOrModule === 'string' ? pathOrModule : (pathOrModule as SupPluginModule).__tpPluginPath || ''
        if (path?.length && this.plugins.has(path)) throw new Error('Plugin already loaded: ' + path)
        const mod = typeof pathOrModule === 'object' ? pathOrModule : typeof path === 'string' && path ? await import(
            /* webpackIgnore: true */
            /* @vite-ignore */
        path + '?t=' + Date.now() // prevent caching during development
            ) : null
        if (!mod) throw new Error('Could not find/load module: ' + path)
        console.log(path)
        const plugin = mod[key] || Object.values(mod)[0] as Class<AViewerPlugin>
        if (!plugin)
            throw new Error('No plugin found in module: ' + path)
        if (typeof plugin !== 'function')
            throw new Error('Plugin is not a class or function in module: ' + pathOrModule)
        if (!(plugin.prototype && plugin.prototype instanceof AViewerPlugin))
            throw new Error('Plugin is not a subclass of AViewerPlugin in module: ' + pathOrModule)
        const pluginType = plugin.PluginType
        console.log(pluginType)
        console.log(mod)
        if (viewer.getPlugin(pluginType))
            throw new Error('Plugin of type ' + pluginType + ' already added to viewer')
        if (path?.length) this.plugins.set(path, plugin)
        const p = await viewer.addPlugin(plugin, ...params||[]) as IViewerPlugin
        return p
    }
    async unloadPlugin(path: string) {
        const viewer = this._viewer
        if (!viewer) throw new Error('Plugin not added to viewer.')
        const pluginC = this.plugins.get(path)
        if (!pluginC)
            throw new Error('Plugin not loaded: ' + path)
        const plugin = viewer.getPlugin(pluginC)
        if (!plugin)
            throw new Error('Plugin not found in viewer: ' + path)
        await viewer.removePlugin(plugin)
        this.plugins.delete(path)
        return true
    }

    private _path = './TestPlugin.ts'
    uiConfig: UiObjectConfig = {
        type: 'folder',
        label: 'Viewer Addons',
        expanded: true,
        children: [
            {
                type: 'input',
                label: 'Path',
                property: [this, '_path'],
            },
            {
                type: 'button',
                label: 'Load Plugin',
                value: async() => {
                    await this.loadPlugin(this._path)
                    this.uiConfig.uiRefresh?.(true, 'postFrame')
                },
            },
            {
                type: 'button',
                label: 'Unload Plugin',
                value: async() => {
                    await this.unloadPlugin(this._path)
                    this.uiConfig.uiRefresh?.(true, 'postFrame')
                },
            },
            {
                type: 'button',
                label: 'Refresh UI',
                value: async() => {
                    this.uiConfig.uiRefresh?.(true, 'postFrame')
                },
            },
            {
                type: 'folder',
                label: 'Loaded Plugins',
                expanded: true,
                children: [
                    ()=>{
                        return [...this.plugins.values()].map(v=>{
                            const p = this._viewer?.getPlugin(v)
                            return p?.uiConfig
                        })
                    },
                ],
            },
        ],
    }
}
export interface SupPluginModule{
    __tpPluginPath?: string
}
