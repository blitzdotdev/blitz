import {useCallback, useEffect, useReducer, useRef, useState} from 'react';
import {isPackageProject, useManager, useProject, ViewerProps} from '../utils/ViewerInstanceManager.ts'
import {BlueprintJsUiPlugin2} from '../UiConfigRendererBlueprint2.tsx'
import {
    ConfigObjectGenerators,
    InspectorStackComponent,
    ThemeSettingsMenuComponent,
    UiConfigRendererContext,
    useConfigToStackItem,
} from 'uiconfig-blueprint/lib/esm/lib'
import {ImportResult, ThreeViewer, UiObjectConfig} from 'threepipe';
import {EditorModes, EditorModesButtonGroup, editorModesInspectorConfig, PlayModeButtonGroup} from './EditorModes.tsx'
import {Alignment, Button, Card, IconName, Navbar, Panel, PanelStack2, Popover} from '@blueprintjs/core'
import {BPHierarchyComponent, ObjectHierarchyComponent} from './BPHierarchyComponent.tsx'
import {SaveFileButton, SaveProjectButton, useFileNeedsSave} from './SaveFileButton.tsx'
import {InteractionControlsButtonGroup} from './InteractionControlsButtonGroup.tsx'
import {BPTextureFileComponent} from './BPTextureFileComponent.tsx'
import {BPMaterialsTreeComponent, MaterialHierarchyComponent} from "./BPMaterialsTreeComponent.tsx";
import {BPTexturesTreeComponent, TextureHierarchyComponent} from "./BPTexturesTreeComponent.tsx";
import {GeometryHierarchyComponent} from "./BPGeometriesTreeComponent.tsx";
import {FilesPanel} from "./FilesPanel.tsx";
import {
    InspectorPanelComponent,
    InspectorPanelProps,
    InsSectionItem,
    InsSectionTitle
} from "./InspectorPanelComponent.tsx";
import {iconForSelectionObject} from "./RefSelectionObjectComponent.tsx";
import {MaybeElement} from "@blueprintjs/core/src/common/props";
import {WindowPanesLayout} from "./WindowPanesLayout.tsx";
import {assetUrlPrefix} from "../utils/project.ts";
import {BPTreeFolderComponent} from "./BPTreeFolderComponent.tsx";

ConfigObjectGenerators.image = BPTextureFileComponent

const editorLeftTabs = {
    objects: ObjectHierarchyComponent,
    materials: MaterialHierarchyComponent,
    textures: TextureHierarchyComponent,
    geometries: GeometryHierarchyComponent,
}
ConfigObjectGenerators.hierarchy = BPHierarchyComponent
ConfigObjectGenerators.materials = BPMaterialsTreeComponent
ConfigObjectGenerators.textures = BPTexturesTreeComponent
ConfigObjectGenerators.tree = BPTreeFolderComponent

