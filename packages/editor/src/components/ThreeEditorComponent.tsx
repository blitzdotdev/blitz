import {useEffect, useRef, useState} from 'react'
import {
    Alignment,
    Button,
    ButtonGroup,
    Card,
    FormGroup,
    InputGroup,
    Intent,
    Menu,
    MenuItem,
    Navbar,
    Popover,
    Slider,
    Tag,
} from '@blueprintjs/core'
import {ConfigObject, ThemeSettingsMenuComponent, UiConfigRendererContext} from 'uiconfig-blueprint/lib/esm/lib'
import {
    CanvasSnapshotPlugin,
    EditorViewWidgetPlugin,
    PickingPlugin,
    TransformControlsPlugin,
    type IGeometry,
    type IMaterial,
    type IObject3D,
    type SelectionObject,
    type ITexture,
} from 'threepipe'
import {BlueprintJsUiPlugin2} from '../UiConfigRendererBlueprint2.tsx'
import {EditModePlugin} from '../utils/EditModePlugin.ts'
import {useManagerVersion} from '../utils/UseManager.ts'
import {WindowPanesLayout} from './WindowPanesLayout.tsx'
import {PlayModeButtonGroup} from './PlayModeButtonGroup.tsx'
import {FilesPanel} from './FilesPanel.tsx'
import {CameraSelectionMenu} from './CameraSelectionMenu.tsx'

