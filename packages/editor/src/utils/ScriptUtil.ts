import {ExternalPlugin, ExternalScript, LoadedProject, ProjectConfigSettings} from "./project.ts";
import {Class, EntityComponentPlugin, EventDispatcher, IViewerPlugin, ThreeViewer, TObject3DComponent} from "threepipe";
import {isDependencyModuleSpecifier} from "@kite3d/engine/projectFormat";
import {isBuiltinModule, loadModules, ProjectFileUrl, SupPluginModule} from "./modules.ts";

export interface PluginRef{
    exp: (Class<IViewerPlugin> & IViewerPlugin['constructor'])
    def: ExternalPlugin
}

export interface ComponentRef{
    exp: /*(Class<Object3DComponent> & Object3DComponent['constructor'])*/ TObject3DComponent
    def: ExternalScript
}

export type ScriptModule ={
    plugins: PluginRef[],
    module: SupPluginModule|Promise<SupPluginModule>,
    path: string,
    components: ComponentRef[],
}

// todo this should be bound to a LoadedProject and clear stuff on dispose
export class ScriptUtil extends EventDispatcher<{
    extPluginsChange: {},
    extScriptsChange: {},
    extraPluginsChange: {},
}>{
    _v: ThreeViewer | null = null
    get viewer(){
        if(!this._v) throw new Error('Viewer not set in ScriptUtil')
        return this._v
    }
    set viewer(v: ThreeViewer){
        this._v = v
    }

    _p: LoadedProject | null = null
    get project(){
        if(!this._p) throw new Error('Loaded project file not set in ScriptUtil')
        return this._p
    }
    set project(p: LoadedProject){
        this._p = p
    }

    constructor() {
    super()
    }

    addedViewerPlugins: IViewerPlugin[] = []
    scriptModules: Map<string, ScriptModule> = new Map()
    addedComponents: ComponentRef['exp'][] = []
    extPlugins: ExternalPlugin[] = [] // todo make public readonly
    extScripts: ExternalScript[] = [] // todo make public readonly

    /** Where a project file is served. The manager binds it to the dev server. */
    fileUrl!: ProjectFileUrl

    // One counter for the page. Any module change re-imports every project module, so a project's
    // handful of scripts needs no dependency graph to know what to reload.
    revision = 0

    private loadModules(paths: string[]){
        return loadModules(paths, this.project.settings!.json, this.fileUrl, this.revision)
    }

    /** True when the dev server serves this module, so an edit to any file can change it. */
    private isProjectFile(path: string){
        return !isBuiltinModule(path) && !isDependencyModuleSpecifier(path, this.project.settings!.json)
    }

    async addPlugin(p: PluginRef){
        const v = this.viewer
        const pt = p.exp.PluginType
        if(!pt){
            console.error('Plugin does not have a PluginType static property', p.exp)
            return false
        }
        if(v.getPlugin(pt)){
            // plugin already added
            return false
        }
        // console.log('Adding plugin', pt, p.def.params || [])
        const plugin = await v.addPlugin(p.exp, ...p.def.params || [])
        this.addedViewerPlugins.push(plugin)
        // v.getPlugin(BlueprintJsUiPlugin2)?.setupPluginUi(plugin)
        return true
    }
    async removePlugin(p: PluginRef){
        const v = this.viewer
        const plugin = v.getPlugin(p.exp)
        if(plugin) {
            const i = this.addedViewerPlugins.indexOf(plugin)
            if(i >= 0) {
                this.addedViewerPlugins.splice(i, 1)
                // console.log('Removing plugin', p.exp)
                // v.getPlugin(BlueprintJsUiPlugin2)?.removePluginUi(plugin)
                await v.removePlugin(plugin)
            }else {
                // it could be a default plugin added by editor
            }
            return true
        }
        return false
    }

    async addComponent(p: ComponentRef){
        const v = this.viewer
        const pt = p.exp.ComponentType
        if(!pt){
            console.error('Component does not have a ComponentType static property', p.exp)
            return false
        }
        const plugin = v.getPlugin(EntityComponentPlugin)!
        if(plugin.hasComponentType(pt)){
            // plugin already added
            return false
        }
        console.log('Adding Component', pt)
        const res = await plugin.addComponentType(p.exp)
        if(res) this.addedComponents.push(p.exp)
        return true
    }
    async removeComponent(p: ComponentRef){
        const v = this.viewer
        const plugin = v.getPlugin(EntityComponentPlugin)!
        const exists = plugin.hasComponentType(p.exp.ComponentType)
        if(exists) {
            const i = this.addedComponents.indexOf(p.exp)
            if(i >= 0) {
                this.addedComponents.splice(i, 1)
                console.log('Removing component', p.exp.ComponentType)
                // v.getComponent(BlueprintJsUiComponent2)?.removeComponentUi(plugin)
                // await v.removeComponent(plugin)
                await plugin.removeComponentType(p.exp)
            }else {
                // it could be a default plugin added by editor
            }
            return true
        }
        return false
    }

    async scriptFilesChanged(paths: string[]|Set<string>){
        console.log('[Files Changed]', paths)
        if(![...paths].some(p=>/\.m?js$/i.test(p))) return
        // A project has a handful of scripts and any of them can import any other, so every project
        // module re-imports at the next revision instead of a dependency graph deciding which.
        const ps = [...this.scriptModules.keys()].filter(p=>this.isProjectFile(p))
        if(ps.length === 0) return
        this.revision++
        // this.pluginsLoading = true
        // unload modules
        const ps2 = []
        const mods = []
        // const modulePlugins = new Map<string, PluginRef[]>()
        for (const p of ps) {
            const mod = this.scriptModules.get(p)
            if(mod?.module) {
                await mod.module

                for (const plugin of [...mod.plugins]) {
                    await this.refRemovePlugin(mod.plugins, plugin, p);
                }
                for (const component of [...mod.components]) {
                    await this.refRemoveComponent(mod.components, component, p);
                }
                // modulePlugins.set(p, p2)
            }
            if(mod) {
                ps2.push(p)
                mods.push(mod)
            }
        }
        try {
            // load modules again
            const pms = this.loadModules(ps2)
            // modules1 = await loadModules(ps2)
            const pp = []
            for (let i = 0; i < ps2.length; i++){
                const path = ps2[i];
                const mod = mods[i]
                const pms2 = pms.then(p=>p[i])
                // The last module that worked, so a module that fails to import keeps it. Reading it
                // here and not inside the callback is what keeps the new promise from awaiting itself,
                // which used to wedge every later file change behind a script with a syntax error.
                const lastModule = mod.module
                // const plugins = modulePlugins.get(path) || []
                mod.module = pms2.then((module)=>{
                    if(module.__tpModuleError) return lastModule   // the error is shown to the user
                    mod.module = module
                    return module
                })

                // mod.plugins.push(...plugins)
                pp.push(mod.module.then(async ()=>{
                    await this.refLoadModule(mod)
                }))
            }
            await Promise.allSettled(pp)
        }catch (e) {
            console.error('Error reloading changed script modules: ', ps2, e)
            // this.pluginsLoading = false
            return
        }
        // this.pluginsLoading = false
    }

    async loadProjectPlugin(plugin: ExternalPlugin, refLoad = true){
        const path = plugin.import
        const existing = this.extPlugins.findIndex(e=>comparePlugins(e, plugin))
        const lastPlugin = existing >=0 ? this.extPlugins[existing] : null

        const mod = lastPlugin ? [...this.scriptModules.values()].find(m=>m.plugins.find(p=>p.def===lastPlugin)) : null
        if(mod && lastPlugin) {
            if(plugin.active === false){
                // this.pluginsLoading = true
                const ref = mod.plugins.find(p=>p.def === lastPlugin)
                if(ref) await this.refRemovePlugin(mod.plugins, ref, path);
                this._extPluginsRemove(existing)
                // this.pluginsLoading = false
            }
            return
        }
        if(plugin.active === false) {
            if(existing >= 0) {
                this._extPluginsRemove(existing)
            }
            return
        }
        if(existing >= 0) {
            // already loaded, cant update
        }else {
            this._extPluginsAdd(plugin)
            const module = await this.loadProjectScript(path, refLoad)
            if(refLoad && !this.scriptModules.get(path)?.plugins.some(r=>r.def===plugin)){
                console.warn('Unable to find/add plugin, probably a plugin with the same type already exists or the plugin belongs to a different file or package.', plugin)
            }
            return module
        }
    }

    async loadProjectScript(path: string, refLoad = true): Promise<ScriptModule>{
        // todo
        //  path can be local project path - ./src/file.js, src/file.js
        //  path can be package name - threepipe, @threepipe/plugin-xyz
        //  or an absolute url to a js file
        //  or an absolute url to a tgz file
        // this.pluginsLoading = true
        let mod: ScriptModule | undefined
        try {
            mod = this.scriptModules.get(path)
            if(mod) {
                // let module
                // if(typeof (mod.module as Promise<SupPluginModule>).then === 'function'){
                //     module = await mod.module
                // }else module = mod.module as SupPluginModule
                await mod.module

                // already loaded

            }else {
                console.log('Loading project script: ', path)
                mod = {
                    plugins: [],
                    components: [],
                    module: null as any,
                    path,
                }
                this.scriptModules.set(path, mod)
                mod.module = this.loadModules([path]).then(async ([module]) => {
                    if (!module) {
                        throw new Error('Failed to import module: ' + path)
                    }
                    if (mod) {
                        mod.module = module
                    }
                    return module
                })

                const module = await mod.module
            }
        }catch (e) {
            console.error('Error loading module: ', path, e)
            // this.pluginsLoading = false
            throw e
        }
        // this.pluginsLoading = false

        if(refLoad) await this.refLoadModule(mod)

        return mod
    }

    private async refRemovePlugin(refs: PluginRef[], plugin: PluginRef, path: string) {
        // remove plugin
        if (plugin) {
            const res = await this.removePlugin(plugin).catch(e => {
                console.error('Error unloading plugin: ', plugin, path, e)
                return false
            })
            if (res) {
                // if(refs.length === 1 && refs[0].def === lastPlugin)
                //     this.scriptModules.delete(path)
                // else {
                const i = refs.indexOf(plugin)
                if (i >= 0) refs.splice(i, 1)
                // }
            }else {
                console.error('Failed to unload plugin: ', path)
            }
        }
    }
    private async refRemoveComponent(refs: ComponentRef[], component: ComponentRef, path: string) {
        // remove component
        if (component) {
            const res = await this.removeComponent(component).catch(e => {
                console.error('Error unloading component: ', component, path)
                console.error(e)
                return false
            })
            if (res) {
                // if(refs.length === 1 && refs[0].def === lastComponent)
                //     this.scriptModules.delete(path)
                // else {
                const i = refs.indexOf(component)
                if (i >= 0) refs.splice(i, 1)
                // }
            }else {
                console.error('Failed to unload component: ', path)
            }
        }
    }

    // right now external scripts can only have components, anything else, add it here
    async loadProjectExtScript(component: ExternalScript, refLoad = true){
        const path = component.import
        const existing = this.extScripts.findIndex(e=>e.import === component.import)
        const lastScript = existing >=0 ? this.extScripts[existing] : null

        const mod = lastScript ? [...this.scriptModules.values()].find(m=>m.path === path) : null
        if(mod && lastScript) {
            if(component.active === false){
                // this.componentsLoading = true
                const refs = mod.components.filter(p=>p.def === lastScript)
                // if(ref) await this.refRemoveComponent(mod.components, ref, path);
                for (const ref of refs) {
                    await this.refRemoveComponent(mod.components, ref, path);
                }
                this._extScriptsRemove(existing)
                // this.componentsLoading = false
            }
            return
        }
        if(component.active === false) {
            if(existing >= 0) {
                this._extScriptsRemove(existing)
            }
            return
        }
        if(existing >= 0) {
            // already loaded, cant update
        }else {
            this._extScriptsAdd(component)
            const module = await this.loadProjectScript(path, refLoad)
            // if(refLoad && !this.scriptModules.get(path)?.components.some(r=>r.def===component)){
            //     console.warn('Unable to find/add component, probably a plugin with the same type already exists or the plugin belongs to a different file or package.', plugin)
            // }
            return module
        }
    }

    async loadProjectPlugins(plugins: ExternalPlugin[], refLoad = true){
        if(!plugins || plugins.length === 0) return []
        let modules = new Set<ScriptModule>()
        // todo parallel?
        for (const id of plugins) {
            const module = await this.loadProjectPlugin(id, false)
            if(module) modules.add(module)
        }
        if(refLoad){
            for (const module of modules) {
                await this.refLoadModule(module)
            }
        }
        return modules
    }
    async loadProjectExtScripts(components: ExternalScript[], refLoad = true){
        if(!components || components.length === 0) return []
        let modules = new Set<ScriptModule>()
        // todo parallel?
        for (const id of components) {
            const module = await this.loadProjectExtScript(id, false)
            if(module) modules.add(module)
        }
        if(refLoad){
            for (const module of modules) {
                await this.refLoadModule(module)
            }
        }
        return modules
    }

    _extPluginsAdd(p: ExternalPlugin){
        if(!this.extPlugins.includes(p)){
            this.extPlugins.push(p)
            this.dispatchEvent({type: 'extPluginsChange'})
        }
    }
    _extPluginsRemove(p: ExternalPlugin|number){
        const i = typeof p === 'number' ? p : this.extPlugins.indexOf(p)
        if(i >= 0 && i < this.extPlugins.length){
            this.extPlugins.splice(i, 1)
            this.dispatchEvent({type: 'extPluginsChange'})
        }
    }

    _extScriptsAdd(p: ExternalScript){
        if(!this.extScripts.includes(p)){
            this.extScripts.push(p)
            this.dispatchEvent({type: 'extScriptsChange'})
        }
    }
    _extScriptsRemove(p: ExternalScript|number){
        const i = typeof p === 'number' ? p : this.extScripts.indexOf(p)
        if(i >= 0 && i < this.extScripts.length){
            this.extScripts.splice(i, 1)
            this.dispatchEvent({type: 'extScriptsChange'})
        }
    }

    findExtPlugin(className: string|undefined, importPath: string){
        const ps = this.extPlugins.filter(p=>p.import === importPath)
        if(ps.length === 1){
            const p = ps[0]
            if(!p.className || p.className === className || className === 'default') return p
        }else if(ps.length > 1){
            const p = ps.find(p=>p.className === className || (!p.className && className === 'default'))
            if(p) return p
        }
        return null
    }

    findExtScript(importPath: string){
        const ps = this.extScripts.filter(p=>p.import === importPath)
        if(ps.length === 1){
            return ps[0]
        }
        if(ps.length > 1) {
            console.error('Multiple scripts with same import path found', ps)
        }else {
            console.warn('Script not found', importPath)
        }
        return null
    }

    extraViewerPlugins: Record<string, PluginRef> = {}
    private async refLoadModule(mod: ScriptModule){
        // this.pluginsLoading = true
        const {module, plugins, path, components} = mod
        const newRefs: PluginRef[] = []
        const newComp: ComponentRef[] = []
        console.warn('Load Module', mod)
        Object.entries(module).forEach(([key, exp])=>{
            if((exp as PluginRef['exp']).PluginType){
                const pluginCons = exp as PluginRef['exp']
                const e = this.findExtPlugin(key, path)
                if (e && !plugins.find(r => r.def === e) && !newRefs.find(r => r.def === e)) {
                    // if(this.extraViewerPlugins.includes(pluginCons)){
                    //     this.extraViewerPlugins = this.extraViewerPlugins.filter(p=>p!==pluginCons)
                    //     this.dispatchEvent({type: 'extraPluginsChange'})
                    // }
                    // console.log('new plugin', pluginCons.PluginType)
                    if(this.extraViewerPlugins[pluginCons.PluginType]?.def !== e) {
                        this.extraViewerPlugins[pluginCons.PluginType] = {
                            exp: pluginCons,
                            def: e,
                        }
                        this.dispatchEvent({type: 'extraPluginsChange'})
                    }
                    newRefs.push({
                        exp: pluginCons,
                        def: e,
                    })
                }else {
                    const ignored = ['AssetManager', 'AViewerPlugin']
                    // if(!ignored.includes(pluginCons.PluginType) && !this.extraViewerPlugins.includes(pluginCons)){
                    //     this.extraViewerPlugins.push(pluginCons)
                    //     this.dispatchEvent({type: 'extraPluginsChange'})
                    // }
                    if(!ignored.includes(pluginCons.PluginType) && this.extraViewerPlugins[pluginCons.PluginType]?.def !== e) {
                        // console.log('new plugin', pluginCons.PluginType)
                        this.extraViewerPlugins[pluginCons.PluginType] = {
                            exp: pluginCons,
                            def: {
                                import: path,
                                className: key,
                                params: [],
                            },
                        }
                        this.dispatchEvent({type: 'extraPluginsChange'})
                    }
                }
            }
            if((exp as ComponentRef['exp']).ComponentType){
                const componentCons = exp as ComponentRef['exp']
                const e = this.findExtScript(path)
                if(e && !components.find(r=>r.def === e) && !newComp.find(r=>r.def === e)) {
                    newComp.push({
                        exp: componentCons,
                        def: e,
                    })
                }
            }
        })
        plugins.push(...newRefs)
        components.push(...newComp)

        const pluginsPms = newRefs.map(async (p)=>{
            const res = await this.addPlugin(p).catch(e => {
                console.error('Error adding plugin to the viewer: ', p, path, e)
                return null
            })
            if (res) {
                // refs.push(p)
                // this.scriptModules.set(path, {module, plugins: [plugin]})
            } else {
                // todo failed to load
                // if(refs.length === 1 && refs[0] === p)
                //     this.scriptModules.delete(path)
                // else {
                const i = plugins.indexOf(p)
                if(i >= 0) plugins.splice(i, 1)
                // }
            }
            return res || false
        })

        const componentsPms = newComp.map(async (c)=>{
            const res = await this.addComponent(c).catch(e => {
                console.error('Error adding component to the viewer: ', c, path, e)
                return null
            })
            if (res) {
                // refs.push(p)
                // this.scriptModules.set(path, {module, plugins: [plugin]})
            } else {
                // todo failed to load
                // if(refs.length === 1 && refs[0] === p)
                //     this.scriptModules.delete(path)
                // else {
                const i = components.indexOf(c)
                if(i >= 0) components.splice(i, 1)
                // }
            }
            return res || false
        })

        const r = await Promise.allSettled([...pluginsPms, ...componentsPms])
        // this.pluginsLoading = false
        return r
    }


    // region changed files

    onObserveFileChange: ((path: string, project: LoadedProject)=>void) | null  = null

    changedFilesQ: string[] = []
    private _refreshingChangedFiles: Promise<void>|null = null
    async refreshChangedFilesQ(){
        if(this.changedFilesQ.length === 0) return
        const project = this._p
        if(!project?.handle || !project?.settings) return

        if(this._refreshingChangedFiles){
            await this._refreshingChangedFiles
        }

        const paths = new Set(this.changedFilesQ)
        this.changedFilesQ = []

        const pms = (async ()=>{
            // todo
            //  file could be
            //     package.json - done
            //     asset manifest
            //     current loaded scene/asset/file
            //     any loaded embedded assets
            //     loaded script file - done
            //     what else?

            for (const path of paths) {
                this.onObserveFileChange && this.onObserveFileChange(path, project)
            }

            await this.scriptFilesChanged(paths)
        })().catch(e=>{
            console.error('Error handling changed plugin scripts: ', paths, e)
        })
        this._refreshingChangedFiles = pms
        await this._refreshingChangedFiles
        if(this._refreshingChangedFiles === pms) this._refreshingChangedFiles = null
    }

    // endregion changed files
    scriptsRefreshing: Promise<any>|undefined

    async onProjectSettingsChange(settings: ProjectConfigSettings, lastSettings: ProjectConfigSettings|null){
        // todo if imports change, prompt to reload
        const plugins1 = lastSettings?.plugins || []
        const plugins2  = settings.plugins || []
        // const addedPlugins = []
        const removedPlugins = []

        // for (const p of plugins2) {
        //     if(!plugins1.find(p1=>comparePlugins(p1, p))){
        //         addedPlugins.push(p)
        //     }
        // }
        for (const p of plugins1) {
            if(!plugins2.find(p2=>comparePlugins(p2, p))){
                removedPlugins.push(p)
            }
        }

        const scripts1 = lastSettings?.scripts || []
        const scripts2  = settings.scripts || []
        // const addedScripts = []
        const removedScripts = []

        // for (const s of scripts2) {
        //     if(!scripts1.find(s1=>comparePlugins(s1, s))){
        //         addedScripts.push(s)
        //     }
        // }
        for (const s of scripts1) {
            if(!scripts2.find(s2=>s2.import === s.import)){
                removedScripts.push(s)
            }
        }

        // reloading all plugins, components (they wont be reloaded if not changed)
        const plugins = [...plugins2, ...removedPlugins.map(p=>({...p, active: false}))]
        const scripts = [...scripts2, ...removedScripts.map(p=>({...p, active: false}))]
        if(plugins.length > 0 || scripts.length > 0) {
            this.scriptsRefreshing = new Promise<void>(async (res)=>{
                const mods = await this.loadProjectPlugins(plugins, false)
                const mods2 = await this.loadProjectExtScripts(scripts, false)
                const modules = new Set([...mods, ...mods2])
                for (const module of modules) {
                    await this.refLoadModule(module)
                }
                res()
            })
            await this.scriptsRefreshing
            this.scriptsRefreshing = undefined
        }
    }


    // for this.loadedProject
    // async loadProjectPlugin2(plugin: ExternalPlugin){
    //     const path = plugin.import
    //
    //     const scriptModules = [...this.scriptModules.values()]
    //     const module0 = scriptModules.find(m=>m.plugins.find(p=>comparePlugins(p, plugin)))
    //     if(module0) {
    //         if(plugin.active === false){
    //             const lastPluginI = module0.plugins.findIndex(p=>comparePlugins(p, plugin))
    //             const lastPlugin = module0.plugins[lastPluginI]
    //             this.pluginsLoading = true
    //             // remove plugin
    //             const res = await this.removePlugin(lastPlugin).catch(e=>{
    //                 console.error('Error unloading module for plugin: ', path, e)
    //                 return false
    //             })
    //             if(res) {
    //                 if(module0.plugins.length === 1 || lastPluginI < 0)
    //                     this.scriptModules.delete(path)
    //                 else {
    //                     module0.plugins.splice(lastPluginI, 1)
    //                 }
    //             }
    //             this.pluginsLoading = false
    //         }else {
    //             // Plugin already loaded
    //         }
    //         return
    //     }
    //     if(plugin.active === false) {
    //         return
    //     }
    //     this.pluginsLoading = true
    //     try {
    //         const module1 = this.scriptModules.get(path)
    //         if(module1) {
    //             let mod
    //             if(typeof (module1.module as Promise<SupPluginModule>).then === 'function'){
    //                 mod = await module1.module
    //             }else mod = module1.module as SupPluginModule
    //             const res = await this.addPlugin(plugin, mod).catch(e=>{
    //                 console.error('Error loading module for plugin: ', path, e)
    //                 return null
    //             })
    //             if(res) {
    //                 // todo setup ui config
    //                 module1.plugins.push(plugin)
    //             }else {
    //                 // todo failed to load
    //             }
    //         }else {
    //             const pms = loadModule(path)
    //             const mod = {plugins: [plugin], module: pms as SupPluginModule|Promise<SupPluginModule>}
    //             this.scriptModules.set(path, mod)
    //             // todo test
    //             // const path1 = path.match(/^[a-z]+:\/\//) ? path : await this.fetchProjectAsset('asset://'+path)
    //             // const module: SupPluginModule = await import(/* @vite-ignore */ path1)
    //             const module = await pms
    //             if (!module) {
    //                 throw new Error('Failed to import plugin: ' + path)
    //             }
    //             mod.module = module
    //             const res = await this.addPlugin(plugin, module).catch(e => {
    //                 console.error('Error loading module for plugin: ', path, e)
    //                 return null
    //             })
    //             if (res) {
    //                 // this.scriptModules.set(path, {module, plugins: [plugin]})
    //             } else {
    //                 // todo failed to load
    //                 if(mod.plugins.length === 1 && mod.plugins[0] === plugin)
    //                    this.scriptModules.delete(path)
    //                 else {
    //                     const i = mod.plugins.indexOf(plugin)
    //                     if(i >= 0) mod.plugins.splice(i, 1)
    //                 }
    //             }
    //         }
    //     }catch (e) {
    //         console.error('Error loading plugin: ', path, e)
    //     }
    //     this.pluginsLoading = false
    // }

}

export function comparePlugins(a: ExternalPlugin, b: ExternalPlugin){
    if(a === b) return true
    if(a.import === b.import){
        if(a.className === b.className) return true
        if(!a.className || !b.className) return true
        return false
    }
    return false
}