export function ThreeEditorComponent(props: Partial<ViewerProps>) {
    const [viewer, setViewer] = useState<ThreeViewer | null>(null)
    // const uiConfigRenderer = viewer.getPlugin(BlueprintJsUiPlugin2)!
    const [uiConfigRenderer, setUiConfigRenderer] = useState<BlueprintJsUiPlugin2 | null>(null)
    const manager = useManager()
    const { project} = useProject()

    // const [splitSizes, setSplitSizes] = useState([0, 100, 0])

    const [insConfig, setInsConfig] = useState<UiObjectConfig<any, 'panel'>>(editorModesInspectorConfig['import'](viewer))
    // const [hierarchyConfig, setHierarchyConfig] = useState<UiObjectConfig<any, 'hierarchy'>>({type: 'hierarchy'})
    // const [materialsLib, setMaterialsLib] = useState<UiObjectConfig<any, 'materials'>>({type: 'materials'})
    // const [texturesLib, setTexturesLib] = useState<UiObjectConfig<any, 'textures'>>({type: 'textures'})
    // const [geometriesLib, setGeometriesLib] = useState<UiObjectConfig<any, 'geometries'>>({type: 'geometries'})
    // const [modelRoot, setModelRoot] = useState<IObject3D|null>(null)

    const [isPlaying, setIsPlaying1] = useState(manager.isRunningMode)

    const setIsPlaying = useCallback(async (val: boolean)=>{
        if(val === manager.isRunningMode) setIsPlaying1(val)
        else {
            if(val){
                await manager.startRunMode().catch(e=>{
                    console.error('Could not start run mode:', e) // todo show toast
                    return false
                })
            }else {
                await manager.stopRunMode().catch(e=>{
                    console.error('Could not stop run mode:', e) // todo show toast
                    return false
                })
            }
            setIsPlaying1(manager.isRunningMode)
        }
    }, [manager])

    // todo on playing change
    //  set picking enabled
    //  set playing in viewer
    //  disable save button
    //  disable loading another file
    //  when playing stopped, reload scene
    //  dont track object/material updates when playing

    // todo rename to settings mode
    const [editorMode, setEditorMode] = useReducer((currentMode: EditorModes, mode: EditorModes): EditorModes=>{
        const conf = editorModesInspectorConfig[mode](viewer)
        setInsConfig(conf)
        if(mode === currentMode) return mode
        manager.features.refresh(mode)
        return mode
    }, 'import')

    useEffect(() => {
        // const v = manager.reset(props)
        let v
        let pms
        if (project && isPackageProject(project)){
            // v = manager.loadProject(project, props) ?? manager.reset(props)
            v = manager.get()
            // todo load default scene settings first like empty env etc
            // pms = projectFile ? manager.loadProjectFile(project, projectFile) : null
        } else {
            v = manager.reset(props)
            // file should only be files saved from this editor with scene settings.
            pms = project?.file ? v.load(project.file, {}) : null
        }
        setViewer(v)

        pms?.then((res)=>{
            console.log(res)
            console.log('Loaded file/scene')
        })

        const p = v.getPlugin(BlueprintJsUiPlugin2)!
        setUiConfigRenderer(p)
        setInsConfig(editorModesInspectorConfig[editorMode](v))
        // setHierarchyConfig({type: 'hierarchy',
        //     uuid: Math.random().toString(36).substring(2, 15),
        //     value: v.scene.modelRoot
        // })
        // setMaterialsLib({type: 'materials',
        //     uuid: Math.random().toString(36).substring(2, 15),
        //     value: v.scene.modelRoot
        // })
        // setTexturesLib({type: 'textures',
        //     uuid: Math.random().toString(36).substring(2, 15),
        //     value: v.scene.modelRoot
        // })
        // setGeometriesLib({type: 'geometries',
        //     uuid: Math.random().toString(36).substring(2, 15),
        //     value: v.scene.modelRoot
        // })
        // setModelRoot(v.scene.modelRoot)
        manager.features.refresh(editorMode)
        return () => {
            // setViewer(null)
            // setUiConfigRenderer(null)
            // setModelRoot(null)
            // setProjectMeta(undefined)
            // manager.loadProject(null)
            // manager.loadProject(null)
            // manager.loadScene(null) // todo
        }
    }, [manager, ...Object.values(props), project?.file])

    // useEffect(() => {
    //     manager.features.refresh(editorMode)
    // }, []);

    const canvasContainer = useRef<HTMLDivElement>(null)
    // add viewer.container to canvasContainer when it changes
    useEffect(() => {
        if(canvasContainer.current && viewer && viewer.container.parentElement !== canvasContainer.current){
            canvasContainer.current.innerHTML = ''
            canvasContainer.current.appendChild(viewer.container)
            viewer.resize()
        }
    }, [canvasContainer.current, viewer])

    return !uiConfigRenderer || !viewer ? null : (
        <UiConfigRendererContext.Provider value={uiConfigRenderer}>
            <div
                 // style={{backgroundColor: Colors.DARK_GRAY2, height: "100vh"}}>
                 style={{
                     height: "100vh",
                     display: "flex",
                    flexDirection: "column",
                    gap: 0,
                 }}
            >
                <Navbar key={project?.path ?? 'navbar'}>
                    <Navbar.Group align={Alignment.START}>
                        <Navbar.Heading>3D Editor</Navbar.Heading>
                        <Navbar.Divider/>
                        {/*<H5 style={{margin: "0"}}>{project}</H5>*/}
                        {/*<H6 style={{margin: "0"}}>{scene}</H6>*/}
                        <NavProjectFileName/>
                        {/*<Button variant={"minimal"} size={"small"} icon="home" text="Home"/>*/}
                        {/*<Button variant={"minimal"} size={"small"} icon="document" text="Files"/>*/}
                        <Navbar.Divider/>
                    </Navbar.Group>
                    <Navbar.Group align={Alignment.START}>
                        {isPackageProject(project) ? <SaveProjectButton/> : <SaveFileButton /> }
                    </Navbar.Group>
                    <Navbar.Group align={Alignment.END}>
                        <PlayModeButtonGroup key="playmode" {...{isPlaying, setIsPlaying}} />
                        <Navbar.Divider/>
                        <Popover targetProps={{style: {}}}
                                 minimal
                                 targetTagName={"div"}
                                 content={
                                     <ThemeSettingsMenuComponent/>
                                 } placement="bottom">
                            <Button icon="cog" size={"small"} variant={"minimal"} text=""/>
                        </Popover>
                    </Navbar.Group>
                </Navbar>

                <WindowPanesLayout
                    key={viewer.scene.uuid} // force rerender when viewer change, because we might add events to the viewer in sub components like BPHierarchyComponent
                    panels={{
                        left:
                            Object.entries(editorLeftTabs).map(([k, TabPanel])=>({
                                title: k,
                                key: k,
                                content: <TabPanel key={k} className={''}/>,
                                className: 'hierarchy-stack'
                            })),
                        center: [{title: 'Content', style: {
                            position: "relative",
                            display: "flex",
                            flexDirection: "row",
                        }, content: <>
                                <div className={"editorCanvasContainer"} key={"editorCanvasContainer"} ref={canvasContainer}></div>
                                {!isPlaying && <InteractionControlsButtonGroup key="interaction-controls" /> }
                            </>}],
                        bottom: [{title: 'Files', content: <FilesPanel />}],
                        right: [
                            {
                                title: 'Inspector',
                                style: {
                                    position: "relative",
                                    display: "flex",
                                    flexDirection: "row",
                                },
                                content: <EditInspectorComponent
                                        className={'inspector-stack'}
                                    />
                            },
                            {
                                title: 'Settings',
                                style: {
                                    position: "relative",
                                    display: "flex",
                                    flexDirection: "column",
                                },
                                content: <>
                                    <EditorModesButtonGroup key="modes" {...{editorMode, setEditorMode}} />
                                    <ModesInspector config={insConfig} className={'inspector-stack'}/>
                                </>
                            },
                            {
                                title: 'Memory',
                                style: {
                                    position: "relative",
                                    display: "flex",
                                    flexDirection: "column",
                                },
                                content: <MemoryTab/>
                            },
                        ],
                    }}
                />
            </div>
        </UiConfigRendererContext.Provider>
    );

}

