import React, {useContext, useEffect, useMemo, useRef, useState} from 'react';
import {BlueprintJsUiPlugin2} from '../UiConfigRendererBlueprint2.tsx'
import {
    BPComponentProps,
    ConfigObjectGenerators,
    UiConfigRendererContext,
} from 'uiconfig-blueprint/lib/esm/lib'
import {getOrCall, ISceneEventMap, ObjectPickerEventMap, PickingPlugin, ThreeViewer, TypedClass, TypeSystem} from 'threepipe';
import {Alignment, Button, Card, Divider, IconName, Navbar, Panel, PanelStack2, Popover, TabId} from '@blueprintjs/core'
import {BPHierarchyComponent} from './BPHierarchyComponent.tsx'
import {BPTextureFileComponent} from './BPTextureFileComponent.tsx'
import {BPMaterialsTreeComponent, MaterialHierarchyComponent} from "./BPMaterialsTreeComponent.tsx";
import {BPTexturesTreeComponent, TextureHierarchyComponent} from "./BPTexturesTreeComponent.tsx";
import {GeometryHierarchyComponent} from "./BPGeometriesTreeComponent.tsx";
import {FilesPanel} from "./FilesPanel.tsx";
import {
    InspectorPanelComponent,
    InspectorPanelProps,
} from "./InspectorPanelComponent.tsx";
import {MaybeElement} from "@blueprintjs/core/src/common/props";
import {WindowPanesLayout} from "./WindowPanesLayout.tsx";
import {BPTreeFolderComponent} from "./BPTreeFolderComponent.tsx";
import {iconForSelectionObject} from "../utils/icons.tsx";
import {objToSelectItemRef, RefSelectionObjectComponent} from "./RefSelectionObjectComponent.tsx";
import {PlayModeButtonGroup} from "./PlayModeButtonGroup.tsx";
import {ObjectHierarchyComponent} from "./ObjectHierarchyComponent.tsx";
import {useManager} from "../utils/UseManager.ts";
import {useAssets} from "../utils/AssetsProvider.ts";
import {ExternalFilesPanel} from "./ExternalFilesPanel.tsx";
import {
    DependenciesSectionComp,
    PluginsSectionComp,
    ScriptsSectionComp,
    WorktreesSectionComp,
} from '../adapters/DevServerProjectSettings.tsx';
import {DevServerInspectorControls} from '../adapters/DevServerInspectorControls.tsx';
import {
    Kite3dSaveSceneButton,
    Kite3dToolbarHooks,
} from '../adapters/Kite3dToolbarControls.tsx';
import {EditorSettingsPopover} from './EditorSettingsPopover.tsx';
import {DevServerSceneSummary} from '../adapters/DevServerSceneSummary.tsx';
import {HubProjectPicker} from './HubProjectPicker.tsx';
import {EditModePlugin} from '../utils/EditModePlugin.ts';


export function RefUiConfigComponent(props: BPComponentProps<any>){
    const uiConfigRenderer = useContext(UiConfigRendererContext)
    const manager = useManager()
    const classTypes = props.config.classTypes as Array<TypedClass> ?? []
    const currentValue = uiConfigRenderer.methods.getValue(props.config, undefined)
    const currentValueRef = useMemo(()=>{
        const currentValueType = TypeSystem.GetType(currentValue, false)
        const currentValueClass = currentValueType ? TypeSystem.GetClass(currentValueType) : undefined
        return objToSelectItemRef(currentValueType, currentValueClass, currentValue);
    }, [currentValue])
    return <RefSelectionObjectComponent
        object={currentValueRef}
        objectType={classTypes}
        label={uiConfigRenderer.methods.getLabel(props.config)}
        allowNone={props.config.allowNull ?? false}
        disabled={getOrCall(props.disabled ?? props.config.disabled??false) ?? false}
        onChange={async (selected, e)=>{
            console.log(selected)
            let val: any = undefined
            if(selected === null){
                if(props.config.allowNull){
                    val = null
                }else {
                    console.warn('Null selection not allowed here')
                    return
                }
            }else if('cls' in selected) { // SelectItemRef
                val = selected.item
            }else if('entry' in selected){
                const entry = selected.entry
                if(!entry) return
                const value = await manager.getAssetFromEntry(entry)
                val = value
            }
            if(val === undefined) return
            console.log(props.config)
            await uiConfigRenderer.methods.setValue(props.config, val, {last: true})
        }}
    ></RefSelectionObjectComponent>
}

// @ts-ignore
ConfigObjectGenerators.reference = RefUiConfigComponent
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

