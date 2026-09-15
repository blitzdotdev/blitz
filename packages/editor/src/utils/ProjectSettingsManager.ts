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
import {ProjectDependency} from "@kite3d/engine/projectFormat";
import {ask} from "./AskDialog.tsx";
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


    // A @threepipe/ dependency is also a script, and both go in one write, because a dependency
    // change reloads the page and a second write would be lost.
    async addProjectDependency(dependency: ProjectDependency) {
        const project = this.manager.loadedProject
        const settings = project?.settings?.config
        if (!settings) throw new Error('No project loaded, cannot add dependency')
        const existing = settings.dependencies?.find(d => d.key === dependency.key)
        if (existing) throw new Error('Dependency already exists in project settings')
        const script = dependency.key.startsWith('@threepipe/')
            && !settings.scripts?.some(s => s.import === dependency.key)
            ? {import: dependency.key}
            : null
        await this.setSettings({
            ...settings,
            dependencies: [...settings.dependencies || [], dependency],
            ...(script ? {scripts: [...settings.scripts || [], script]} : {})
        })
    }

    async removeProjectDependency(dependency: ProjectDependency) {
        const project = this.manager.loadedProject
        const settings = project?.settings?.config
        if (!settings) throw new Error('No project loaded, cannot remove dependency')
        const existing = settings.dependencies?.find(d => d.key === dependency.key)
        if (!existing) return
        const scripts = dependency.key.startsWith('@threepipe/')
            ? settings.scripts?.filter(s => s.import !== dependency.key)
            : settings.scripts
        await this.setSettings({
            ...settings,
            dependencies: settings.dependencies?.filter(d => d !== existing),
            scripts
        })
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
        // The dev server injects the import map into the page, so a new dependency reaches the
        // project's scripts on the next load and only on the next load.
        if (lastSettings && (addedDeps.length || removedDeps.length || changedDeps.length)) {
            // Only a reload stops here; a user who keeps editing still gets the scripts and plugins.
            if (await this.reloadForDependencies()) return
        }

        await this.manager.scriptUtil.onProjectSettingsChange(settings, lastSettings)
    }


    /** True when the page is reloading, so the caller stops. */
    private async reloadForDependencies() {
        if (this.manager.loadedNeedsSave) {
            const reload = await ask('Dependencies changed', 'The editor reloads to pick up new dependencies. Unsaved changes are lost.', [
                {label: 'Keep editing', value: false},
                {label: 'Reload', value: true, intent: 'danger'},
            ])
            if (!reload) return false
        }
        location.reload()
        return true
    }

    /**
     * The scene the project opens with. It is a top level key of package.json, not part of the
     * kite3d settings, so it is written on its own.
     */
    async setMainScene(path: string) {
        const project = this.manager.loadedProject
        if (!project?.settings || !project.handle) throw new Error('No project loaded, cannot set the main scene')
        if (project.settings.mainScene === path) return

        const json = await this.readPackageJson(project)
        json.mainScene = path
        const saved = await this.manager.fsHelper.writeFile(project.handle, project.file.name, this.packageJsonFile(json, project))
        if (!saved) throw new Error('Failed to save project settings file')

        project.settings.mainScene = path
        project.settings.json.mainScene = path
    }

    // Always the copy on disk, so a write patches whatever an agent or another editor last left there.
    private async readPackageJson(project: LoadedProject): Promise<Record<string, any>> {
        if (!project.handle) throw new Error('No handle to update project config')
        const packageFileHandle = await project.handle.getFileHandle(project.file.name).catch(() => {
            // todo handle if there is dir with same name
            return undefined
        })
        if (!packageFileHandle) throw new Error('No packageFileHandle to update project config')
        const text = await (await packageFileHandle.getFile()).text()
        try {
            return parse(text) as Record<string, any>
        } catch (e) {
            console.error(`ThreeEditor - cannot read ${project.file.name} file`, e)
            throw new Error(`Cannot read ${project.file.name} file`)
        }
    }

    private packageJsonFile(json: Record<string, any>, project: LoadedProject) {
        return new File(
            [JSON.stringify(json, null, 2)],
            project.file.name,
            {type: 'application/json', lastModified: Date.now()}
        )
    }

    private async setSettingsConfig(settings: ProjectConfigSettings, project: LoadedProject) {
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

        const json = await this.readPackageJson(project)
        const settings2 = {...settings} as ProjectConfigSettingsJSON
        // @ts-ignore todo make this proper config->json
        if (settings2.dependencies) delete settings2.dependencies
        settings2.imports = json[settingsKey]?.imports || {}
        return this.packageJsonFile({...json, [settingsKey]: settings2}, project)
    }

}