export function MemoryTab({
    className,
}:{
    className?: string
}){
    const manager = useManager()
    const tracker = manager.get().assetManager.tracker

    // todo move all assetRegistry stuff to one manager
    // const assets = manager.get().assetManager.assetRegistry
    const [assetList, setAssetList] = useState({...tracker.registry})
    useEffect(()=>{
        const onAsset = ()=>{
            setAssetList({...tracker.registry})
        }
        tracker.addEventListener('registryChanged', onAsset)
        return ()=>{
            tracker.removeEventListener('registryChanged', onAsset)
        }
    }, [tracker])

    return <Card className={"bpInspectorCard " + className||''} style={{borderRadius: 0}}>

        <InsSectionTitle title={"Asset Registry"}/>
        {Object.entries(assetList).map(([path, asset])=>
            <AssetRegistryItem key={path} path={path} asset={asset}/>
        )}
        {Object.keys(assetList).length === 0 &&
            <InsSectionItem
                text={'No assets loaded'}
                icon={'info-sign'}
            />
        }

    </Card>
}

export function AssetRegistryItem({
    path,
    asset,
}:{
    path: string
    asset: {
        pms: Promise<ImportResult|undefined>
    }
}){
    const [assetData, setAssetData] = useState<any>(null)
    const manager = useManager()
    useEffect(()=>{
        let mounted = true
        asset.pms.then((res)=>{
            if(mounted) setAssetData(res)
        })
        return ()=>{
            mounted = false
        }
    })
    const path2 = path.startsWith(assetUrlPrefix) ? path.slice(assetUrlPrefix.length) : path
    // return <div> {path} {assetData?.uuid || ''} </div>
    return <InsSectionItem
        text={path2.split('/').pop() || path2}
        icon={iconForSelectionObject(assetData) || 'circle'}
        info={{text: path2, icon: 'link'}}
        buttons={[{
            text: 'Unload Asset',
            key: 'unload',
            icon: 'trash',
            intent: 'warning',
            onClick: async ()=>{
                manager.unloadAsset(asset)
            }
        }]}
    />
    // return <RefSelectionObjectComponent object={assetData} disabled={true} allowNone={false}
    //                                     canSelect={true}
    //                                     />
}