export function ThreeEditorComponent({onOpenGame}: {onOpenGame(): void}) {
    const manager = useManagerVersion()
    const viewer = manager.get()
    const ui = viewer.getPlugin(BlueprintJsUiPlugin2)
    const canvasContainer = useRef<HTMLDivElement>(null)
    const playCanvas = useRef<HTMLCanvasElement>(null)
    const [playOverlay, setPlayOverlay] = useState(false)
    const [checkpointing, setCheckpointing] = useState(false)
    const [restoring, setRestoring] = useState(false)

    useEffect(() => {
        if (!canvasContainer.current || viewer.container.parentElement === canvasContainer.current) return
        canvasContainer.current.replaceChildren(viewer.container)
        viewer.resize()
    }, [viewer])

    useEffect(() => {
        if (!playOverlay || !playCanvas.current) return
        void manager.startPlay(playCanvas.current).then(() => {
            if (!manager.isPlaying) setPlayOverlay(false)
        })
    }, [manager, playOverlay])

    const stop = async () => {
        await manager.stopPlay()
        setPlayOverlay(false)
    }

    const dropFiles = (files: FileList) => {
        void manager.importFiles(Array.from(files)).catch((error) => manager.reportError(error))
    }

    const checkpoint = async () => {
        setCheckpointing(true)
        try { await manager.createCheckpoint() } finally { setCheckpointing(false) }
    }

    const restore = async () => {
        setRestoring(true)
        try { await manager.restoreLastCheckpoint() } finally { setRestoring(false) }
    }

    if (!ui) return null
    return <UiConfigRendererContext.Provider value={ui}>
        <div className="three-editor-shell">
            <Navbar>
                <Navbar.Group align={Alignment.START}>
                    <Button
                        className="main-nav-logo-button"
                        minimal
                        aria-label="Welcome"
                        onClick={() => manager.setWelcomeOpen(true)}
                    ><img src="/logo.svg" alt="Blitz" className="main-nav-logo"/></Button>
                    <h1 className="project-heading">{manager.project?.name || 'Blitz'}</h1>
                    <Navbar.Divider/>
                    <Button minimal icon="cube" text={`${manager.scenePath}${manager.loadedNeedsSave ? '*' : ''}`}/>
                    <span className="editor-status" aria-live="polite">{manager.status}</span>
                </Navbar.Group>
                <Navbar.Group align={Alignment.END}>
                    <Button
                        data-testid="save-scene"
                        icon="floppy-disk"
                        minimal
                        disabled={!manager.loadedNeedsSave}
                        onClick={() => void manager.saveScene()}
                    >Save</Button>
                    <PlayModeButtonGroup onPlay={() => setPlayOverlay(true)} onStop={() => void stop()}/>
                    <Button data-testid="open-game" icon="share" onClick={onOpenGame}>Open game</Button>
                    <Button
                        data-testid="check-game"
                        icon="diagnosis"
                        loading={manager.isChecking}
                        disabled={manager.isChecking}
                        onClick={() => void manager.runCheck()}
                    >Check</Button>
                    <Button
                        data-testid="checkpoint-game"
                        icon="git-commit"
                        loading={checkpointing}
                        disabled={checkpointing || restoring}
                        onClick={() => void checkpoint()}
                    >Checkpoint</Button>
                    <Navbar.Divider/>
                    <Popover minimal placement="bottom" content={<SettingsMenu restoring={restoring} onRestore={() => void restore()}/>}>
                        <Button aria-label="Settings" icon="cog" minimal/>
                    </Popover>
                </Navbar.Group>
            </Navbar>

            {manager.checkResult && <div className="check-result-cards" data-testid="check-results">
                {manager.checkResult.outcomes.map((outcome) => <Card key={outcome.name} compact>
                    <Tag minimal intent={outcome.status === 'pass' ? Intent.SUCCESS : Intent.DANGER}>
                        {outcome.name} {outcome.status.toUpperCase()}
                    </Tag>
                    <span>{outcome.codes.length ? outcome.codes.join(', ') : outcome.summary}</span>
                </Card>)}
            </div>}

            <WindowPanesLayout panels={{
                left: [
                    {title: 'Objects', key: 'objects', className: 'hierarchy-stack', content: <ObjectsPanel/>},
                    {title: 'Materials', key: 'materials', content: <MaterialsPanel/>},
                    {title: 'Textures', key: 'textures', content: <TexturesPanel/>},
                    {title: 'Geometries', key: 'geometries', content: <GeometriesPanel/>},
                    {title: 'Scene', key: 'scene', content: <ScenePanel/>},
                ],
                center: [{
                    title: 'Content',
                    key: 'content',
                    style: {position: 'relative', display: 'flex', flexDirection: 'column'},
                    content: <div
                        className="editorCanvasContainer"
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                            event.preventDefault()
                            dropFiles(event.dataTransfer.files)
                        }}
                    >
                        <div className="editor-canvas-mount" ref={canvasContainer}/>
                        <ViewportControls/>
                        {playOverlay && <canvas ref={playCanvas} className="game-canvas-overlay" data-testid="game-canvas"/>}
                    </div>,
                }],
                bottom: [
                    {title: 'Files', key: 'files', content: <FilesPanel/>},
                    {title: 'Timeline', key: 'timeline', content: <TimelinePanel/>},
                ],
                right: [
                    {title: 'Inspector', key: 'inspector', content: <InspectorPanel/>},
                    {title: 'Settings', key: 'settings', content: <SettingsPanel/>},
                    {title: 'Project', key: 'project', content: <ProjectPanel/>},
                ],
            }}/>
            {manager.error && <pre className="editor-error" role="alert">{manager.error}</pre>}
        </div>
    </UiConfigRendererContext.Provider>
}

function SettingsMenu({restoring, onRestore}: {restoring: boolean, onRestore(): void}) {
    return <div>
        <Menu>
            <MenuItem
                data-testid="restore-checkpoint"
                icon="history"
                text="Restore last checkpoint"
                disabled={restoring}
                onClick={onRestore}
            />
        </Menu>
        <ThemeSettingsMenuComponent/>
    </div>
}

function ObjectsPanel() {
    const manager = useManagerVersion()
    const viewer = manager.get()
    return <div className="editor-panel-body" data-testid="scene-hierarchy">
        <ObjectRow object={viewer.scene.modelRoot} label="Scene" depth={0}/>
        {viewer.scene.defaultCamera && <ObjectRow object={viewer.scene.defaultCamera} label="Default Camera" depth={1}/>}
    </div>
}

