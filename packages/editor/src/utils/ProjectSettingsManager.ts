import {EventDispatcher} from "threepipe";
import {
    ExternalPlugin,
    ExternalScript,
    LoadedProject,
    ProjectConfigSettings,
    ProjectConfigSettingsJSON,
    settingsKey
} from "./project.ts";
import {comparePlugins} from "./ScriptUtil.ts";
import {ImportMapsManager, PackageDependency} from "./importMaps.ts";
import {parse} from "jsonc-parser";
import {ViewerInstanceManager} from "./ViewerInstanceManager.ts";
import {isPackageProject} from "./projectUtils.ts";

export class ProjectSettingsManager extends EventDispatcher<{}> {

    constructor(private manager: ViewerInstanceManager) {
        super();
    }

    async addProjectPlugin(plugin: ExternalPlugin) {
        const project = this.manager.loadedProject
        const settings = project?.settings?.config
        if (!settings) throw new Error('No project loaded, cannot add plugin')
        const existing = settings.plugins?.find(p => comparePlugins(p, plugin))
        if (existing) throw new Error('Plugin already exists in project settings')
        await this.setSettings({
            ...settings,
            plugins: [...settings.plugins || [], plugin]
        })
    }

    async removeProjectPlugin(plugin: ExternalPlugin) {
        const project = this.manager.loadedProject
        const settings = project?.settings?.config
        if (!settings) throw new Error('No project loaded, cannot remove plugin')
        const existing = settings.plugins?.find(p => comparePlugins(p, plugin))
        if (!existing) return
        await this.setSettings({
            ...settings,
            plugins: settings.plugins?.filter(p => p !== existing)
        })
    }

    async addProjectScript(script: ExternalScript, ignoreIfExists = false) {
        const project = this.manager.loadedProject
        const settings = project?.settings?.config
        if (!settings) throw new Error('No project loaded, cannot add script')
        const existing = settings.scripts?.find(p => p.import === script.import)
        if (existing) {
            if (!ignoreIfExists) throw new Error('Script already exists in project settings')
            return
        }
        await this.setSettings({
            ...settings,
            scripts: [...settings.scripts || [], script]
        })
    }

    async removeProjectScript(script: ExternalScript) {
        const project = this.manager.loadedProject
        const settings = project?.settings?.config
        if (!settings) throw new Error('No project loaded, cannot remove script')
        const existing = settings.scripts?.find(p => p.import === script.import)
        if (!existing) return
        await this.setSettings({
            ...settings,
            scripts: settings.scripts?.filter(p => p !== existing)
        })
    }


    async addProjectDependency(dependency: PackageDependency) {
        const project = this.manager.loadedProject
        const settings = project?.settings?.config
        if (!settings) throw new Error('No project loaded, cannot add dependency')
        const existing = settings.dependencies?.find(d => d.key === dependency.key)
        if (existing) throw new Error('Dependency already exists in project settings')
        await this.setSettings({
            ...settings,
            dependencies: [...settings.dependencies || [], dependency]
        })
        if (dependency.key.startsWith('@threepipe/'))
            await this.addProjectScript({import: dependency.key}, true)
    }

    async removeProjectDependency(dependency: PackageDependency) {
        const project = this.manager.loadedProject
        const settings = project?.settings?.config
        if (!settings) throw new Error('No project loaded, cannot remove dependency')
        const existing = settings.dependencies?.find(d => d.key === dependency.key)
        if (!existing) return
        await this.setSettings({
            ...settings,
            dependencies: settings.dependencies?.filter(d => d !== existing)
        })
        if (dependency.key.startsWith('@threepipe/'))
            await this.removeProjectScript({import: dependency.key})

    }


    async setSettings(settings: ProjectConfigSettings, save = true) {
        const project = this.manager.loadedProject
        if (!project?.settings || !project.handle) throw new Error('No project loaded, cannot set settings')
        if (!isPackageProject(project)) throw new Error('Not a package project, cannot set settings')
        const current = project.settings.config
        if (JSON.stringify(current) === JSON.stringify(settings)) return // no change

        project.settings.config = settings

        if (save) {
            // patches the latest file from disk
            const file = await this.setSettingsConfig(settings, project)
            const saved = await this.manager.fsHelper.writeFile(project.handle, project.file.name, file).catch(e => {
                console.error(e)
                return false
            })
            if (!saved) {
                throw new Error('Failed to save project settings file')
            }
        }

        await this.onProjectSettingsChange(settings, current)
    }

