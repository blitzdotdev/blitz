import {useEffect, useReducer, useRef, useState} from 'react';
import {useManager, useProject, ViewerProps} from '../utils/ViewerInstanceManager.ts'
import {BlueprintJsUiPlugin2} from '../UiConfigRendererBlueprint2.tsx'
import {
    ConfigObjectGenerators,
    InspectorStackComponent,
    ThemeSettingsMenuComponent,
    UiConfigRendererContext,
} from 'uiconfig-blueprint/lib/esm/lib'
import {ThreeViewer, UiObjectConfig} from 'threepipe';
import {EditorModes, EditorModesButtonGroup, editorModesInspectorConfig} from './EditorModes.tsx'
import {Alignment, Button, Card, H6, Navbar, Popover} from '@blueprintjs/core'
import Split from 'react-split'
import {BPHierarchyComponent} from './BPHierarchyComponent.tsx'
import {SaveFileButton} from './SaveFileButton.tsx'
import {InteractionControlsButtonGroup} from './InteractionControlsButtonGroup.tsx'

// const [splitMinSizes, setMinSplitSizes] = useState([0, 350, 250])
const splitMinSizes = [0, 350, 250]

ConfigObjectGenerators.hierarchy = BPHierarchyComponent

export function ThreeEditorComponent(props: Partial<ViewerProps>) {
    const [viewer, setViewer] = useState<ThreeViewer | null>(null)
    // const uiConfigRenderer = viewer.getPlugin(BlueprintJsUiPlugin2)!
    const [uiConfigRenderer, setUiConfigRenderer] = useState<BlueprintJsUiPlugin2 | null>(null)
    const manager = useManager()
    const {file} = useProject()

    const [splitSizes, setSplitSizes] = useState([0, 100, 0])

    const [insConfig, setInsConfig] = useState<UiObjectConfig<any, 'panel'>>(editorModesInspectorConfig['viewer'](viewer))
    const [editorMode, setEditorMode] = useReducer((currentMode: EditorModes, mode: EditorModes): EditorModes=>{
        const conf = editorModesInspectorConfig[mode](viewer)
        setInsConfig(conf)
        if(mode === currentMode) return mode
        // show/hide hierarchy panel
        if (mode !== 'interaction') setSplitSizes([0, splitSizes[1] + splitSizes[0], ...splitSizes.slice(2)])
        else setSplitSizes([20, splitSizes[1] - 20, ...splitSizes.slice(2)])
        viewer?.resize()
        manager.features.refresh(mode)
        return mode
    }, 'viewer')

    useEffect(() => {
        const v = manager.reset(props)
        v.load(file, {}) // file should only be files saved from this editor with scene settings.
        setViewer(v)
        setUiConfigRenderer(v.getPlugin(BlueprintJsUiPlugin2)!)
        setInsConfig(editorModesInspectorConfig[editorMode](v))
        manager.features.refresh(editorMode)
    }, [manager, ...Object.values(props), file])

    // useEffect(() => {
    //     manager.features.refresh(editorMode)
    // }, []);

    const canvasContainer = useRef<HTMLDivElement>(null)
    useEffect(() => {
        if(canvasContainer.current && viewer){
            canvasContainer.current.innerHTML = ''
            canvasContainer.current.appendChild(viewer.container)
        }
    }, [viewer])

    const {project} = useProject()

    return !uiConfigRenderer || !viewer ? null : (
        <UiConfigRendererContext.Provider value={uiConfigRenderer}>
            <div
                 // style={{backgroundColor: Colors.DARK_GRAY2, height: "100vh"}}>
                 style={{height: "100vh"}}>
                <Navbar>
                    <Navbar.Group align={Alignment.LEFT}>
                        <Navbar.Heading>3D Editor</Navbar.Heading>
                        <Navbar.Divider/>
                        <H6 style={{margin: "0"}}>{project}</H6>
                        {/*<Button minimal small icon="home" text="Home"/>*/}
                        {/*<Button minimal small icon="document" text="Files"/>*/}
                    </Navbar.Group>
                    <Navbar.Group align={Alignment.RIGHT}>
                        <SaveFileButton />
                        <Navbar.Divider/>
                        <Popover targetProps={{style: {}}}
                                 minimal
                                 targetTagName={"div"}
                                 content={
                                     <ThemeSettingsMenuComponent/>
                                 } placement="bottom">
                            <Button icon="cog" small minimal text=""/>
                        </Popover>
                    </Navbar.Group>
                </Navbar>
                <Split
                    gutterSize={6}
                    minSize={splitMinSizes}
                    sizes={splitSizes}
                    onDrag={(s) => {
                        console.log(s)
                        setSplitSizes(s)
                    }}
                    direction="horizontal"
                    className="editorSplitContainer"
                    style={{width: "100%"}}>

                    <InspectorStackComponent config={{
                        type: 'panel',
                        label: 'Hierarchy',
                        children: [{
                            type: 'hierarchy',
                            value: viewer.scene.modelRoot,
                        }]
                    }}/>

                    <Card style={{
                        height: "100%",
                        padding: "0",
                        position: "relative",
                        display: "flex",
                        flexDirection: "row"
                    }}>
                        <div className={"editorCanvasContainer"} ref={canvasContainer}></div>
                        {editorMode === 'interaction' && <InteractionControlsButtonGroup key="interaction-controls" /> }
                        <EditorModesButtonGroup key="modes" {...{editorMode, setEditorMode}} />
                    </Card>

                    <div style={{display: "flex", flexDirection: "row"}}>
                        <InspectorStackComponent config={insConfig}/>
                    </div>

                </Split>
            </div>
        </UiConfigRendererContext.Provider>
    );
}