export function ThreeEditorComponent() {
    const [viewer, setViewer] = useState<ThreeViewer | null>(null)
    // const uiConfigRenderer = viewer.getPlugin(BlueprintJsUiPlugin2)!
    const [uiConfigRenderer, setUiConfigRenderer] = useState<BlueprintJsUiPlugin2 | null>(null)
    const manager = useManager()
    const {selectedFiles, selectedInspectorItems, setSelectedFiles} = useAssets()
    const project = manager.loadedProject
    const [rightTabId, setRightTabId] = useState<TabId>('inspector')
    const [bottomTabId, setBottomTabId] = useState<TabId>('files')
    const [playOverlay, setPlayOverlay] = useState(false)
    const selectedFile = selectedFiles.length === 1 ? selectedFiles[0] : null

    useEffect(() => {
        if (selectedFiles.length) setRightTabId('inspector')
    }, [selectedFiles])

    useEffect(() => {
        if (!viewer) return
        const picking = viewer.getPlugin(PickingPlugin)
        const inspectUiSelection = (event: ISceneEventMap['select']) => {
            if (!event.ui || !event.value) return
            setSelectedFiles([])
            setRightTabId('inspector')
        }
        const inspectCanvasSelection = (event: ObjectPickerEventMap['selectedObjectChanged']) => {
            if (!event.intersects || !event.value) return
            setSelectedFiles([])
            setRightTabId('inspector')
        }
        viewer.scene.addEventListener('select', inspectUiSelection)
        picking?.addEventListener('selectedObjectChanged', inspectCanvasSelection)
        return () => {
            viewer.scene.removeEventListener('select', inspectUiSelection)
            picking?.removeEventListener('selectedObjectChanged', inspectCanvasSelection)
        }
    }, [setSelectedFiles, viewer])

    // const [splitSizes, setSplitSizes] = useState([0, 100, 0])
    // const [hierarchyConfig, setHierarchyConfig] = useState<UiObjectConfig<any, 'hierarchy'>>({type: 'hierarchy'})
    // const [materialsLib, setMaterialsLib] = useState<UiObjectConfig<any, 'materials'>>({type: 'materials'})
    // const [texturesLib, setTexturesLib] = useState<UiObjectConfig<any, 'textures'>>({type: 'textures'})
    // const [geometriesLib, setGeometriesLib] = useState<UiObjectConfig<any, 'geometries'>>({type: 'geometries'})
    // const [modelRoot, setModelRoot] = useState<IObject3D|null>(null)

    useEffect(() => {
        // const v = manager.reset(props)
        const v = manager.get()
        setViewer(v)

        // pms?.then((res)=>{
        //     console.log(res)
        //     console.log('Loaded file/scene')
        // })

        const p = v.getPlugin(BlueprintJsUiPlugin2)!
        setUiConfigRenderer(p)
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
        // manager.features.refresh(editorMode)
        return () => {
            // setViewer(null)
            // setUiConfigRenderer(null)
            // setModelRoot(null)
            // setProjectMeta(undefined)
            // manager.loadProject(null)
            // manager.loadProject(null)
            // manager.loadScene(null) // todo
        }
    }, [manager, project?.file])

    // useEffect(() => {
    //     manager.features.refresh(editorMode)
    // }, []);

    const canvasContainer = useRef<HTMLDivElement>(null)
    const playCanvas = useRef<HTMLCanvasElement>(null)
    // add viewer.container to canvasContainer when it changes
    useEffect(() => {
        if(canvasContainer.current && viewer && viewer.container.parentElement !== canvasContainer.current){
            canvasContainer.current.innerHTML = ''
            canvasContainer.current.appendChild(viewer.container)
            viewer.resize()
        }
    }, [canvasContainer.current, viewer])

    useEffect(() => {
        if (playOverlay && playCanvas.current) void manager.startPlay(playCanvas.current)
    }, [manager, playOverlay])

    const stopPlaying = async () => {
        await manager.stopPlay()
        setPlayOverlay(false)
    }

    return !uiConfigRenderer || !viewer ? null : (
        <UiConfigRendererContext.Provider value={uiConfigRenderer}>
            <div
                 // style={{backgroundColor: Colors.DARK_GRAY2, height: "100vh"}}>
                 style={{
                     height: "100%",
                     position: "relative",
                     // display: "flex", // flex is creating issues with panes and page layout.
                    // flexDirection: "column",
                    // gap: 0,
                 }}
            >
                <Navbar key={project?.path ?? 'navbar'}>
                    <Navbar.Group align={Alignment.START}>
                        <svg width="352" height="605" className={"main-nav-logo"} viewBox="0 0 352 605" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M143.088 394.344C131.422 421.844 118.288 480.144 159.088 493.344C210.088 509.844 234.588 431.344 282.588 459.344C320.988 481.744 298.588 536.844 282.588 562.344" stroke="#1B3976" strokeWidth="14" strokeLinecap="round"/>
                            <path d="M325.567 546.446L290.583 547.343C289.917 547.343 287.884 546.343 285.083 542.344C281.583 537.345 269.584 521.843 265.584 519.843C263.532 518.817 260.686 519.107 258.336 519.71C256.161 520.269 254.471 521.873 253.366 523.827C248.602 532.245 241.437 546.034 241.083 551.343C240.683 557.343 244.583 558.843 246.583 558.843H278.091C278.751 558.843 279.409 558.772 280.065 558.706C282.013 558.51 284.746 558.656 285.083 560.343C285.583 562.843 306.583 584.843 311.083 587.343C313.55 588.714 317.098 587.814 319.891 586.576C322.05 585.619 323.513 583.647 324.306 581.423C327.687 571.934 332.876 557.172 333.583 554.343C334.016 552.613 333.298 550.804 332.285 549.298C330.836 547.145 328.161 546.379 325.567 546.446Z" fill="#E7312C"/>
                            <path d="M289.586 549.344C281.086 572.344 241.586 603.344 218.586 596.844" stroke="#E7312C" strokeWidth="14" strokeLinecap="round"/>
                            <path d="M170.586 157.844C166.086 183.346 147.362 327.027 141.695 398.527C144.854 398.913 148.181 397.944 150.704 395.487L347.25 204.003C349.175 202.129 350.279 199.699 350.523 197.189C299.879 183.331 204.958 159.339 170.586 157.844Z" fill="#1F62C2"/>
                            <path d="M208.426 0.763269C198.093 36.9288 176.086 118.846 170.586 157.844C204.958 159.339 299.879 183.331 350.523 197.189C350.776 194.583 350.102 191.889 348.458 189.637L213.281 4.5138C212.001 2.7609 210.303 1.49957 208.426 0.763269Z" fill="#4F99E6"/>
                            <path d="M0.262264 158.337C45.1729 156.925 141.823 154.463 170.586 157.844C176.086 118.846 198.093 36.9288 208.426 0.763269C204.932 -0.607625 200.819 -0.158474 197.633 2.32675L3.08065 154.059C1.65078 155.174 0.693794 156.69 0.262264 158.337Z" fill="#266CCB"/>
                            <path d="M141.695 398.527C147.362 327.027 166.086 183.346 170.586 157.844C141.823 154.463 45.1729 156.925 0.262264 158.337C-0.256772 160.318 -0.01564 162.488 1.07713 164.375L133.508 393.119C135.335 396.275 138.424 398.127 141.695 398.527Z" fill="#154FA9"/>
                        </svg>
                        <Navbar.Heading>
                            Kite 3D
                        </Navbar.Heading>
                        {project && (<>
                        <Navbar.Divider/>
                        {/*<H5 style={{margin: "0"}}>{project}</H5>*/}
                        {/*<H6 style={{margin: "0"}}>{scene}</H6>*/}
                        <NavProjectFileName/>
                        {/*<Button variant={"minimal"} size={"small"} icon="home" text="Home"/>*/}
                        {/*<Button variant={"minimal"} size={"small"} icon="document" text="Files"/>*/}
                        <Navbar.Divider/>
                        </>)}
                    </Navbar.Group>
                    {project && (
                    <Navbar.Group align={Alignment.START}>
                        <Kite3dSaveSceneButton/>
                    </Navbar.Group>
                    )}
                    <Navbar.Group align={Alignment.END}>
                        <PlayModeButtonGroup
                            key="playmode"
                            onPlay={() => setPlayOverlay(true)}
                            onStop={() => void stopPlaying()}/>
                        <Navbar.Divider/>
                        <Popover targetProps={{style: {}}}
                                 minimal
                                 targetTagName={"div"}
                                 content={
                                     <EditorSettingsPopover viewer={viewer}/>
                                 } placement="bottom-end">
                            <Button aria-label="Settings" icon="cog" size={"small"} variant={"minimal"} text=""/>
                        </Popover>
                    </Navbar.Group>
                    <Kite3dToolbarHooks/>
                </Navbar>
                <WindowPanesLayout
                    key={viewer.scene.uuid} // force rerender when viewer change, because we might add events to the viewer in sub components like BPHierarchyComponent
                    selectedTabIds={{right: rightTabId, bottom: bottomTabId}}
                    onTabChange={(position, tabId) => {
                        if (position === 'right') setRightTabId(tabId)
                        if (position === 'bottom') setBottomTabId(tabId)
                    }}
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
                            flexDirection: "column",
                        }, content: <>
                                <div
                                    className={"editorCanvasContainer"}
                                    key={"editorCanvasContainer"}
                                    onDragOver={(event) => event.preventDefault()}
                                    onDrop={(event) => {
                                        event.preventDefault()
                                        void manager.importFiles(event.dataTransfer.files)
                                    }}
                                >
                                    <div className="editor-canvas-mount" ref={canvasContainer}/>
                                    <EditModeStatusChips viewer={viewer}/>
                                    {playOverlay && <canvas ref={playCanvas} className="game-canvas-overlay" data-testid="game-canvas"/>}
                                </div>
                            </>}],
                        bottom: manager.loadedProject ? [{title: 'Files', key: 'files', content: <FilesPanel />},
                            {title: 'Library', key: 'library', content: <ExternalFilesPanel />}]: null,
                        right: [
                            {
                                title: 'Inspector',
                                key: 'inspector',
                                keepMounted: true,
                                className: 'kite3d-right-panel-body',
                                style: {
                                    position: "relative" as const,
                                    display: "flex" as const,
                                    flexDirection: "column" as const,
                                },
                                content: <>
                                    {!selectedFile && selectedInspectorItems.length === 0 && <DevServerSceneSummary/>}
                                    {!selectedFile && selectedInspectorItems.length > 0 && <DevServerInspectorControls placement="header"/>}
                                    {!selectedFile && selectedInspectorItems.length > 0 && <EditInspectorComponent
                                        className={'inspector-stack'}
                                    />}
                                </>
                            },
                            {
                                title: 'Project',
                                key: 'project',
                                className: 'kite3d-right-panel-body',
                                style: {
                                    position: "relative" as const,
                                    display: "flex" as const,
                                    flexDirection: "column" as const,
                                },
                                content:
                                <>
                                {/*<Card className={"bpInspectorCard "} style={{borderRadius: 0}}>*/}
                                    <WorktreesSectionComp/>
                                    <ScriptsSectionComp/>
                                    <Divider style={{margin: 0}}/>
                                    <PluginsSectionComp/>
                                    <Divider style={{margin: 0}}/>
                                    <DependenciesSectionComp/>
                                {/*</Card>*/}
                                </>
                            },
                        ],
                    }}
                />
            </div>
        </UiConfigRendererContext.Provider>
    );

}