function ObjectRow({object, depth, label}: {object: IObject3D, depth: number, label?: string}) {
    const manager = useManagerVersion()
    const [expanded, setExpanded] = useState(true)
    const generated = object.userData.blitzGenerated === true
    const children = object.children || []
    return <div className="hierarchy-row-group">
        <div className="hierarchy-row" style={{paddingLeft: `${depth * 14 + 4}px`}}>
            <Button
                className="hierarchy-caret"
                minimal
                small
                icon={children.length ? (expanded ? 'chevron-down' : 'chevron-right') : 'blank'}
                onClick={() => setExpanded((value) => !value)}
            />
            <Button
                minimal
                small
                icon={objectIcon(object)}
                text={label || object.name || object.type || 'Unnamed'}
                onClick={() => {
                    manager.get().getPlugin(PickingPlugin)?.setSelectedObject(object)
                    void manager.writeState()
                }}
            />
            {generated && <Tag minimal intent={Intent.WARNING} className="generated-badge">generated</Tag>}
        </div>
        {expanded && children.map((child) => <ObjectRow key={child.uuid} object={child} depth={depth + 1}/>)}
    </div>
}

function InspectorPanel() {
    const manager = useManagerVersion()
    const viewer = manager.get()
    const picking = viewer.getPlugin(PickingPlugin)
    const [, setSelectionVersion] = useState(0)

    useEffect(() => {
        const changed = () => setSelectionVersion((value) => value + 1)
        picking?.addEventListener('selectedObjectChanged', changed)
        return () => picking?.removeEventListener('selectedObjectChanged', changed)
    }, [picking])

    const selected = picking?.getSelectedObject()
    const selection = !Array.isArray(selected) ? selected : undefined
    const object = (selection as IObject3D | undefined)?.isObject3D
        ? selection as IObject3D
        : undefined
    const generators = object
        ? manager.generatorStates.filter(({nodeName}) => nodeName === object.name)
        : manager.generatorStates

    return <div className="editor-panel-body inspector-stack" data-testid="generator-inspector">
        {!object && !generators.length && <p className="empty-panel-message">Select an object to inspect it.</p>}
        {object && <>
            <FormGroup label="Name" labelFor="inspector-object-name">
                <InputGroup
                    id="inspector-object-name"
                    value={object.name}
                    onChange={(event) => {
                        object.name = event.target.value
                        object.setDirty?.({change: 'name'})
                    }}
                />
            </FormGroup>
            {object.uiConfig && <ConfigObject
                config={object.uiConfig}
                openPanel={() => undefined}
                closePanel={() => undefined}
            />}
        </>}
        {selection && !object && selection.uiConfig && <ConfigObject
            config={selection.uiConfig}
            openPanel={() => undefined}
            closePanel={() => undefined}
        />}
        {generators.map((generator) => <GeneratorInspector key={generator.componentId} generator={generator}/>)}
    </div>
}

function GeneratorInspector({generator}: {generator: ReturnType<typeof useManagerVersion>['generatorStates'][number]}) {
    const manager = useManagerVersion()
    const [module, setModule] = useState(generator.module)
    const [params, setParams] = useState(JSON.stringify(generator.params, null, 2))

    useEffect(() => {
        setModule(generator.module)
        setParams(JSON.stringify(generator.params, null, 2))
    }, [generator.module, generator.params])

    const apply = async () => {
        try {
            await manager.updateGenerator(generator, module, JSON.parse(params) as Record<string, unknown>)
        } catch (error) {
            await manager.reportError(error)
        }
    }

    return <Card className="generator-inspector-card" compact>
        <h3>Generator · {generator.nodeName}</h3>
        <FormGroup label="Module">
            <InputGroup
                data-testid={`generator-module-${generator.nodeIndex}`}
                value={module}
                onChange={(event) => setModule(event.target.value)}
                onBlur={() => void apply()}
            />
        </FormGroup>
        <FormGroup label="Params">
            <textarea
                className="bp5-input generator-params-input"
                data-testid={`generator-params-${generator.nodeIndex}`}
                value={params}
                onChange={(event) => setParams(event.target.value)}
                onBlur={() => void apply()}
            />
        </FormGroup>
        <ButtonGroup>
            <Button data-testid={`bake-${generator.nodeIndex}`} onClick={() => void manager.requestBake(generator.nodeName)}>Bake</Button>
            <Button data-testid={`force-bake-${generator.nodeIndex}`} intent={Intent.WARNING} onClick={() => {
                if (window.confirm(`Force bake ${generator.nodeName}? Existing children or human edits may be replaced.`)) {
                    void manager.requestBake(generator.nodeName, true)
                }
            }}>Force bake</Button>
        </ButtonGroup>
    </Card>
}

