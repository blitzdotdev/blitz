import {useManager} from "../utils/UseManager.ts";
import {useLoadingState} from "../../../uiconfig-blueprint/lib/esm/components/loadingState";
import {useProject} from "../utils/UseProject.ts";
import {ExternalPlugin, ExternalScript} from "../utils/project.ts";
import {showSuccessErrorToast} from "../utils/Toaster.tsx";
import {useListenProperty} from "./UseListenProperty.tsx";
import {FolderHeadCard} from "../../../uiconfig-blueprint/lib/esm/bpComponents/BPFolderComponent";
import {InsSectionItem} from "./InsSectionItem.tsx";
import React, {useState} from "react";
import {SelectFileRef} from "../utils/ViewerInstanceManager.ts";
import {generateUUID} from "../../../threepipe/lib";
import {RefSelectionObjectComponent} from "./RefSelectionObjectComponent.tsx";
import {Button, Icon, InputGroup} from "@blueprintjs/core";
import {addProjectScript} from "./AddProjectScript.tsx";
import {PackageDependency} from "../utils/importMaps.ts";

export function PluginsSectionComp(){
    const manager = useManager()
    const {settingsManager} = manager
    // const viewer = manager.get()
    // const picking = viewer?.getPlugin(PickingPlugin)
    // const availablePlugins = picking?.availablePlugins() || []
    const {loadingState, updateLoading} = useLoadingState()

    const {project} = useProject()
    const removeProjectPlugin = async (p: ExternalPlugin)=>{
        if(!project) return false
        // todo confirm dialog
        const res = await settingsManager.removeProjectPlugin(p).then(()=>({error: null})).catch(e=>{
            return {error: e?.message ?? 'Unknown error'}
        })
        const r = showSuccessErrorToast(res ? `Removed ${project.path}${p.import} successfully` : 'Unknown Error', 'Unable to remove plugin', res)
        return r
    }

    let extPlugins = useListenProperty(manager.scriptUtil, 'extPlugins', 'extPluginsChange', (v)=>([...v||[]]))

    extPlugins = extPlugins.sort((a, b)=>{
        const i1 = a.import.toLowerCase().replace(/^\@/, '')
        const i2 = b.import.toLowerCase()
        if(i1 < i2) return -1
        if(i1 > i2) return 1
        const c1 = a.className?.toLowerCase() || ''
        const c2 = b.className?.toLowerCase() || ''
        if(c1 < c2) return -1
        if(c1 > c2) return 1
        return 0
    })

    return <FolderHeadCard open={true} label={"Plugins"} minimal={true} level={0} onClick={()=>{}} icon={"stacked-chart"}>
        {/*todo listen to extPlugins change*/}
        {extPlugins?.map((c, i)=>{
            // const uiConfig: UiObjectConfig|undefined = c.uiConfig // todo use uiconfigmethods
            // return uiConfig && typeof uiConfig === 'object' && (<ConfigObject key={uiConfig.uuid ?? i} {...props} config={uiConfig} icon={"code"}/>)
            return <InsSectionItem
                key={i}
                text={c.className ? `${c.className}` : `${c.import}`}
                info={!!c.className ? {text: c.import, icon: "package"} : undefined}
                buttons={[{
                    key: 'remove', text: 'Remove Plugin', icon: "trash",
                    intent: "warning",
                    // disabled={!fileNeedsSave}
                    loading: loadingState['remove-plugin'],
                    onClick: () => updateLoading('remove-plugin', removeProjectPlugin(c))
                }]}
            />
        })}

        <AddPluginComp/>

    </FolderHeadCard>

}