    async onProjectSettingsChange(settings: ProjectConfigSettings, lastSettings: ProjectConfigSettings | null) {
        const vprops1 = lastSettings?.viewer || {}
        const vprops2 = settings.viewer || {}
        const sortedJsonStringify = (key: any) => JSON.stringify(key, (_, v) =>
            v.constructor === Object ? Object.entries(v).sort() : v
        )
        if (sortedJsonStringify(vprops1) !== vprops2) {
            // todo change props/show toast to reload viewer
            // this.reset({...this.getProps(), ...vprops2})
        }
        const deps1 = lastSettings?.dependencies || []
        const deps2 = settings.dependencies || []
        const addedDeps = []
        const removedDeps = []
        const changedDeps = []

        for (const d of deps2) {
            const d1 = deps1.find(d1 => d1.key === d.key)
            if (!d1) {
                addedDeps.push(d)
            } else if (d1.version !== d.version || d1.url !== d.url) {
                changedDeps.push(d)
            }
        }
        for (const d of deps1) {
            if (!deps2.find(d2 => d2.key === d.key)) {
                removedDeps.push(d)
            }
        }
        if (addedDeps.length > 0 || removedDeps.length > 0 || changedDeps.length > 0) {
            if (removedDeps.length > 0) {
                // ImportMapsManager.removeDependency(...removedDeps.map(d=>d.key))
                // cant remove, add it back
                deps2.push(...removedDeps)
            }
            if (addedDeps.length > 0 || changedDeps.length > 0) {
                const imports = [...addedDeps, ...changedDeps]
                console.log('Registering Imports:', imports)
                ImportMapsManager.addDependency(...imports)
            }
            if (removedDeps.length || changedDeps.length) {
                // todo show toast to reload page/project
            }
            // todo notify import maps change
            // this.dispatchEvent({type: 'importMapsChange'})
        }

        await this.manager.scriptUtil.onProjectSettingsChange(settings, lastSettings)
    }


    private async setSettingsConfig(settings: ProjectConfigSettings, project: LoadedProject) {
        if (!project.handle) throw new Error('No handle to update project config')
        const handle = project.handle
        let packageFileHandle = await handle.getFileHandle(project.file.name).catch((e) => {
            // todo handle if there is dir with same name
            // if(e.name === "NotFoundError") return null
            // if(e.name === "TypeMismatchError") return true
            // console.error(e)
            return undefined
        })
        if (!packageFileHandle) throw new Error('No packageFileHandle to update project config')
        let packageJsonFile = await packageFileHandle.getFile()
        const text = await packageJsonFile.text()

        // let errors = []
        // const json = parse(text, errors, { allowTrailingComma: true })
        //
        // if (errors.length) {
        //     console.error('ThreeEditor - cannot parse JSONC', errors)
        //     throw new Error(`Cannot read ${project.file.name} file`)
        // }
        //
        // // Prepare edits, jsonc-parser gives minimal text edits preserving comments
        // const edits = jsonc.modify(
        //     text,                  // original JSONC text
        //     [settingsKey],         // JSON path (can be nested like ['compilerOptions', 'target'])
        //     settings,              // new value
        //     { formattingOptions: { insertSpaces: true, tabSize: 2 } }
        // )

        let json: Record<string, any> = {}
        try {
            json = parse(text) as any
        } catch (e) {
            console.error(`ThreeEditor - cannot read ${project.file.name} file`, e)
            throw new Error(`Cannot read ${project.file.name} file`)
        }
        const settings2 = {...settings} as ProjectConfigSettingsJSON
        // @ts-ignore todo make this proper config->json
        if (settings2.dependencies) delete settings2.dependencies
        settings2.imports = json[settingsKey]?.imports || {}
        json = {
            ...json,
            [settingsKey]: settings2
        }
        const newFile = new File(
            [JSON.stringify(json, null, 2)],
            project.file.name,
            {type: 'application/json', lastModified: Date.now()}
        )
        return newFile
    }

}