function EditModeStatusChips({viewer}: {viewer: ThreeViewer}) {
    const editMode = viewer.getPlugin(EditModePlugin)
    const [speed, setSpeed] = useState<number | null>(null)
    const [isolated, setIsolated] = useState(editMode?.isIsolated ?? false)

    useEffect(() => {
        if (!editMode) return
        let speedTimer: number | undefined
        const speedChanged = () => {
            setSpeed(editMode.wasdMovementSpeed)
            window.clearTimeout(speedTimer)
            speedTimer = window.setTimeout(() => setSpeed(null), 1_000)
        }
        const isolateChanged = () => setIsolated(editMode.isIsolated)
        editMode.addEventListener('speedChanged', speedChanged)
        editMode.addEventListener('isolateChanged', isolateChanged)
        return () => {
            editMode.removeEventListener('speedChanged', speedChanged)
            editMode.removeEventListener('isolateChanged', isolateChanged)
            window.clearTimeout(speedTimer)
        }
    }, [editMode])

    return <div className="kite3d-viewport-status-chips" data-testid="edit-mode-status">
        {speed === null ? null : <span className="kite3d-status-chip" data-testid="camera-speed-chip">SPEED {speed}</span>}
        {isolated ? <button className="kite3d-status-chip" data-testid="isolated-chip" onClick={() => editMode?.exitIsolate()}>ISOLATED</button> : null}
    </div>
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
                         showPanelHeader={currentPanelStack.length > 1}
                         renderActivePanelOnly={true}
                         onOpen={(p) => setCurrentPanelStack([...currentPanelStack, p] as any)}
                         onClose={() => setCurrentPanelStack(currentPanelStack.slice(0, -1))}
                         stack={currentPanelStack}/>
            {/*}*/}
        </Card>
    )
}

export function NavProjectFileName(){
    const manager = useManager()
    const project = manager.loadedProject

    const fileIcon: IconName|MaybeElement = !!manager.loadedScene ? 'cubes' : !!manager.loadedAssetObj ? iconForSelectionObject(manager.loadedAssetObj) : 'document'

    const fileNeedsSave = manager.loadedNeedsSave
    if(!project) return null
    return <>
        <HubProjectPicker fallbackPath={project.path || 'New File'}/>
        {/* AGREED-4: Kite3D scenes are text glTF; present the stem in the same reference slot. */}
        {manager.loadedFilePath && <Button
            variant={"minimal"}
            size={"small"}
            icon={fileIcon}
            text={(manager.loadedFilePath.split('/').pop()?.replace(/\.(?:glb|gltf)$/, '') || 'Untitled') + (fileNeedsSave ? '*' : '')}
        />}
    </>
}
