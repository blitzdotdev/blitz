import {JSX, useEffect, useReducer, useRef, useState} from 'react';
import {useManager, useProject, ViewerProps} from '../utils/ViewerInstanceManager.ts'
import {BlueprintJsUiPlugin2} from '../UiConfigRendererBlueprint2.tsx'
import {
    ConfigObjectGenerators,
    InspectorStackComponent,
    ThemeSettingsMenuComponent,
    UiConfigRendererContext,
    useConfigToStackItem,
} from 'uiconfig-blueprint/lib/esm/lib'
import {IObject3D, PickingPlugin, ThreeViewer, toTitleCase, UiObjectConfig} from 'threepipe';
import {EditorModes, EditorModesButtonGroup, editorModesInspectorConfig} from './EditorModes.tsx'
import {Alignment, Button, Card, IconName, Navbar, Panel, PanelStack2, Popover, Tab, Tabs} from '@blueprintjs/core'
import Split from 'react-split'
import {BPHierarchyComponent, ObjectHierarchyComponent} from './BPHierarchyComponent.tsx'
import {SaveFileButton, SaveProjectButton} from './SaveFileButton.tsx'
import {InteractionControlsButtonGroup} from './InteractionControlsButtonGroup.tsx'
import {BPTextureFileComponent} from './BPTextureFileComponent.tsx'
import {BPMaterialsTreeComponent, MaterialHierarchyComponent} from "./BPMaterialsTreeComponent.tsx";
import {BPTexturesTreeComponent, TextureHierarchyComponent} from "./BPTexturesTreeComponent.tsx";
import {GeometryHierarchyComponent} from "./BPGeometriesTreeComponent.tsx";
import {FilesPanel} from "./FilesPanel.tsx";
import {getFileByPath, useAssets} from "../utils/AssetsProvider.ts";
import {Classes} from "@blueprintjs/core/src/common";
import {Text} from "@blueprintjs/core/src/components/text/text.tsx";
import {InspectorPanelComponent, InspectorPanelProps} from "./InspectorPanelComponent.tsx";
import {isPackageProject} from "../utils/projectActions.tsx";
import {iconForSelectionObject} from "./RefSelectionObjectComponent.tsx";
import {MaybeElement} from "@blueprintjs/core/src/common/props";

// const [splitMinSizes, setMinSplitSizes] = useState([0, 350, 250])
const splitMinSizes = [0, 350, 300]
const splitMinSizesCenter = [40, 0]

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