// function getStackItem(){
//     console.log('mount create stack')
//     return
// }
const stackItems = [{
    props: {},
    renderPanel: InspectorPanelComponent,
    title: ''
} as Panel<InspectorPanelProps>]
export function EditInspectorComponent({className}: {
    className?: string
}) {
    // const {selectedInspectorItems, selectedFiles} = useAssets()
    const [currentPanelStack, setCurrentPanelStack] = useState<Array<Panel<InspectorPanelProps>>>(stackItems);

    // const isMultiple = selectedFiles.length > 1 || (!selectedFiles.length && selectedInspectorItems.length > 1)
    // const canRenderInspector = selectedInspectorItems.length || selectedFiles.length

    // console.log('mountrender EditInspectorComponent')

    return (
        <Card className={"bpInspectorCard " + className||''} style={{borderRadius: 0}}>
            {/*<div >Inspector</div>*/}
            {/*<div style={{width: "100%"}}>{selectedInspectorItems.object?.name || "Unnamed"}</div>*/}
            {/*{isMultiple ? <div>*/}
            {/*        <div style={{width: "100%"}} className={Classes.PANEL_STACK2_HEADER}>*/}
            {/*            /!* two <span> tags here ensure title is centered as long as possible, with `flex: 1` styling *!/*/}
            {/*            <span>{null}</span>*/}
            {/*            <Text className={Classes.HEADING} ellipsize={true} title={"Inspector"}>*/}
            {/*                Inspector*/}
            {/*            </Text>*/}
            {/*            <span />*/}
            {/*        </div>*/}

            {/*        {selectedFiles.length ? selectedFiles.map(f=><div key={f.path}>{f.name}</div>) :*/}
            {/*        selectedInspectorItems.map((item, i)=><div key={i}>{item?.name || 'Unnamed'}</div>)}*/}
            {/*</div> :*/}
            <PanelStack2
                className="inspectorPanelStack"
                key="inspectorPanelStack"
                         showPanelHeader={true}
                         renderActivePanelOnly={false}
                         onOpen={(p) => setCurrentPanelStack([...currentPanelStack, p] as any)}
                         onClose={() => setCurrentPanelStack(currentPanelStack.slice(0, -1))}
                         stack={currentPanelStack}/>
            {/*}*/}
        </Card>
    )
}

export function ModesInspector({config, className}:{
    config: UiObjectConfig<any, 'panel'>
    className?: string
}){
    const insStackPanel = useConfigToStackItem(config)
    return <InspectorStackComponent
        className={className}
        stackItem={insStackPanel}/>
    // const config2 = useMemo(()=>{
    //     return {
    //         ...config,
    //         type: 'folder',
    //     }
    // }, [config])
    // return <ConfigObject config={config2} className={className} openPanel={()=>{}} closePanel={()=>{}}/>
}
export function NavProjectFileName(){
    const { project} = useProject()
    const manager = useManager()

    const projectIcon: IconName = project && isPackageProject(project) ? 'folder-close' : 'cubes'
    const fileIcon: IconName|MaybeElement = !!manager.loadedScene ? 'cubes' : !!manager.loadedAssetObj ? iconForSelectionObject(manager.loadedAssetObj) : 'document'

    const [fileNeedsSave] = useFileNeedsSave()
    if(!project) return null
    return <>
        {project && <Button variant={"minimal"} size={"small"} icon={projectIcon} text={project.path}/>}
        {manager.loadedProjectFile && <Button variant={"minimal"} size={"small"} icon={fileIcon} text={(manager.loadedProjectFile.path.split('/').pop()?.replace(/\.glb$/, '') || 'Untitled') + (fileNeedsSave ? '*' : '')}/>}
    </>
}