function MaterialsPanel() {
    const manager = useManagerVersion()
    const materials = collectMaterials(manager.get().scene.modelRoot)
    return <ResourceList values={materials} empty="No materials"/>
}

function TexturesPanel() {
    const manager = useManagerVersion()
    const textures = collectTextures(collectMaterials(manager.get().scene.modelRoot))
    return <ResourceList values={textures} empty="No textures"/>
}

function GeometriesPanel() {
    const manager = useManagerVersion()
    const geometries = collectGeometries(manager.get().scene.modelRoot)
    return <ResourceList values={geometries} empty="No geometries"/>
}

function ResourceList({values, empty}: {values: Exclude<SelectionObject, IObject3D | null>[], empty: string}) {
    const manager = useManagerVersion()
    return <div className="editor-panel-body">
        {values.length ? <ul className="resource-list">{values.map((value) => <li key={value.uuid}>
            <Button
                minimal
                small
                text={value.name || value.uuid}
                onClick={() => manager.get().getPlugin(PickingPlugin)?.setSelectedObject(value)}
            />
        </li>)}</ul>
            : <p className="empty-panel-message">{empty}</p>}
    </div>
}

function ScenePanel() {
    const manager = useManagerVersion()
    const viewer = manager.get()
    return <div className="editor-panel-body">
        <h3>{manager.scenePath}</h3>
        <p>{viewer.scene.modelRoot.children.length} root objects</p>
        <p>Camera: {viewer.scene.mainCamera.name || 'Default camera'}</p>
        {viewer.scene.uiConfig && <ConfigObject
            config={viewer.scene.uiConfig}
            openPanel={() => undefined}
            closePanel={() => undefined}
        />}
    </div>
}

function TimelinePanel() {
    const manager = useManagerVersion()
    const timeline = manager.get().timeline
    const [time, setTime] = useState(timeline.time)
    useEffect(() => {
        const update = () => setTime(timeline.time)
        timeline.addEventListener('update', update)
        timeline.addEventListener('reset', update)
        return () => {
            timeline.removeEventListener('update', update)
            timeline.removeEventListener('reset', update)
        }
    }, [timeline])
    return <div className="timeline-panel editor-panel-body">
        <ButtonGroup>
            <Button icon="play" small onClick={() => timeline.start()}>Play</Button>
            <Button icon="stop" small onClick={() => timeline.stop()}>Stop</Button>
            <Button icon="reset" small onClick={() => timeline.reset()}>Reset</Button>
        </ButtonGroup>
        <Slider
            min={0}
            max={Math.max(timeline.endTime, 10)}
            stepSize={0.01}
            labelStepSize={0}
            value={time}
            onChange={(value) => {
                timeline.time = value
                setTime(value)
            }}
        />
    </div>
}

function ProjectPanel() {
    const manager = useManagerVersion()
    const scripts = manager.project?.config.scripts || []
    const plugins = manager.project?.config.plugins || []
    return <div className="editor-panel-body project-panel">
        <h3>Scripts</h3>
        <ul>{scripts.map(({import: path}) => <li key={path}>{path}</li>)}</ul>
        <h3>Plugins</h3>
        <ul>{plugins.map(({import: path, className}) => <li key={`${path}:${className || ''}`}>{path}{className ? `:${className}` : ''}</li>)}</ul>
        <h3>Component types</h3>
        <ul data-testid="component-types">{manager.componentTypes.map((type) => <li key={type}>{type}</li>)}</ul>
    </div>
}