export function AddPluginComp(){
    const [selectedPlugin, setSelectedPlugin] = useState<SelectFileRef|{name: string, uuid: string, def: ExternalPlugin}|null>(null)
    const manager = useManager()
    // const viewer = manager.get()
    // const picking = viewer?.getPlugin(PickingPlugin)
    // const availablePlugins = picking?.availablePlugins() || []
    const {loadingState, updateLoading} = useLoadingState()

    const {project} = useProject()
    const addProjectPlugin = async (path: string|ExternalPlugin)=>{
        if(!project) return false
        const path1 = typeof path === 'string' ? path : (path.import + (path.className ? `::${path.className}` : ''))
        const res = await manager.settingsManager.addProjectPlugin(typeof path === 'string' ? {import: './'+path} : path).then(()=>({error: null})).catch(e=>{
            return {error: e?.message ?? 'Unknown error'}
        })
        const r = showSuccessErrorToast(res ? `Loaded ${project.path}${path1} successfully` : 'Unknown Error', 'Unable to load plugin', res)
        return r
    }

    const extraPlugins = useListenProperty(manager.scriptUtil, 'extraViewerPlugins', 'extraPluginsChange', (v)=>({...v||{}}))
    // todo usememo?
    const extraItems = Object.values(extraPlugins)
        .filter(p=>!manager.get().getPlugin(p.exp.PluginType) && p.def && p.exp)
        .map(p=>({plugin: p.exp, name: p.exp.PluginType, def: p.def, uuid: generateUUID()}))
    // console.log(extraItems)

    return <RefSelectionObjectComponent
        label={"Add Plugin"}
        objectType={"plugin"}
        object={selectedPlugin}
        disabled={false} allowNone={true}
        extraItems={extraItems}
        onChange={(v)=>{
            setSelectedPlugin(v as SelectFileRef)
        }}
    >
        <Button variant={"minimal"} title={"Add Plugin"} icon={<Icon size={12} icon={"plus"}/>}
                disabled={!(selectedPlugin as SelectFileRef)?.entry?.path && !(selectedPlugin as any)?.def}
                loading={loadingState['addPlugin']}
            // onClick={() => updateLoading(onChange({value: null}))}
                onClick={()=>{
                    const path = (selectedPlugin as SelectFileRef)?.entry?.path
                    const def = (selectedPlugin as any)?.def as ExternalPlugin|undefined
                    if(!path && !def) return
                    // todo success, error toast
                    updateLoading('addPlugin', addProjectPlugin(path ?? def))
                }}
        ></Button>
    </RefSelectionObjectComponent>
}

export function ScriptsSectionComp(){
    const manager = useManager()
    // const viewer = manager.get()
    // const picking = viewer?.getPlugin(PickingPlugin)
    // const availablePlugins = picking?.availablePlugins() || []
    const {loadingState, updateLoading} = useLoadingState()

    const {project} = useProject()
    const removeProjectScript = async (p: ExternalScript)=>{
        if(!project) return false
        // todo confirm dialog
        const res = await manager.settingsManager.removeProjectScript(p).then(()=>({error: null})).catch(e=>{
            return {error: e?.message ?? 'Unknown error'}
        })
        const r = showSuccessErrorToast(res ? `Removed ${project.path}${p.import} successfully` : 'Unknown Error', 'Unable to remove plugin', res)
        return r
    }

    const extScripts = useListenProperty(manager.scriptUtil, 'extScripts', 'extScriptsChange', (v)=>([...v||[]]))

    return <FolderHeadCard open={true} label={"Scripts"} minimal={true} level={0} onClick={()=>{}} icon={"stacked-chart"}>
        {/*todo listen to extScripts change*/}
        {extScripts?.map((c, i)=>{
            return <InsSectionItem
                key={i}
                icon={"package"}
                text={`${c.import}`}
                buttons={[{
                    key: 'remove', text: 'Remove Script', icon: "trash",
                    intent: "warning",
                    // disabled={!fileNeedsSave}
                    loading: loadingState['remove-script'],
                    onClick: () => updateLoading('remove-script', removeProjectScript(c))
                }]}
            />
        })}

        <AddScriptComp/>

    </FolderHeadCard>

}