export function ThreeEditorComponent(props: Partial<ViewerProps>) {
    const [viewer, setViewer] = useState<ThreeViewer | null>(null)
    // const uiConfigRenderer = viewer.getPlugin(BlueprintJsUiPlugin2)!
    const [uiConfigRenderer, setUiConfigRenderer] = useState<BlueprintJsUiPlugin2 | null>(null)
    const manager = useManager()
    const { projectFile, project, fileNeedsSave, setFileNeedsSave} = useProject()

    useEffect(()=>{
        setFileNeedsSave(manager.loadedNeedsSave)
        console.log(manager.loadedNeedsSave)
        const l = ()=>{
            console.log(manager.loadedNeedsSave)
            setFileNeedsSave(manager.loadedNeedsSave)
        }
        manager.addEventListener('loadedNeedsSaveChange', l)
        return ()=>{
            manager.removeEventListener('loadedNeedsSaveChange', l)
        }
    }, [manager, setFileNeedsSave])

    const [splitSizes, setSplitSizes] = useState([0, 100, 0])

    const [insConfig, setInsConfig] = useState<UiObjectConfig<any, 'panel'>>(editorModesInspectorConfig['viewer'](viewer))
    // const [hierarchyConfig, setHierarchyConfig] = useState<UiObjectConfig<any, 'hierarchy'>>({type: 'hierarchy'})
    // const [materialsLib, setMaterialsLib] = useState<UiObjectConfig<any, 'materials'>>({type: 'materials'})
    // const [texturesLib, setTexturesLib] = useState<UiObjectConfig<any, 'textures'>>({type: 'textures'})
    // const [geometriesLib, setGeometriesLib] = useState<UiObjectConfig<any, 'geometries'>>({type: 'geometries'})
    const [modelRoot, setModelRoot] = useState<IObject3D|null>(null)

    const [editorMode, setEditorMode] = useReducer((currentMode: EditorModes, mode: EditorModes): EditorModes=>{
        const conf = editorModesInspectorConfig[mode](viewer)
        setInsConfig(conf)
        if(mode === currentMode) return mode
        // show/hide hierarchy panel
        if (mode !== 'edit') {
            setSplitSizes([0, splitSizes[1] + splitSizes[0], ...splitSizes.slice(2)])
        }
        else {
            setSplitSizes([20, splitSizes[1] - 20, ...splitSizes.slice(2)])
        }
        viewer?.resize()
        manager.features.refresh(mode)
        return mode
    }, 'viewer')

    const projectIcon: IconName = isPackageProject(project) ? 'folder-close' : 'cubes'
    const fileIcon: IconName|MaybeElement = !!manager.loadedScene ? 'cubes' : !!manager.loadedAssetObj ? iconForSelectionObject(manager.loadedAssetObj) : 'document'

    useEffect(() => {
        // const v = manager.reset(props)
        let v
        let pms
        if (project && isPackageProject(project)){
            v = manager.loadProject(project, props) ?? manager.reset(props)
            // load project first, then scene
            // todo load default scene settings first like empty env etc
            pms = projectFile ? manager.loadProjectFile(project, projectFile) : null
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
        setModelRoot(v.scene.modelRoot)
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
    }, [manager, ...Object.values(props), projectFile, project?.file])

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

    const { canRenderInspector, setSelectedInspectorItem, setSelectedFiles, fileManifest } = useAssets()

    // console.log('fileManifest', fileManifest)
    useEffect(()=>{
        const picking = viewer?.getPlugin(PickingPlugin)
        const onSelectedChanged = ()=>{
            const sel = picking?.getSelectedObject()
            // console.log('selected object changed', sel)
            setSelectedInspectorItem(prev=>{
                if(!sel && !prev.length) return prev
                const curr = prev.length === 1 ? prev[0] : null
                if(curr === sel) return prev
                // if(Array.isArray(sel)){
                //     if(prev.length === sel.length && sel.every(s=>prev.includes(s))) return prev
                //     return sel
                // }
                return sel ? [sel] : []
            })
            // if sel is an asset itself, find the file and select it also, otherwise clear selected files
            if(sel && /*sel?._isTpAsset &&*/ sel.userData.tpAssetId && sel.userData.rootPath?.startsWith('asset://') && fileManifest){
                const file = getFileByPath(sel.userData.rootPath.replace('asset://', ''), fileManifest)
                setSelectedFiles(f=>{
                    if(file && !f.includes(file)) return [file]
                    return []
                })
            }else{
                setSelectedFiles([])
            }
        }
        picking?.addEventListener('selectedObjectChanged', onSelectedChanged)
        onSelectedChanged()
        return ()=>{
            picking?.removeEventListener('selectedObjectChanged', onSelectedChanged)
        }
    }, [viewer, fileManifest])

    return !uiConfigRenderer || !viewer ? null : (
        <UiConfigRendererContext.Provider value={uiConfigRenderer}>
            <div
                 // style={{backgroundColor: Colors.DARK_GRAY2, height: "100vh"}}>
                 style={{height: "100vh"}}>
                <Navbar>
                    <Navbar.Group align={Alignment.START}>
                        <Navbar.Heading>3D Editor</Navbar.Heading>
                        <Navbar.Divider/>
                        {/*<H5 style={{margin: "0"}}>{project}</H5>*/}
                        {/*<H6 style={{margin: "0"}}>{scene}</H6>*/}
                        {project && <Button variant={"minimal"} size={"small"} icon={projectIcon} text={project.path}/>}
                        {projectFile && <Button variant={"minimal"} size={"small"} icon={fileIcon} text={projectFile.path.split('/').pop()?.replace(/\.glb$/, '') || 'Untitled'}/>}
                        {/*<Button variant={"minimal"} size={"small"} icon="home" text="Home"/>*/}
                        {/*<Button variant={"minimal"} size={"small"} icon="document" text="Files"/>*/}
                    </Navbar.Group>
                    <Navbar.Group align={Alignment.END}>
                        {isPackageProject(project) ? <SaveProjectButton/> : <SaveFileButton /> }
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
                <Split
                    gutterSize={6}
                    minSize={splitMinSizes}
                    sizes={splitSizes}
                    onDrag={(s) => {
                        // console.log(s)
                        setSplitSizes(s)
                    }}
                    direction="horizontal"
                    className="editorSplitContainer"
                    style={{width: "100%"}}>

                    <Card style={{
                        height: "100%",
                        padding: "0",
                        borderRadius: "0",
                    }}>
                        <Tabs
                            vertical={false}
                            animate={true}
                            renderActiveTabPanelOnly={false}
                            size={"medium"}
                            className={"editor-left-tabs"}
                        >
                            {Object.entries(editorLeftTabs).map(([k, TabPanel])=>(
                                <Tab id={k} key={k} panel={
                                    <TabPanel key={k} root={modelRoot} className={''}/>
                                } panelClassName="hierarchy-stack" title={toTitleCase(k)} />
                            ))}
                        </Tabs>

                    </Card>
                    {/*<InspectorStackComponent*/}
                    {/*    className={'hierarchy-stack'}*/}
                    {/*    config={hierarchyConfig}/>*/}

                    <CenterSplit key={"centerSplit"} defaultSize={[80, 20]} minSize={splitMinSizesCenter}>

                        <Card key={"canvasContainer"} style={{
                            width: "100%",
                            padding: "0",
                            position: "relative",
                            display: "flex",
                            flexDirection: "row",
                            borderRadius: 0,
                        }}>
                            <div className={"editorCanvasContainer"} ref={canvasContainer}></div>
                            {editorMode === 'edit' && <InteractionControlsButtonGroup key="interaction-controls" /> }
                            <EditorModesButtonGroup key="modes" {...{editorMode, setEditorMode}} />
                        </Card>

                        <Card style={{
                            width: "100%",
                            padding: "0",
                            position: "relative",
                            display: "flex",
                            flexDirection: 'column',
                            borderRadius: 0,
                        }}>
                            <FilesPanel/>
                        </Card>
                    </CenterSplit>

                    <div style={{display: "flex", flexDirection: "row"}}>
                        {!canRenderInspector || editorMode !== 'edit' ?
                            <ModesInspector config={insConfig} className={'inspector-stack'}/>
                        :
                        <EditInspectorComponent
                            className={'inspector-stack'}
                        />
                        }
                    </div>

                </Split>
            </div>
        </UiConfigRendererContext.Provider>
    );

}

export function CenterSplit({children, defaultSize, minSize}: {
    children: /*JSX.Element | */(JSX.Element|null)[]
    defaultSize: number[]
    minSize: number[]
}){
    const [splitSizes, setSplitSizes] = useState(defaultSize)
    // todo this doesn't open it back when the child becomes not null again
    // const [sizes, minSize2, children2] = useMemo(()=>{
    //     let left = 0
    //     const res = children.map((child, i)=>{
    //         if(!child) {
    //             left += splitSizes[i]
    //             console.log('empty', child)
    //             return 0
    //         }
    //         const r =  splitSizes[i] + left
    //         left = 0
    //         return r
    //     })
    //     const minSize3 = minSize//.filter((_, i)=>res[i]>0)
    //     const children3 = children.map((c, i)=>!c ? <div key={i}></div> : c)
    //     const res3 = res//.filter(r=>r>0)
    //     if(left && res3.length) {
    //         const i = res3.findIndex(v=>v>0)
    //         res3[i] += left
    //     }
    //     return [res3, minSize3, children3]
    // }, [children])
    // useEffect(()=>{
    //     setSplitSizes([...sizes])
    // }, [sizes])

    const [sizes, minSize2, children2] = [splitSizes, minSize, children]

    // console.log(sizes, children2, splitSizes)

    return <Split
        gutterSize={6}
        minSize={minSize2}
        sizes={sizes}
        onDrag={(s) => {
            // console.log(s)
            setSplitSizes(s)
        }}
        key={'a' + splitSizes.length}
        direction="vertical"
        className="editorCenterSplitContainer"
        style={{height: "100%"}}>

        {children2}

    </Split>

}

function getStackItem(){
    return [{
        props: {},
        renderPanel(props) {
            // console.log(props.config === config)
            return <ul style={{listStyleType: "none", paddingLeft: "0", margin: "0"}}>
                <InspectorPanelComponent props={props}/>
            </ul>
        },
        title: 'Inspector'
    } as Panel<InspectorPanelProps>]
}
export function EditInspectorComponent({className}: {
    className?: string
}) {
    const {selectedInspectorItem, canRenderInspector, selectedFiles} = useAssets()
    const [currentPanelStack, setCurrentPanelStack] = useState<Array<Panel<InspectorPanelProps>>>(getStackItem());

    const isMultiple = selectedFiles.length > 1 || (!selectedFiles.length && selectedInspectorItem.length > 1)

    return (
        !canRenderInspector ? null : <Card className={"bpInspectorCard " + className||''} style={{borderRadius: 0}}>
            {/*<div >Inspector</div>*/}
            {/*<div style={{width: "100%"}}>{selectedInspectorItem.object?.name || "Unnamed"}</div>*/}
            {isMultiple ? <div>
                    <div style={{width: "100%"}} className={Classes.PANEL_STACK2_HEADER}>
                        {/* two <span> tags here ensure title is centered as long as possible, with `flex: 1` styling */}
                        <span>{null}</span>
                        <Text className={Classes.HEADING} ellipsize={true} title={"Inspector"}>
                            Inspector
                        </Text>
                        <span />
                    </div>

                    {selectedFiles.length ? selectedFiles.map(f=><div key={f.path}>{f.name}</div>) :
                    selectedInspectorItem.map((item, i)=><div key={i}>{item?.name || 'Unnamed'}</div>)}
            </div> :
            <PanelStack2 className="inspectorPanelStack"
                         showPanelHeader={true}
                         renderActivePanelOnly={false}
                         onOpen={(p) => setCurrentPanelStack([...currentPanelStack, p] as any)}
                         onClose={() => setCurrentPanelStack(currentPanelStack.slice(0, -1))}
                         stack={currentPanelStack}/>
            }
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
}