function SettingsPanel() {
    const manager = useManagerVersion()
    return <div className="editor-panel-body settings-panel">
        <h3>Viewport</h3>
        <ButtonGroup vertical fill>
            <Button icon="locate" onClick={() => manager.get().getPlugin(EditModePlugin)?.resetView()}>Reset camera</Button>
            <Button icon="camera" onClick={() => void manager.snapshot()}>Snapshot PNG</Button>
            <Button icon="export" onClick={() => void manager.exportGltf()}>Export text glTF</Button>
        </ButtonGroup>
        <h3>Scene</h3>
        <p>Saved through the Blitz deterministic scene serializer.</p>
    </div>
}

function ViewportControls() {
    const manager = useManagerVersion()
    const viewer = manager.get()
    const [grid, setGrid] = useState(true)
    const [transform, setTransform] = useState(true)
    const [widgets, setWidgets] = useState(true)
    const [editing, setEditing] = useState(true)
    const [camera, setCamera] = useState<'perspective' | 'orthographic' | 'default'>('perspective')
    const edit = viewer.getPlugin(EditModePlugin)
    return <>
        <div className="interactionControlsButtonContainer">
            <ButtonGroup>
            <Button
                minimal
                icon="move"
                active={transform}
                title="Transform controls"
                onClick={() => {
                    const next = !transform
                    setTransform(next)
                    const plugin = viewer.getPlugin(TransformControlsPlugin)
                    next ? plugin?.enable(ViewportControls) : plugin?.disable(ViewportControls)
                }}
            />
            <Button minimal icon="grid" active={grid} title="Grid" onClick={() => {
                const next = !grid
                setGrid(next)
                edit?.toggleGrid(grid, next)
            }}/>
            <Button minimal icon="widget" active={widgets} title="Widgets" onClick={() => {
                const next = !widgets
                setWidgets(next)
                const plugin = viewer.getPlugin(EditorViewWidgetPlugin)
                if (plugin) plugin.enabled = next
            }}/>
            <Button minimal icon="locate" title="Reset camera" onClick={() => edit?.resetView()}/>
            <Popover content={<CameraSelectionMenu currentCamera={camera} setCurrentCamera={setCamera}/>} placement="bottom">
                <Button minimal icon="video" title="Select camera"/>
            </Popover>
            <Button minimal icon="camera" title="Snapshot" onClick={() => {
                void viewer.getPlugin(CanvasSnapshotPlugin)?.downloadSnapshot('blitz-snapshot.png', {waitForProgressive: false})
            }}/>
            <Button minimal icon="fullscreen" title="Fullscreen" onClick={() => {
                void viewer.container.parentElement?.requestFullscreen()
            }}/>
            </ButtonGroup>
        </div>
        <div className="interactionControlsButtonContainer" style={{right: 'var(--pt-grid-size)', left: 'unset'}}>
            <ButtonGroup>
                <Button minimal icon="edit" title="Edit mode" active={editing} onClick={() => {
                    edit?.enable(ViewportControls)
                    setEditing(true)
                }}/>
                <Button minimal icon="eye-open" title="Preview mode" active={!editing} onClick={() => {
                    edit?.disable(ViewportControls)
                    setEditing(false)
                }}/>
            </ButtonGroup>
        </div>
    </>
}

function objectIcon(object: IObject3D) {
    if (object.isCamera) return 'camera'
    if (object.isLight) return 'flash'
    if (object.isMesh) return 'cube'
    if (object.isScene) return 'layers'
    return 'folder-close'
}

function collectMaterials(root: IObject3D): IMaterial[] {
    const found = new Map<string, IMaterial>()
    root.traverse((object) => {
        const material = object.material
        for (const item of Array.isArray(material) ? material : material ? [material] : []) found.set(item.uuid, item)
    })
    return [...found.values()]
}

function collectGeometries(root: IObject3D): IGeometry[] {
    const found = new Map<string, IGeometry>()
    root.traverse((object) => {
        if (object.geometry) found.set(object.geometry.uuid, object.geometry)
    })
    return [...found.values()]
}

function collectTextures(materials: IMaterial[]): ITexture[] {
    const found = new Map<string, ITexture>()
    for (const material of materials) {
        for (const value of Object.values(material)) {
            const texture = value as ITexture | undefined
            if (texture?.isTexture) found.set(texture.uuid, texture)
        }
    }
    return [...found.values()]
}