export function AddScriptComp(){
    const [selectedScript, setSelectedScript] = useState<SelectFileRef|null>(null)
    const manager = useManager()
    const {loadingState, updateLoading} = useLoadingState()

    const {project} = useProject()

    return <RefSelectionObjectComponent label={"Add Script"} objectType={"script"} object={selectedScript} disabled={false} allowNone={true} onChange={(v)=>{
        setSelectedScript(v as SelectFileRef)
    }}>
        <Button variant={"minimal"} title={"Add Script"} icon={<Icon size={12} icon={"plus"}/>}
                disabled={!selectedScript?.entry.path}
                loading={loadingState['addScript']}
            // onClick={() => updateLoading(onChange({value: null}))}
                onClick={()=>{
                    const path = selectedScript?.entry.path
                    if(!path) return
                    // todo success, error toast
                    updateLoading('addScript', addProjectScript(path, manager))
                }}
        ></Button>
    </RefSelectionObjectComponent>
}

export function DependenciesSectionComp(){
    const manager = useManager()
    const {loadingState, updateLoading} = useLoadingState()

    const {project} = useProject()
    const removeProjectDependency = async (p: PackageDependency)=>{
        if(!project) return false
        // todo confirm dialog
        const res = await manager.settingsManager.removeProjectDependency(p).then(()=>({error: null})).catch(e=>{
            return {error: e?.message ?? 'Unknown error'}
        })
        const r = showSuccessErrorToast(res ? `Removed ${p.key}@${p.version} from project, reload the page to clear it.` : 'Unknown Error', 'Unable to remove dependency', res)
        return r
    }

    const dependencies = manager.loadedProject?.settings?.config?.dependencies || []

    return <FolderHeadCard open={true} label={"Dependencies"} minimal={true} level={0} onClick={()=>{}} icon={"cube"}>
        {dependencies?.map((c: PackageDependency, i: number)=>{
            return <InsSectionItem
                key={i}
                icon={"package"}
                text={`${c.key}@${c.version}`}
                info={c.url ? {text: c.url, icon: "link"} : undefined}
                buttons={[{
                    key: 'remove', text: 'Remove Dependency', icon: "trash",
                    intent: "warning",
                    loading: loadingState['remove-dependency'],
                    onClick: () => updateLoading('remove-dependency', removeProjectDependency(c))
                }]}
            />
        })}

        <AddDependencyComp/>

    </FolderHeadCard>

}

export function AddDependencyComp(){
    const [packageKey, setPackageKey] = useState<string>('')
    const [packageVersion, setPackageVersion] = useState<string>('')
    const [packageUrl, setPackageUrl] = useState<string>('')
    const manager = useManager()
    const {loadingState, updateLoading} = useLoadingState()

    const {project} = useProject()
    const addProjectDependency = async (dep: PackageDependency)=>{
        if(!project) return false
        const res = await manager.settingsManager.addProjectDependency(dep).then(()=>({error: null})).catch(e=>{
            return {error: e?.message ?? 'Unknown error'}
        })
        const r = showSuccessErrorToast(res ? `Added ${dep.key}@${dep.version} successfully` : 'Unknown Error', 'Unable to add dependency', res)
        if(r){
            setPackageKey('')
            setPackageVersion('')
            setPackageUrl('')
        }
        return r
    }

    return <div style={{padding: '4px 8px', display: 'flex', flexDirection: 'column', gap: '4px'}}>
        <InputGroup
            placeholder="Package (e.g., three)"
            value={packageKey}
            onChange={(e) => setPackageKey(e.target.value)}
            fill
        />
        <InputGroup
            placeholder="Version (optional, e.g., 0.150.0)"
            value={packageVersion}
            onChange={(e) => setPackageVersion(e.target.value)}
            fill
        />
        <InputGroup
            placeholder="URL (optional, uses esm.sh by default)"
            value={packageUrl}
            onChange={(e) => setPackageUrl(e.target.value)}
            fill
        />
        <Button
            variant={"outlined"}
            text="Add Dependency"
            icon={<Icon size={12} icon={"plus"}/>}
            disabled={!packageKey.trim()}
            loading={loadingState['addDependency']}
            onClick={()=>{
                const dep: PackageDependency = {
                    key: packageKey.trim(),
                    version: packageVersion ? packageVersion.trim() : 'latest',
                    url: packageUrl.trim() || undefined
                }
                updateLoading('addDependency', addProjectDependency(dep))
            }}
        />
    </div>
}
