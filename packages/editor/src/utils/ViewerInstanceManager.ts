import {
    AssetExporterPlugin,
    CanvasSnapshotPlugin,
    EditorViewWidgetPlugin,
    EntityComponentPlugin,
    EventDispatcher,
    GBufferPlugin,
    GLTFAnimationPlugin,
    GLTFMeshOptDecodePlugin,
    KTX2LoadPlugin,
    KTXLoadPlugin,
    Object3DGeneratorPlugin,
    Object3DWidgetsPlugin,
    PickingPlugin,
    PLYLoadPlugin,
    PopmotionPlugin,
    Rhino3dmLoadPlugin,
    STLLoadPlugin,
    ThreeViewer,
    TransformControlsPlugin,
    USDZLoadPlugin,
    type Class,
    type IMaterial,
    type IObject3D,
    type ITexture,
    type IViewerPlugin,
    PhysicalMaterial,
    UnlitMaterial,
} from 'threepipe'
import {
    CannonPhysicsPlugin,
    createGame,
    findRemovedGeneratorNodes,
    HtmlUiComponent,
    isDependencyModuleSpecifier,
    assetUrlPrefix,
    createProjectAssetURLModifier,
    parseAssetsJSONManifest,
    parsePackageJSON,
    parsePackageJsonSettingsConfig,
    registerScripts,
    removedGeneratorMessage,
    RUNTIME_VERSION,
    RuntimeNestedAssetLoader,
    serializeSceneGltf,
    validateSceneSource,
    type AssetsJSONManifest,
    type CreatedGame,
    type ExternalPlugin,
    type ProjectConfigSettings,
    type ProjectPackageJSON,
    type SerializedSceneGltf,
} from '@kite3d/engine'
import {AppToaster} from 'uiconfig-blueprint/lib/esm/lib'
import {GeometryGeneratorPlugin} from '@threepipe/plugin-geometry-generator'
import {DevServerSource} from '../DevServerSource.ts'
import {ProjectConflictError, type ProjectEvent, type ProjectFileEntry} from '../ProjectSource.ts'
import {BlueprintJsUiPlugin2} from '../UiConfigRendererBlueprint2.tsx'
import {EditModePlugin} from './EditModePlugin.ts'
import {EditorFeatures} from './EditorFeatures.ts'
import {FileTracker} from './FileTracker.ts'
import {DevServerAssetTracker} from '../adapters/DevServerAssetTracker.ts'
import {writeEditorState, type EditorState} from './editorState.ts'
import {CanvasFileDropHandler} from './CanvasFileDropHandler.tsx'
import {cloneAssetItem} from './AssetTracker.ts'

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
const encode = (text: string) => new TextEncoder().encode(text)
const assetInstanceProperties = ['visible', 'name', 'position', 'quaternion', 'scale']
const stoppedEditorFrameIntervalMs = 1000 / 15

/**
 * Describes the project currently loaded by the editor.
 * Editor panels read it to display project identity and configuration.
 */
export interface LoadedProject {
    name: string
    path: string
    file: string
    mainScene: string
    packageJson: ProjectPackageJSON
    config: ProjectConfigSettings
}

/**
 * Identifies the project file open on the editing surface.
 * File and inspector panels read it to coordinate their selection.
 */
export interface LoadedProjectFile {
    path: string
}

interface ServerState {
    name: string
    versions: Record<string, string>
}

interface ManagerEventMap {
    stateChange: object
    loadedNeedsSaveChange: object
    projectFileChange: {
        path: string
        sha256?: string
        changeType: ProjectEvent['type']
    }
}

/**
 * Reports whether a configured module loaded and why it did not.
 * Project settings rows read it to render module status.
 */
export interface ProjectLoadStatus {
    kind: 'loaded' | 'resolved' | 'error' | 'disabled'
    text: string
}

type ModuleExports = Record<string, unknown>
/**
 * Lists the file kinds the project browser can create.
 * Creation menus pass these values to the manager.
 */
export type ProjectEntryKind = 'scene' | 'asset' | 'physical-material' | 'unlit-material'
    | 'plugin' | 'script' | 'json' | 'folder'

/** Owns the persistent edit viewer and the disposable published-game viewer. */
export class ViewerInstanceManager extends EventDispatcher<ManagerEventMap> {
    /**
     * Provides authenticated project file and server operations.
     * Manager workflows use it as their persistence boundary.
     */
    readonly source: DevServerSource
    /**
     * Tracks the latest content hash for each known project file.
     * Save and reload paths read it for conflict-safe writes.
     */
    readonly hashes = new Map<string, string>()
    /** Reference feature controller, backed by Kite3D's persistent edit viewer. */
    readonly features = new EditorFeatures(this)
    /** AGREED-4: expose DevServerSource blobs through the reference Memory surface. */
    readonly fileTracker = new FileTracker()

    /**
     * Holds the persistent authoring viewer when it has been created.
     * Viewport and inspector components read it through `get()`.
     */
    viewer?: ThreeViewer
    /**
     * Holds the disposable game used while Play is active.
     * Play controls and screenshot capture read its viewer.
     */
    game?: CreatedGame
    /**
     * Contains parsed metadata for the active project.
     * Project and module panels read its settings.
     */
    project?: LoadedProject
    /**
     * Lists files currently exposed by the project server.
     * File browsers and import naming logic read it.
     */
    manifest: ProjectFileEntry[] = []
    /**
     * Lists project directories, including empty ones.
     * The file browser reads it to build its tree.
     */
    directoryManifest: string[] = []
    /**
     * Maps stable asset identifiers to project files.
     * Importers and asset panels read it to resolve asset URLs.
     */
    assetsManifest: AssetsJSONManifest = {version: 1, files: {}}
    /**
     * Stores the loaded scene source text.
     * Scene summary and removed-generator reporting read it.
     */
    sceneText = ''
    /**
     * Identifies the scene currently open for editing.
     * Save and scene summary surfaces read it.
     */
    scenePath = 'assets/main.scene.gltf'
    /**
     * Records legacy Generator nodes found in the scene source.
     * Inspector surfaces read it to explain unsupported nodes.
     */
    removedGeneratorNodes: Array<{nodeIndex: number, nodeName: string}> = []
    /**
     * Lists component and plugin types registered from project scripts.
     * The Inspector component picker reads it.
     */
    componentTypes: string[] = []
    /**
     * Reports load state for each configured project script.
     * Project settings rows read these entries.
     */
    scriptLoadStatuses = new Map<string, ProjectLoadStatus>()
    /**
     * Reports load state for each configured project plugin.
     * Project settings rows read these entries.
     */
    pluginLoadStatuses = new Map<string, ProjectLoadStatus>()
    /**
     * Contains the latest user-facing editor activity message.
     * Toolbar hooks and status surfaces read it.
     */
    status = 'Loading project…'
    /**
     * Contains the latest project error and stack when available.
     * Toolbar hooks render it for the user.
     */
    error?: string
    /**
     * Indicates that project metadata and the scene finished loading.
     * State persistence and editor surfaces read it.
     */
    projectLoaded = false
    /**
     * Indicates that the disposable game is running.
     * Play controls, state writes, and screenshots read it.
     */
    isPlaying = false
    /**
     * Indicates that Play startup is still in progress.
     * Play controls and reload flows read it.
     */
    isStartingPlay = false
    /**
     * Controls whether the welcome dialog is visible.
     * Welcome and project-picker components read it.
     */
    welcomeOpen = false
    /**
     * Exposes the file open on the editing surface.
     * Inspector and asset components read it.
     */
    loadedProjectFile: LoadedProjectFile | null = null
    /**
     * Holds the path when the open file is a scene.
     * Save controls and editor layout read it.
     */
    loadedScene: string | null = null
    /**
     * Holds the object or material opened outside a scene.
     * Asset inspector and save actions read it.
     */
    loadedAssetObj: IObject3D | IMaterial | null = null
    /**
     * Holds the URL of the file currently displayed.
     * Source and asset panels read it for context.
     */
    loadedPath: string | null = null
    /**
     * Tracks the file selected in the project browser.
     * Selection restoration and inspector panels read it.
     */
    selectedFilePath: string | null = null

    // Tracks whether the current authoring surface differs from its saved file.
    private _loadedNeedsSave = false
    // Tracks unsaved text in the source editor independently of scene edits.
    private _sourceDraftDirty = false
    // Stores the semantic hash of the last scene written or loaded from disk.
    private savedSceneHash: string | null = null
    // Deduplicates concurrent initialization requests.
    private initializing?: Promise<void>
    // Deduplicates concurrent Play startup requests.
    private playPromise?: Promise<void>
    // Resolves consumers waiting for the initial project load.
    private readyResolve!: () => void
    // Rejects consumers when the initial project load fails.
    private readyReject!: (error: unknown) => void
    // Signals when the initial project load has completed.
    private readonly ready = new Promise<void>((resolve, reject) => {
        this.readyResolve = resolve
        this.readyReject = reject
    })
    // Removes the active project-event subscription during disposal.
    private unsubscribe?: () => void
    // Holds the editor-state heartbeat timer.
    private heartbeat?: ReturnType<typeof setInterval>
    // Identifies the viewer currently governed by the idle frame cap.
    private idleFrameViewer?: ThreeViewer
    // Records whether the edit viewer rendered work in the current frame.
    private editViewerUpdatedThisFrame = false
    // Holds the overlay canvas supplied by the Play controls.
    private playCanvas?: HTMLCanvasElement
    // Rewrites nested project asset URLs for the active manifest.
    private assetUrlModifier?: (url: string) => string
    // Loads and disposes nested asset dependencies for the edit viewer.
    private nestedAssets?: RuntimeNestedAssetLoader
    // Suppresses dirty tracking while scene loading mutates the viewer.
    private loadingScene = false
    // Suppresses dirty tracking while scene serialization writes files.
    private savingScene = false
    // Stores recent error timestamps for console forwarding rate limits.
    private consoleErrorTimes: number[] = []
    // Produces unique revisions for hot-reloaded module graphs.
    private moduleReloadSequence = 0
    // Carries the current hot-reload revision into project imports.
    private moduleRevision?: string
    // Prevents duplicate warnings for the same removed Generator node.
    private readonly reportedRemovedGenerators = new Set<string>()
    // Serializes writes to the project console log.
    private consoleWriteQueue: Promise<void> = Promise.resolve()
    // Serializes writes to the editor state file.
    private stateWriteQueue: Promise<void> = Promise.resolve()
    // Preserves the browser console error implementation for disposal.
    private originalConsoleError?: typeof console.error
    // Preserves the browser console warning implementation for disposal.
    private originalConsoleWarn?: typeof console.warn
    // Records the editor runtime version reported in state files.
    private editorVersion = RUNTIME_VERSION
    // Forwards uncaught window errors into project feedback.
    private readonly onWindowError = (event: ErrorEvent) => {
        if (isBenignResizeObserverError(event.message)) return
        void this.reportError(event.error || event.message)
    }
    // Forwards unhandled promise rejections into project feedback.
    private readonly onUnhandledRejection = (event: PromiseRejectionEvent) => void this.reportError(event.reason)
    // Stops activity and writes state before the page is hidden.
    private readonly onPageHide = () => {
        this.isPlaying = false
        this.isStartingPlay = false
        this.stopHeartbeat()
        void this.writeState()
    }
    // Resets per-frame edit viewer activity tracking.
    private readonly onEditViewerPreFrame = () => {
        this.editViewerUpdatedThisFrame = false
    }
    // Marks active edit frames and wakes the capped viewer when needed.
    private readonly onEditViewerUpdate = () => {
        this.editViewerUpdatedThisFrame = true
        if (this.idleFrameViewer) {
            this.idleFrameViewer.renderManager.frameWaitTime = document.hidden
                ? Number.POSITIVE_INFINITY
                : 0
        }
    }
    // Applies the idle frame interval after each edit viewer frame.
    private readonly onEditViewerPostFrame = () => {
        if (!this.idleFrameViewer) return
        this.idleFrameViewer.renderManager.frameWaitTime = document.hidden
            ? Number.POSITIVE_INFINITY
            : this.editViewerUpdatedThisFrame ? 0 : stoppedEditorFrameIntervalMs
    }
    // Suspends hidden rendering and wakes the viewer when visible again.
    private readonly onVisibilityChange = () => {
        if (!this.idleFrameViewer) return
        if (document.hidden) {
            this.idleFrameViewer.renderManager.frameWaitTime = Number.POSITIVE_INFINITY
            return
        }
        this.idleFrameViewer.renderManager.frameWaitTime = 0
        this.idleFrameViewer.setDirty()
    }

    /**
     * Creates a manager backed by one development server source.
     * The editor bootstrap constructs it and providers expose it to panels.
     */
    constructor(source: DevServerSource) {
        super()
        this.source = source
    }

    /**
     * Exposes the active project through reference editor props.
     * Project-aware components read this derived compatibility surface.
     */
    get loadedProject(): LoadedProject | null {
        return this.project ?? null
    }

    /**
     * Reports whether the open scene or asset needs saving.
     * Save controls and close guards read it.
     */
    get loadedNeedsSave() {
        return this._loadedNeedsSave
    }

    /**
     * Updates the save-needed state and notifies editor consumers.
     * Scene and asset mutation paths write it.
     */
    set loadedNeedsSave(value: boolean) {
        if (this._loadedNeedsSave === value) return
        this._loadedNeedsSave = value
        this.dispatchEvent({type: 'loadedNeedsSaveChange'})
        this.changed()
        if (this.projectLoaded) void this.writeState()
    }

    /**
     * Reports whether the source editor has unsaved text.
     * Publish and export guards read it.
     */
    get sourceDraftDirty() {
        return this._sourceDraftDirty
    }

    /**
     * Updates source-draft state after text editor changes.
     * The source editor calls it as drafts are edited or saved.
     */
    setSourceDraftDirty(value: boolean) {
        if (this._sourceDraftDirty === value) return
        this._sourceDraftDirty = value
        this.changed()
        if (this.projectLoaded) void this.writeState()
    }

    /**
     * Selects a project file and clears any object selection.
     * File browser interactions call it.
     */
    selectFile(path: string) {
        this.selectedFilePath = path
        this.get().getPlugin(PickingPlugin)?.setSelectedObject(null)
        this.changed()
    }

    /**
     * Returns the persistent authoring viewer, creating it on first use.
     * Editor components call it whenever they need the active viewer.
     */
    get(): ThreeViewer {
        if (!this.viewer) this.viewer = this.createEditViewer()
        return this.viewer
    }

    /**
     * Loads the project and installs server and browser listeners once.
     * Editor bootstrap calls it before rendering project surfaces.
     */
    initialize(): Promise<void> {
        if (this.initializing) return this.initializing
        this.initializing = this.loadProject().then(() => {
            this.readyResolve()
        }).catch(async (error) => {
            this.readyReject(error)
            await this.reportError(error)
            throw error
        })
        this.unsubscribe = this.source.events((event) => {
            void this.onProjectEvent(event).catch((error) => this.reportError(error))
        })
        this.installErrorForwarding()
        window.addEventListener('pagehide', this.onPageHide)
        return this.initializing
    }

    /**
     * Reloads project metadata, manifests, modules, and the main scene.
     * Initialization and project-reload flows call it.
     */
    async loadProject(): Promise<void> {
        this.setStatus('Loading project…')
        const [serverState, entries, packageFile, directories] = await Promise.all([
            this.source.state() as unknown as Promise<ServerState>,
            this.source.list(),
            this.source.read('package.json'),
            this.source.listDirectories(),
        ])
        this.directoryManifest = directories
        const assetsFile = entries.some(({path}) => path === 'assets.json')
            ? await this.source.read('assets.json')
            : undefined
        this.replaceManifest(entries)
        this.hashes.set('package.json', packageFile.sha256)
        if (assetsFile) this.hashes.set('assets.json', assetsFile.sha256)
        else this.hashes.delete('assets.json')

        const packageJson = parsePackageJSON(decode(packageFile.bytes))
        const config = await parsePackageJsonSettingsConfig(packageJson)
        const assetsManifest = assetsFile
            ? parseAssetsJSONManifest(decode(assetsFile.bytes))
            : {version: 1, files: {}}
        this.assetsManifest = assetsManifest
        const scenePath = packageJson.mainScene
        const scene = await this.source.read(scenePath)
        const sceneText = decode(scene.bytes)
        validateSceneSource(scenePath, sceneText)
        this.hashes.set(scenePath, scene.sha256)
        const memoryPath = scenePath.replace(/\.gltf$/, '.glb')
        this.fileTracker.updateFile(memoryPath, new File(
            [scene.bytes as BlobPart],
            memoryPath.split('/').pop() || memoryPath,
            {type: 'model/gltf+json'},
        ))

        this.editorVersion = serverState.versions.editor || RUNTIME_VERSION
        this.project = {
            name: serverState.name,
            path: '/',
            file: 'package.json',
            mainScene: scenePath,
            packageJson,
            config,
        }
        this.loadedProjectFile = {path: scenePath}
        this.loadedScene = scenePath
        this.loadedPath = this.source.fileUrl(scenePath)
        this.scenePath = scenePath
        this.sceneText = sceneText
        this.removedGeneratorNodes = findRemovedGeneratorNodes(sceneText)

        await this.prepareEditViewer(config, assetsManifest)
        await this.loadEditScene(sceneText)
        // AGREED-4: attach the reference registry after the project scene is
        // loaded so the scene itself remains a blob, not a reusable asset.
        this.get().assetManager.tracker = new DevServerAssetTracker()
        this.projectLoaded = true
        this.loadedNeedsSave = false
        this.setStatus('Project loaded')
        await this.writeState()
        this.startHeartbeat()
    }

    private createEditViewer(): ThreeViewer {
        const container = document.createElement('div')
        Object.assign(container.style, {
            width: '100%',
            height: '100%',
            maxWidth: '100%',
            maxHeight: '100%',
            display: 'block',
            position: 'relative',
            zIndex: '0',
        })
        document.body.append(container)
        const entityComponents = new EntityComponentPlugin(false)
        const physics = new CannonPhysicsPlugin(true, false)
        const transformControls = new TransformControlsPlugin(true)
        physics.running = false
        EntityComponentPlugin.AddObjectUiConfig = false

        const viewer = new ThreeViewer({
            container,
            debug: true,
            rgbm: false,
            msaa: true,
            zPrepass: false,
            renderScale: 'auto',
            assetManager: {simpleCache: false, storage: false},
            // AGREED-4: retain the reference settings row while the parent
            // DevServerSource drop adapter owns persistence and registration.
            dropzone: {autoImport: false},
            plugins: [],
        })
        viewer.canvas.style.width = '100%'
        viewer.canvas.style.height = '100%'
        viewer.assetManager.importer.autoSetName = false
        viewer.assetManager.importer.cacheImportedAssets = false
        viewer.addPluginSync(BlueprintJsUiPlugin2)
        viewer.addPluginsSync([
            entityComponents,
            new GBufferPlugin(),
            physics,
            new PopmotionPlugin(),
            new CanvasFileDropHandler(this),
            new GLTFAnimationPlugin(),
            new GLTFMeshOptDecodePlugin(true, document.head),
            new KTX2LoadPlugin(),
            new KTXLoadPlugin(),
            new PLYLoadPlugin(),
            new Rhino3dmLoadPlugin(),
            new STLLoadPlugin(),
            new USDZLoadPlugin(),
            new PickingPlugin(undefined, false),
            transformControls,
            new EditorViewWidgetPlugin('bottom-right', 100),
            new Object3DWidgetsPlugin(true),
            new Object3DGeneratorPlugin(),
            new GeometryGeneratorPlugin(),
            new CanvasSnapshotPlugin(),
            new AssetExporterPlugin(),
        ])
        transformControls.transformControls?.traverse((object) => {
            const material = (object as IObject3D).material
            const materials = Array.isArray(material) ? material : material ? [material] : []
            for (const item of materials) {
                item.userData.renderToGBuffer = false
                item.userData.renderToDepth = false
            }
        })
        viewer.addPluginSync(EditModePlugin)
        entityComponents.addComponentType(HtmlUiComponent)
        viewer.getPlugin(GLTFAnimationPlugin)!.autoIncrementTime = false
        viewer.timeline.endTime = 0
        viewer.scene.addEventListener('sceneUpdate', this.onEditSceneUpdate)
        this.attachIdleFrameCap(viewer)
        this.nestedAssets = new RuntimeNestedAssetLoader(viewer, (error) => void this.reportError(error))
        ;(window as Window & {viewer?: ThreeViewer}).viewer = viewer
        return viewer
    }

    private attachIdleFrameCap(viewer: ThreeViewer) {
        this.detachIdleFrameCap()
        this.idleFrameViewer = viewer
        viewer.addEventListener('preFrame', this.onEditViewerPreFrame)
        viewer.addEventListener('update', this.onEditViewerUpdate)
        viewer.addEventListener('postFrame', this.onEditViewerPostFrame)
        document.addEventListener('visibilitychange', this.onVisibilityChange)
    }

    private detachIdleFrameCap() {
        if (!this.idleFrameViewer) return
        this.idleFrameViewer.removeEventListener('preFrame', this.onEditViewerPreFrame)
        this.idleFrameViewer.removeEventListener('update', this.onEditViewerUpdate)
        this.idleFrameViewer.removeEventListener('postFrame', this.onEditViewerPostFrame)
        this.idleFrameViewer.renderManager.frameWaitTime = 0
        document.removeEventListener('visibilitychange', this.onVisibilityChange)
        this.idleFrameViewer = undefined
    }

    private async prepareEditViewer(config: ProjectConfigSettings, assetsManifest: AssetsJSONManifest) {
        const viewer = this.get()
        const base = new URL('/files/', location.origin)

        const configuredCamera = config.viewer.camera
        if (configuredCamera) {
            const camera = viewer.scene.defaultCamera
            if (configuredCamera.position) camera.position.fromArray(configuredCamera.position)
            if (configuredCamera.target) camera.target.fromArray(configuredCamera.target)
            if (configuredCamera.controlsMode !== undefined) camera.controlsMode = configuredCamera.controlsMode
            camera.setDirty()
        }
        if (config.viewer.backgroundColor !== undefined) {
            viewer.scene.setBackgroundColor(config.viewer.backgroundColor)
        }

        if (this.assetUrlModifier) viewer.assetManager.importer.removeURLModifier(this.assetUrlModifier)
        this.assetUrlModifier = createProjectAssetURLModifier(base, assetsManifest)
        viewer.assetManager.importer.addURLModifier(this.assetUrlModifier)

        await this.registerProjectPlugins(config)
        await this.registerProjectScripts(config)
    }

    private async registerProjectPlugins(config: ProjectConfigSettings) {
        const viewer = this.get()
        const statuses = new Map<string, ProjectLoadStatus>()
        this.pluginLoadStatuses = statuses
        for (const [index, definition] of config.plugins.entries()) {
            const key = pluginStatusKey(definition, index)
            if (definition.active === false) {
                statuses.set(key, {kind: 'disabled', text: 'Disabled'})
                continue
            }
            try {
                const module = await this.importProjectModule(definition.import)
                const plugin = findPluginExport(module, definition)
                if (!viewer.getPlugin(plugin)) await viewer.addPlugin(plugin, ...(definition.params || []))
                statuses.set(key, {kind: 'resolved', text: 'Resolved'})
            } catch (error) {
                statuses.set(key, await this.moduleErrorStatus(error, definition.import))
                await this.reportError(error)
            }
        }
        this.changed()
    }

    private async registerProjectScripts(config: ProjectConfigSettings, moduleRevision = this.moduleRevision) {
        const modules: ModuleExports[] = []
        const statuses = new Map<string, ProjectLoadStatus>()
        this.scriptLoadStatuses = statuses
        for (const definition of config.scripts) {
            if (definition.active === false) {
                statuses.set(definition.import, {kind: 'disabled', text: 'Disabled'})
                continue
            }
            try {
                modules.push(await this.importProjectModule(definition.import, moduleRevision))
                statuses.set(definition.import, {kind: 'loaded', text: 'Loaded'})
            } catch (error) {
                statuses.set(definition.import, await this.moduleErrorStatus(error, definition.import))
                await this.reportError(error)
            }
        }
        try {
            const registered = await registerScripts(this.get(), modules)
            this.componentTypes = [
                ...registered.components.map(({value}) => value.ComponentType),
                ...registered.plugins.map(({value}) => (value as unknown as {PluginType: string}).PluginType),
            ].filter((value, index, values) => values.indexOf(value) === index).sort()
        } catch (error) {
            const status = projectModuleErrorStatus(error)
            for (const [path, current] of statuses) {
                if (current.kind === 'loaded') statuses.set(path, status)
            }
            await this.reportError(error)
        }
        this.changed()
    }

    private async moduleErrorStatus(error: unknown, path: string): Promise<ProjectLoadStatus> {
        if (this.project && !isDependencyModuleSpecifier(path, this.project.packageJson)) {
            try {
                const source = decode((await this.source.read(normalizeProjectPath(path))).bytes)
                return projectModuleErrorStatus(error, path, source)
            } catch { /* use the import error without source context */ }
        }
        return projectModuleErrorStatus(error, path)
    }

    private importProjectModule(path: string, moduleRevision = this.moduleRevision): Promise<ModuleExports> {
        if (this.project && isDependencyModuleSpecifier(path, this.project.packageJson)) {
            return import(/* @vite-ignore */ path) as Promise<ModuleExports>
        }
        const normalized = normalizeProjectPath(path)
        return import(
            /* @vite-ignore */ this.source.fileUrl(normalized, this.hashes.get(normalized), moduleRevision)
        ) as Promise<ModuleExports>
    }

    private async loadEditScene(sceneText: string) {
        const viewer = this.get()
        this.loadingScene = true
        try {
            viewer.getPlugin(EditModePlugin)?.exitIsolate()
            viewer.scene.disposeSceneModels(true, true)
            viewer.scene.disposeTextures(true)
            const loaded = await viewer.load(this.source.fileUrl(this.scenePath, this.hashes.get(this.scenePath)), {
                importAsModelRoot: true,
            })
            if (!loaded?.isObject3D) throw new Error(`The main scene did not load as an Object3D: ${this.scenePath}`)
            await this.nestedAssets?.loadObjectDependencies(loaded as IObject3D)
            await this.nestedAssets?.waitForPending()
            this.sceneText = sceneText
            this.removedGeneratorNodes = findRemovedGeneratorNodes(sceneText)
            await this.reportRemovedGenerators()
            this.error = undefined
            const editMode = viewer.getPlugin(EditModePlugin)
            const savedCamera = this.project?.config.viewer.camera ? viewer.scene.defaultCamera : undefined
            if (editMode && savedCamera) {
                editMode.cameraMode = this.project?.config.viewer.camera?.type === 'orthographic'
                    ? 'orthographic'
                    : 'perspective'
                const editCamera = editMode.cameraMode === 'orthographic'
                    ? editMode.cameraOrtho
                    : editMode.cameraPerspective
                editCamera.position.copy(savedCamera.position)
                editCamera.quaternion.copy(savedCamera.quaternion)
                editCamera.target.copy(savedCamera.target)
                editCamera.setDirty({change: 'transform'})
            } else {
                editMode?.fitView()
            }
            this.savedSceneHash = await hashBytes((await serializeSceneGltf(viewer, {scenePath: this.scenePath})).gltf)
            // AGREED-4: DevServerSource reloads may finish with renderer updates queued for the next frame.
            // Keep the load guard raised until those updates settle so a disk reload is not reported as an edit.
            await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
            this.loadedNeedsSave = false
        } finally {
            this.loadingScene = false
            this.changed()
        }
    }

    // Marks authored scene mutations dirty outside load and save windows.
    private onEditSceneUpdate = (event: {object?: IObject3D}) => {
        if (!this.loadingScene && !this.savingScene && event.object) {
            this.loadedNeedsSave = true
        }
        this.changed()
    }

    /**
     * Persists the open scene when authored state has changed.
     * Save controls, Play startup, and publish preparation call it.
     */
    async saveScene(): Promise<boolean> {
        if (!this.projectLoaded || !this.loadedScene || !this.loadedNeedsSave) return true
        this.savingScene = true
        this.setStatus('Saving scene…')
        try {
            const viewer = this.get()
            const editMode = viewer.getPlugin(EditModePlugin)!
            const serialized = await editMode.withIsolateVisibilityRestored(
                () => serializeSceneGltf(viewer, {scenePath: this.scenePath}),
            )
            await this.writeSerializedScene(serialized)
            this.loadedNeedsSave = false
            await this.writeState()
            this.setStatus('Scene saved')
            return true
        } catch (error) {
            if (!(error instanceof ProjectConflictError)) {
                await this.reportError(error)
                return false
            }
            const disk = await this.source.read(this.scenePath)
            if (window.confirm('The scene changed on disk. Reload the disk version?')) {
                this.hashes.set(this.scenePath, disk.sha256)
                const text = decode(disk.bytes)
                validateSceneSource(this.scenePath, text)
                await this.loadEditScene(text)
                this.setStatus('Reloaded scene from disk')
            } else {
                this.setStatus('Kept unsaved editor scene')
            }
            return false
        } finally {
            this.savingScene = false
        }
    }

    private async writeSerializedScene(serialized: SerializedSceneGltf) {
        for (const file of serialized.files) {
            const result = await this.source.write(file.path, file.bytes, this.hashes.get(file.path) || '*')
            this.hashes.set(file.path, result.sha256)
        }
        const binPath = this.scenePath.replace(/\.gltf$/i, '.bin')
        const binName = binPath.split('/').pop()
        const keepsBin = (serialized.document.buffers as Array<{uri?: string}> | undefined)
            ?.some(({uri}) => uri === binName)
        if (!keepsBin && this.hashes.has(binPath)) {
            await this.source.delete(binPath)
            this.hashes.delete(binPath)
        }
        const result = await this.source.write(
            this.scenePath,
            serialized.gltf,
            this.hashes.get(this.scenePath) || '*',
        )
        this.hashes.set(this.scenePath, result.sha256)
        this.savedSceneHash = await hashBytes(serialized.gltf)
        this.sceneText = decode(serialized.gltf)
        this.removedGeneratorNodes = findRemovedGeneratorNodes(this.sceneText)
        this.manifest = await this.source.list()
        this.changed()
    }

    private async captureScreenshot(): Promise<Blob> {
        await this.ready
        if (this.playPromise) await this.playPromise
        const viewer = this.isPlaying ? this.game?.viewer : this.get()
        if (!viewer) throw new Error('The active editor viewer is unavailable.')
        if (viewer.canvas.width < 1 || viewer.canvas.height < 1
            || viewer.canvas.clientWidth < 1 || viewer.canvas.clientHeight < 1) {
            throw new Error('The editor canvas has zero size.')
        }

        let finished = false
        const frameWaitTime = viewer.renderManager.frameWaitTime
        const capture = viewer.getScreenshotBlob({mimeType: 'image/png'}).finally(() => {
            finished = true
        })
        const render = this.renderScreenshotOnDemand(viewer, () => finished)
        try {
            const blob = await Promise.race([capture, render.then(() => undefined)])
            if (!blob) throw new Error('The editor did not produce a screenshot.')
            return await compositeScreenshot(viewer.canvas)
        } finally {
            finished = true
            viewer.renderManager.frameWaitTime = document.hidden ? Number.POSITIVE_INFINITY : frameWaitTime
        }
    }

    private async renderScreenshotOnDemand(viewer: ThreeViewer, finished: () => boolean): Promise<void> {
        const deadline = performance.now() + 5_000
        await Promise.resolve()
        while (!finished()) {
            viewer.setDirty()
            viewer.renderManager.frameWaitTime = 0
            viewer.renderManager.animationLoop(performance.now())
            await new Promise<void>((resolveRender) => window.setTimeout(resolveRender, 0))
            if (performance.now() >= deadline) throw new Error('The editor screenshot render timed out.')
        }
    }

    /**
     * Starts the project game on the supplied overlay canvas.
     * Play controls call it and wait for startup to settle.
     */
    async startPlay(canvas: HTMLCanvasElement): Promise<void> {
        this.playCanvas = canvas
        this.get().getPlugin(EditModePlugin)?.exitIsolate()
        if (this.isPlaying) return
        if (this.playPromise) return this.playPromise
        const task = this.createPlayGame()
        this.playPromise = task
        try {
            await task
        } finally {
            if (this.playPromise === task) this.playPromise = undefined
        }
    }

    private async createPlayGame() {
        this.isStartingPlay = true
        this.changed()
        try {
            await this.ready
            if (this.loadedNeedsSave && !await this.saveScene()) return
            if (!this.playCanvas) return
            this.game?.dispose()
            this.game = undefined
            this.setStatus('Starting game…')
            await this.appendConsoleLine(`# Kite3D play log started ${new Date().toISOString()}; levels: console.warn, console.error, uncaught errors`, false)
            const entries = await this.source.list()
            const fileRevisions = Object.fromEntries(entries.map(({path, sha256}) => [path, sha256]))
            this.get().renderEnabled = false
            this.game = await createGame({
                base: new URL('/files/', location.origin).href,
                canvas: this.playCanvas,
                fileRevisions,
                moduleRevision: this.moduleRevision,
                onError: (error) => void this.reportError(error),
            })
            this.isPlaying = true
            this.startHeartbeat()
            this.setStatus('Playing')
            await this.writeState()
        } catch (error) {
            this.get().renderEnabled = true
            await this.reportError(error)
            await this.writeState(errorMessage(error))
        } finally {
            this.isStartingPlay = false
            this.changed()
        }
    }

    /**
     * Disposes the running game and restores the authoring viewer.
     * Stop controls and reload flows call it.
     */
    async stopPlay(): Promise<void> {
        this.game?.dispose()
        this.game = undefined
        this.isPlaying = false
        this.isStartingPlay = false
        this.playCanvas = undefined
        if (this.viewer) {
            this.viewer.renderEnabled = true
            this.viewer.setDirty()
        }
        this.setStatus('Stopped')
        await this.writeState()
    }

    private async restartPlay() {
        if (!this.isPlaying || !this.playCanvas) return
        const canvas = this.playCanvas
        this.game?.dispose()
        this.game = undefined
        this.isPlaying = false
        await this.startPlay(canvas)
    }

    /**
     * Stores dropped files and imports supported objects into the scene.
     * File-drop surfaces call it with browser File objects.
     */
    async importFiles(files: Iterable<File>) {
        for (const file of files) {
            const path = uniqueImportPath(file.name, this.manifest)
            const result = await this.source.write(path, new Uint8Array(await file.arrayBuffer()), '*')
            this.hashes.set(path, result.sha256)
            const assetId = await this.registerAsset(path)
            const rootPath = assetIdUrl(assetId, path)
            const imported = await this.get().assetManager.importer.import(rootPath)
            const loaded = imported.find((item) => item?.isObject3D)
            if (loaded?.isObject3D) {
                loaded.userData ||= {}
                delete loaded.userData.rootSceneModelRoot
                loaded.userData.rootPath = rootPath
                loaded.userData.kite3dImportedInstance = true
                loaded.userData.sProperties = [...assetInstanceProperties]
                loaded.name = file.name
                for (const child of loaded.children) child.userData.excludeFromExport = true
                await this.get().assetManager.loadImported(loaded, {
                    autoCenter: true,
                    importConfig: true,
                    autoScale: true,
                    autoScaleRadius: 2,
                    centerGeometries: false,
                    centerGeometriesKeepPosition: true,
                    clearSceneObjects: false,
                    disposeSceneObjects: false,
                    autoSetBackground: false,
                    autoSetEnvironment: true,
                })
                delete (loaded as IObject3D & {_tpRootPath?: string})._tpRootPath
                delete (loaded as IObject3D & {__rootPath?: string}).__rootPath
            }
            this.loadedNeedsSave = true
            this.setStatus(`Imported ${file.name}`)
        }
        this.replaceManifest(await this.source.list())
    }

    /**
     * Creates a project folder or starter file of the requested kind.
     * Project browser creation menus call it.
     */
    async createProjectEntry(path: string, kind: ProjectEntryKind): Promise<void> {
        if (kind === 'folder') {
            await this.source.createDirectory(path)
            this.directoryManifest = await this.source.listDirectories()
            this.changed()
            return
        }
        const bytes = projectEntryBytes(path, kind)
        const written = await this.source.write(path, bytes, '*')
        this.hashes.set(path, written.sha256)
        if (kind === 'plugin' || kind === 'script') await this.registerProjectModule(path, kind)
        this.replaceManifest(await this.source.list())
    }

    /**
     * Opens a scene, object, or material file on the editing surface.
     * Project file interactions call it.
     */
    async openProjectFile(path: string): Promise<void> {
        if (path === this.scenePath && this.loadedScene) return
        if (this.isPlaying || this.isStartingPlay) await this.stopPlay()
        if (/\.scene\.gltf$/i.test(path)) {
            const scene = await this.source.read(path)
            const text = decode(scene.bytes)
            validateSceneSource(path, text)
            this.scenePath = path
            this.hashes.set(path, scene.sha256)
            this.loadedProjectFile = {path}
            this.loadedScene = path
            this.loadedAssetObj = null
            this.loadedPath = this.source.fileUrl(path, scene.sha256)
            await this.loadEditScene(text)
            this.setStatus(`Opened ${path}`)
            return
        }
        if (!/\.(?:glb|gltf|mat)$/i.test(path)) throw new Error('Only scenes and 3D assets can be opened.')
        const asset = await this.getAssetFromPath(this.assetPathUrl(path))
        if (!asset || (!asset.isObject3D && !asset.isMaterial)) throw new Error(`Unable to open ${path}.`)
        const viewer = this.get()
        viewer.getPlugin(EditModePlugin)?.exitIsolate()
        viewer.scene.disposeSceneModels(true, true)
        if (asset.isObject3D) await viewer.assetManager.loadImported(asset, {
            autoCenter: true,
            importConfig: true,
            autoScale: true,
            autoScaleRadius: 2,
            clearSceneObjects: true,
            disposeSceneObjects: true,
        })
        this.loadedProjectFile = {path}
        this.loadedScene = null
        this.loadedAssetObj = asset as IObject3D | IMaterial
        this.loadedPath = this.assetPathUrl(path)
        this.loadedNeedsSave = false
        viewer.getPlugin(PickingPlugin)?.setSelectedObject(asset as IObject3D | IMaterial, false)
        this.setStatus(`Opened ${path}`)
        this.changed()
    }

    /**
     * Adds a registered project object asset to the open scene or object.
     * Asset browser import actions call it.
     */
    async importProjectAsset(path: string): Promise<IObject3D> {
        const loadedObject = this.loadedAssetObj as IObject3D | null
        if (!this.loadedScene && !loadedObject?.isObject3D) throw new Error('Open a scene or object asset before importing.')
        const source = await this.getAssetFromPath(this.assetPathUrl(path))
        if (!source?.isObject3D) throw new Error(`Unable to import ${path} as a 3D object.`)
        const object = cloneAssetItem(source as IObject3D)
        object.userData ||= {}
        object.userData.rootPath = this.assetPathUrl(path)
        object.userData.kite3dImportedInstance = true
        object.userData.sProperties = [...assetInstanceProperties]
        object.name = path.split('/').pop() || object.name
        for (const child of object.children) child.userData.excludeFromExport = true
        if (loadedObject?.isObject3D) loadedObject.add(object)
        else this.get().scene.addObject(object)
        this.get().getPlugin(PickingPlugin)?.setSelectedObject(object, false)
        this.loadedNeedsSave = true
        this.setStatus(`Imported ${path}`)
        return object
    }

    /**
     * Exports an authored object or material as a new project asset.
     * Reference asset controls call it and consume the returned replacement.
     */
    async saveNewProjectAsset(
        _project: LoadedProject,
        _scene: LoadedProjectFile | null,
        object: IObject3D | IMaterial,
    ): Promise<{path?: string, result?: IObject3D | IMaterial, error?: string}> {
        try {
            if (object.userData?.rootPath) return {error: 'This object is already an asset instance.'}
            const isObject = Boolean((object as IObject3D).isObject3D)
            const isMaterial = Boolean((object as IMaterial).isMaterial)
            if (!isObject && !isMaterial) return {error: 'Only objects and materials can become assets.'}
            const extension = isObject ? 'glb' : 'mat'
            const stem = safeFileStem(object.name || (isObject ? 'object' : 'material'))
            const path = uniqueProjectAssetPath(`assets/${stem}.asset.${extension}`, this.manifest)
            const exported = await this.get().assetManager.exporter.exportObject(object as IObject3D, {
                exportExt: extension,
                viewerConfig: false,
            })
            if (!exported) return {error: `Unable to export ${object.name || 'asset'}.`}
            const written = await this.source.write(path, new Uint8Array(await exported.arrayBuffer()), '*')
            this.hashes.set(path, written.sha256)
            const assetId = await this.registerAsset(path)
            const rootPath = assetIdUrl(assetId, path)
            const result = cloneAssetItem(object, rootPath) as IObject3D | IMaterial
            result.userData ||= {}
            result.userData.rootPath = rootPath
            if (isObject) {
                const source = object as IObject3D
                const instance = result as IObject3D
                const parent = source.parent
                const index = parent?.children.indexOf(source) ?? -1
                instance.userData.sProperties = [...assetInstanceProperties]
                for (const child of instance.children) child.userData.excludeFromExport = true
                if (parent) {
                    source.removeFromParent()
                    parent.add(instance)
                    if (index >= 0) {
                        parent.children.splice(parent.children.indexOf(instance), 1)
                        parent.children.splice(index, 0, instance)
                    }
                }
                this.get().getPlugin(PickingPlugin)?.setSelectedObject(instance, false)
            }
            this.loadedNeedsSave = true
            this.replaceManifest(await this.source.list())
            this.setStatus(`Created ${path}`)
            return {path, result}
        } catch (error) {
            return {error: errorMessage(error)}
        }
    }

    /**
     * Writes an edited object or material back to its project asset file.
     * Asset inspector save actions call it.
     */
    async saveProjectAsset(
        _project: unknown,
        _scene: unknown,
        object: IObject3D | IMaterial,
        path: string,
    ): Promise<{error: string | null}> {
        try {
            if (!/\.(?:glb|gltf|mat)$/i.test(path)) return {error: `Unsupported asset path: ${path}`}
            const extension = path.split('.').pop()?.toLowerCase() || 'glb'
            const exported = await this.get().assetManager.exporter.exportObject(object as IObject3D, {
                exportExt: extension,
                viewerConfig: false,
            })
            if (!exported) return {error: `Unable to export ${path}.`}
            let ifMatch = this.hashes.get(path)
            if (!ifMatch) ifMatch = (await this.source.read(path)).sha256
            const written = await this.source.write(path, new Uint8Array(await exported.arrayBuffer()), ifMatch)
            this.hashes.set(path, written.sha256)
            this.replaceManifest(await this.source.list())
            if (object === this.loadedAssetObj) this.loadedNeedsSave = false
            this.setStatus(`Saved ${path}`)
            return {error: null}
        } catch (error) {
            return {error: errorMessage(error)}
        }
    }

    /**
     * Reloads an asset from disk with a fresh cache revision.
     * Asset editor controls call it after external changes.
     */
    async reloadProjectAsset(path: string): Promise<IObject3D | IMaterial> {
        const file = await this.source.read(path)
        this.hashes.set(path, file.sha256)
        const url = versionedPath(this.assetPathUrl(path), file.sha256, String(++this.moduleReloadSequence))
        const imported = await this.get().assetManager.importer.import(url)
        const asset = imported.find((item) => item?.isObject3D || item?.isMaterial)
        if (!asset) throw new Error(`Unable to reload ${path}.`)
        this.get().getPlugin(PickingPlugin)?.setSelectedObject(asset as IObject3D | IMaterial, false)
        if (this.loadedProjectFile?.path === path) this.loadedAssetObj = asset as IObject3D | IMaterial
        this.setStatus(`Reloaded ${path}`)
        this.changed()
        return asset as IObject3D | IMaterial
    }

    /**
     * Updates package metadata and opens the selected main scene.
     * Project scene controls call it.
     */
    async setMainScene(path: string): Promise<void> {
        if (!/\.scene\.gltf$/i.test(path)) throw new Error('The main scene must be a .scene.gltf file.')
        const packageFile = await this.source.read('package.json')
        const packageJson = JSON.parse(decode(packageFile.bytes)) as ProjectPackageJSON
        packageJson.mainScene = path
        const written = await this.source.write(
            'package.json',
            encode(`${JSON.stringify(packageJson, null, 2)}\n`),
            packageFile.sha256,
        )
        this.hashes.set('package.json', written.sha256)
        if (this.project) {
            this.project.mainScene = path
            this.project.packageJson = packageJson
        }
        await this.openProjectFile(path)
        this.changed()
    }

    private assetPathUrl(path: string): string {
        const registered = Object.entries(this.assetsManifest.files).find(([, entry]) => entry.path === path)
        if (!registered) return this.source.fileUrl(path, this.hashes.get(path))
        const extension = path.split('.').pop() || 'glb'
        return assetIdUrl(registered[0], `f.${extension}`)
    }

    /**
     * Refreshes file and directory manifests from the server.
     * Project browser actions call it after filesystem changes.
     */
    async refreshProjectFiles(): Promise<void> {
        const [files, directories] = await Promise.all([
            this.source.list(),
            this.source.listDirectories(),
        ])
        this.directoryManifest = directories
        this.replaceManifest(files)
    }

    private async registerProjectModule(path: string, kind: 'plugin' | 'script'): Promise<void> {
        const packageFile = await this.source.read('package.json')
        const packageJson = JSON.parse(decode(packageFile.bytes)) as Record<string, unknown>
        const kite3d = packageJson.kite3d && typeof packageJson.kite3d === 'object' && !Array.isArray(packageJson.kite3d)
            ? packageJson.kite3d as Record<string, unknown>
            : {}
        const key = kind === 'plugin' ? 'plugins' : 'scripts'
        const entries = Array.isArray(kite3d[key]) ? [...kite3d[key] as unknown[]] : []
        if (!entries.some((entry) => entry === path || (entry && typeof entry === 'object' && 'import' in entry
            && (entry as {import?: unknown}).import === path))) entries.push(path)
        packageJson.kite3d = {...kite3d, [key]: entries}
        const written = await this.source.write(
            'package.json',
            encode(`${JSON.stringify(packageJson, null, 2)}\n`),
            packageFile.sha256,
        )
        this.hashes.set('package.json', written.sha256)
    }

    private async registerAsset(path: string, preferredId?: string, files?: Record<string, string>): Promise<string> {
        const existing = Object.entries(this.assetsManifest.files)
            .find(([, asset]) => asset.path === path)?.[0]
        if (existing) return existing

        const assetId = preferredId && !this.assetsManifest.files[preferredId]
            ? preferredId
            : uniqueAssetId(path, this.assetsManifest)
        const next: AssetsJSONManifest = {
            ...this.assetsManifest,
            files: {...this.assetsManifest.files, [assetId]: {path, ...(files ? {files} : {})}},
        }
        const written = await this.source.write(
            'assets.json',
            encode(`${JSON.stringify(next, null, 2)}\n`),
            this.hashes.get('assets.json') || '*',
        )
        this.assetsManifest.files = next.files
        this.assetsManifest.version = next.version
        this.hashes.set('assets.json', written.sha256)
        return assetId
    }

    /**
     * Registers an imported item and assigns its stable project asset URL.
     * Drop and asset-tracker adapters call it after imports.
     */
    async registerProjectAssetItem(path: string, item: IObject3D | IMaterial | ITexture): Promise<void> {
        const rootPath = assetIdUrl(await this.registerAsset(path), path)
        item.userData ||= {}
        item.userData.rootPath = rootPath
        item.userData.kite3dImportedInstance = true
        item._tpRootPath = rootPath
        if ((item as IObject3D).isObject3D) {
            const object = item as IObject3D
            if (object.type === 'Group' && object.name === 'AuxScene' && object.children.length > 1) {
                object.name = path.split('/').pop() || object.name
            }
            object.userData.sProperties = [...assetInstanceProperties]
            for (const child of object.children) child.userData.excludeFromExport = true
        }
    }

    /**
     * Downloads a remote asset and imports it as a project file.
     * URL import controls call it.
     */
    async importUrl(url: string) {
        const response = await fetch(url)
        if (!response.ok) throw new Error(`Unable to import ${url}: ${response.status}`)
        const name = new URL(url).pathname.split('/').pop() || 'imported-asset.glb'
        await this.importFiles([new File([await response.blob()], name)])
    }

    /**
     * Resolves a file or library entry to an imported asset.
     * Reference asset pickers call it for preview and insertion.
     */
    async getAssetFromEntry(entry: {path: string, name?: string, libFileId?: string, isFSEntry?: boolean}) {
        if (entry.libFileId) return this.importLibraryAsset(entry)
        return this.getAssetFromPath(entry.isFSEntry ? this.assetPathUrl(entry.path) : entry.path)
    }

    private async importLibraryAsset(entry: {path: string, name?: string}) {
        const sourceName = new URL(entry.path).pathname.split('/').pop() || 'library-asset.gltf'
        const assetId = uniqueAssetId(sourceName, this.assetsManifest)
        const extension = sourceName.split('.').pop()?.toLowerCase() || 'bin'
        const rootName = `f.${extension}`
        const directory = `assets/imports/${assetId}`
        const resources = await downloadLibraryAsset(entry.path, rootName)
        const files = Object.fromEntries(resources.map(({path}) => [path, `${directory}/${path}`]))
        const writtenPaths: string[] = []
        try {
            for (const resource of resources) {
                const path = files[resource.path]
                const written = await this.source.write(path, resource.bytes, '*')
                writtenPaths.push(path)
                this.hashes.set(path, written.sha256)
            }
            await this.registerAsset(files[rootName], assetId, files)
        } catch (error) {
            await Promise.all(writtenPaths.map(async (path) => {
                await this.source.delete(path).catch(() => undefined)
                this.hashes.delete(path)
            }))
            throw error
        }
        const rootPath = assetIdUrl(assetId, files[rootName])
        const importer = this.get().assetManager.importer
        const rootDirectory = rootPath.slice(0, rootPath.lastIndexOf('/') + 1)
        let importError: unknown
        const captureImportError = (event: {path: string, state: string, error?: unknown}) => {
            if (event.state === 'error' && event.path.startsWith(rootDirectory)) importError = event.error
        }
        importer.addEventListener('importFile', captureImportError)
        const imported = await importer.import(rootPath).finally(() =>
            importer.removeEventListener('importFile', captureImportError))
        const loaded = imported.find(Boolean)
        if (!loaded) {
            if (importError instanceof Error) throw importError
            if (importError && typeof importError === 'object' && 'message' in importError) {
                throw new Error(String(importError.message))
            }
            throw new Error(importError ? String(importError) : 'The asset loader returned no result.')
        }
        loaded.userData ||= {}
        loaded.userData.rootPath = rootPath
        loaded.userData.kite3dImportedInstance = true
        loaded.userData.sProperties = [...assetInstanceProperties]
        loaded._tpRootPath = rootPath
        loaded.name = entry.name || sourceName
        if (loaded.isObject3D) {
            for (const child of loaded.children) child.userData.excludeFromExport = true
        }
        this.replaceManifest(await this.source.list())
        return loaded
    }

    /**
     * Imports the first supported asset found at a project or remote URL.
     * Asset pickers and editor open flows call it.
     */
    async getAssetFromPath(path: string) {
        const normalized = path.startsWith('/kite3d/') || /^https?:\/\//.test(path) ? path : this.source.fileUrl(path)
        const importer = this.get().assetManager.importer
        let importError: unknown
        const captureImportError = (event: {state: string, error?: unknown}) => {
            if (event.state === 'error') importError = event.error
        }
        importer.addEventListener('importFile', captureImportError)
        const imported = await importer.import(normalized).finally(() =>
            importer.removeEventListener('importFile', captureImportError))
        const loaded = imported.find(Boolean)
        if (loaded) return loaded
        if (importError instanceof Error) throw importError
        if (importError && typeof importError === 'object' && 'message' in importError) {
            throw new Error(String(importError.message))
        }
        if (importError) throw new Error(String(importError))
        return undefined
    }

    /**
     * Converts a stable asset identifier into its project file path.
     * Asset labels and inspector controls call it for display.
     */
    resolveAssetIdPath(path?: string | null) {
        if (!path) return path ?? null
        const id = path.replace(/^@/, '').split('/', 1)[0]
        return this.assetsManifest.files[id]?.path || path
    }

    /**
     * Loads an optional asset entry for reference editor callbacks.
     * Asset selector components call it.
     */
    async loadAsset(entry?: {path: string} | null) {
        return entry ? this.getAssetFromEntry(entry) : null
    }

    /**
     * Removes an asset item from the in-memory tracker.
     * Reference asset lifecycle callbacks call it.
     */
    unloadAsset(asset: Parameters<DevServerAssetTracker['removeAssetItem']>[0]) {
        this.get().assetManager.tracker.removeAssetItem(asset)
    }

    /**
     * Opens or closes the editor welcome dialog.
     * Welcome and project-picker controls call it.
     */
    setWelcomeOpen(open: boolean) {
        this.welcomeOpen = open
        this.changed()
    }

    /**
     * Downloads a viewport snapshot through the viewer plugin.
     * Editor export controls call it.
     */
    async snapshot() {
        await this.get().getPlugin(CanvasSnapshotPlugin)?.downloadSnapshot(`${this.project?.name || 'kite3d'}-snapshot.png`, {
            waitForProgressive: false,
        })
    }

    /**
     * Downloads the open scene as serialized glTF.
     * Editor export controls call it after draft validation.
     */
    async exportGltf() {
        if (this.sourceDraftDirty) {
            AppToaster().show({
                message: 'Save the open source draft before exporting.',
                intent: 'warning',
                icon: 'warning-sign',
                timeout: 4000,
                isCloseButtonShown: true,
            })
            return
        }
        const serialized = await serializeSceneGltf(this.get(), {scenePath: this.scenePath})
        downloadBlob(new Blob([serialized.gltf as BlobPart], {type: 'model/gltf+json'}), this.scenePath.split('/').pop() || 'scene.gltf')
    }

    /**
     * Rejects unsaved source text and persists pending scene edits.
     * The publish dialog calls it before sending a release request.
     */
    async beforePublish(): Promise<boolean> {
        if (this.sourceDraftDirty) {
            await this.writeState()
            throw new Error('Save the unsaved source draft before publishing.')
        }
        return this.saveScene()
    }

    /**
     * Applies a source editor save to the active project state.
     * Source editor callbacks call it with the server hash.
     */
    async sourceFileSaved(path: string, sha256: string) {
        await this.applyProjectFileChange(path, sha256, false)
        this.restoreSelectedFile(path)
    }

    /**
     * Lists script and plugin files absent from package configuration.
     * Project settings read it to offer module registration.
     */
    unlistedScripts(): ProjectFileEntry[] {
        const listed = new Set([
            ...(this.project?.config.scripts || []).map(({import: path}) => normalizeProjectPath(path)),
            ...(this.project?.config.plugins || []).filter(({import: path}) =>
                !this.project || !isDependencyModuleSpecifier(path, this.project.packageJson))
                .map(({import: path}) => normalizeProjectPath(path)),
        ])
        return this.manifest.filter(({path}) =>
            !path.startsWith('samples/')
            && (path.endsWith('.script.js') || path.endsWith('.plugin.js'))
            && !listed.has(path)
        )
    }

    /**
     * Persists editor health, play state, selection, and dirty hashes.
     * Heartbeats and lifecycle transitions call it.
     */
    async writeState(error?: string) {
        const write = this.stateWriteQueue.then(async () => {
            const savedSceneHash = this.savedSceneHash
            const sceneHash = this.projectLoaded && this.viewer && this.loadedNeedsSave
                ? await hashBytes((await serializeSceneGltf(this.viewer, {scenePath: this.scenePath})).gltf)
                : savedSceneHash
            const sceneDirty = this.loadedNeedsSave && sceneHash !== savedSceneHash
            const state: EditorState = {
                editorVersion: this.editorVersion,
                engineVersion: RUNTIME_VERSION,
                projectLoaded: this.projectLoaded,
                playState: this.isPlaying ? 'playing' : 'stopped',
                dirty: sceneDirty || this.sourceDraftDirty,
                sourceDraftDirty: this.sourceDraftDirty,
                sceneHash,
                savedSceneHash,
                selectionNames: selectedNames(this.viewer),
                lastLoadError: error || this.error || null,
                updatedAt: new Date().toISOString(),
                clientId: this.source.clientId,
            }
            try {
                const sha256 = await writeEditorState(
                    this.source,
                    state,
                    this.hashes.get('.kite3d/state.json') || '*',
                )
                this.hashes.set('.kite3d/state.json', sha256)
            } catch (caught) {
                if (!(caught instanceof ProjectConflictError)) throw caught
            }
        })
        this.stateWriteQueue = write.catch(() => undefined)
        return this.stateWriteQueue
    }

    /**
     * Publishes an error to the UI and project console feedback file.
     * Browser, runtime, module, and import error handlers call it.
     */
    async reportError(error: unknown) {
        const message = error instanceof Error ? `${error.message}\n${error.stack || ''}` : String(error)
        this.error = message
        this.setStatus('Project error')
        await this.appendConsoleError(message)
    }

    private appendConsoleError(message: string): Promise<void> {
        const now = Date.now()
        this.consoleErrorTimes = this.consoleErrorTimes.filter((time) => now - time < 10_000)
        if (this.consoleErrorTimes.length >= 20) return Promise.resolve()
        this.consoleErrorTimes.push(now)
        return this.appendConsoleLine(message)
    }

    private appendConsoleLine(message: string, timestamp = true): Promise<void> {
        const write = this.consoleWriteQueue.then(async () => {
            let previous = ''
            let ifMatch: string | '*' = this.hashes.get('.kite3d/console.log') || '*'
            try {
                const current = await this.source.read('.kite3d/console.log')
                previous = decode(current.bytes)
                ifMatch = current.sha256
            } catch { /* first log entry */ }
            const line = timestamp ? `${new Date().toISOString()} ${message}` : message
            const next = `${previous}${line}\n`.slice(-200_000)
            try {
                const result = await this.source.write('.kite3d/console.log', encode(next), ifMatch)
                this.hashes.set('.kite3d/console.log', result.sha256)
            } catch (error) {
                if (!(error instanceof ProjectConflictError)) throw error
            }
        })
        this.consoleWriteQueue = write.catch(() => undefined)
        return this.consoleWriteQueue
    }

    private installErrorForwarding() {
        window.addEventListener('error', this.onWindowError)
        window.addEventListener('unhandledrejection', this.onUnhandledRejection)
        this.originalConsoleError = console.error
        this.originalConsoleWarn = console.warn
        console.error = (...values: unknown[]) => {
            this.originalConsoleError?.(...values)
            if (this.isPlaying || this.isStartingPlay) {
                void this.appendConsoleError(`[console.error] ${values.map(formatConsoleValue).join(' ')}`)
            }
        }
        console.warn = (...values: unknown[]) => {
            this.originalConsoleWarn?.(...values)
            if (this.isPlaying || this.isStartingPlay) {
                void this.appendConsoleError(`[console.warn] ${values.map(formatConsoleValue).join(' ')}`)
            }
        }
    }

    private async onProjectEvent(event: ProjectEvent) {
        if (event.type === 'command' && event.command === 'screenshot' && typeof event.id === 'string') {
            try {
                await this.source.screenshotResult(event.id, await this.captureScreenshot())
            } catch (error) {
                await this.reportError(error)
            }
            return
        }
        if (event.type !== 'change' && event.type !== 'add' && event.type !== 'unlink') return
        if (event.client === this.source.clientId || !event.path) return
        if (event.sha256 && this.hashes.get(event.path) === event.sha256) return

        this.dispatchEvent({
            type: 'projectFileChange',
            path: event.path,
            sha256: event.sha256,
            changeType: event.type,
        })
        await this.applyProjectFileChange(event.path, event.sha256, true)
        this.restoreSelectedFile(event.path)
    }

    private restoreSelectedFile(path: string) {
        if (this.selectedFilePath === path) this.get().getPlugin(PickingPlugin)?.setSelectedObject(null)
    }

    private async applyProjectFileChange(path: string, eventHash: string | undefined, external: boolean) {
        if (path === this.scenePath) {
            if (external && this.loadedNeedsSave && !window.confirm('Changed on disk: reload and discard the editor copy?')) {
                this.setStatus('Kept unsaved editor scene')
                return
            }
            const disk = await this.source.read(this.scenePath)
            const text = decode(disk.bytes)
            validateSceneSource(this.scenePath, text)
            this.hashes.set(this.scenePath, disk.sha256)
            await this.loadEditScene(text)
            this.setStatus('Scene reloaded from disk')
            this.replaceManifest(await this.source.list())
            return
        }

        const entries = await this.source.list()
        this.manifest = entries
        const nextHash = entries.find((entry) => entry.path === path)?.sha256 || eventHash
        if (nextHash) this.hashes.set(path, nextHash)
        else this.hashes.delete(path)

        if (path === 'package.json' || path === 'assets.json') {
            await this.reloadProject()
            return
        }

        const isJavaScript = /\.m?js$/i.test(path)

        if (isJavaScript) {
            const moduleRevision = String(++this.moduleReloadSequence)
            this.moduleRevision = moduleRevision
            await this.registerProjectScripts(this.project!.config, moduleRevision)
            if (this.isPlaying) await this.restartPlay()
            this.setStatus(`${path} reloaded`)
        }
        this.changed()
    }

    private async reloadProject() {
        const wasPlaying = this.isPlaying
        const canvas = this.playCanvas
        if (wasPlaying) await this.stopPlay()
        if (this.viewer) {
            this.detachIdleFrameCap()
            this.viewer.scene.removeEventListener('sceneUpdate', this.onEditSceneUpdate)
            this.nestedAssets?.dispose()
            this.nestedAssets = undefined
            this.viewer.dispose()
            this.viewer.container.remove()
            this.viewer = undefined
        }
        this.projectLoaded = false
        await this.loadProject()
        if (wasPlaying && canvas) await this.startPlay(canvas)
    }

    private replaceManifest(entries: ProjectFileEntry[]) {
        this.manifest = entries
        for (const entry of entries) this.hashes.set(entry.path, entry.sha256)
        this.changed()
    }

    private async reportRemovedGenerators() {
        const names = new Set(this.removedGeneratorNodes.map(({nodeName}) => nodeName))
        this.get().scene.modelRoot.traverse((object) => {
            if (!names.has(object.name)) return
            Object.defineProperty(object.userData, 'kite3dRemovedGenerator', {
                configurable: true,
                enumerable: false,
                value: true,
            })
        })
        for (const {nodeIndex, nodeName} of this.removedGeneratorNodes) {
            const key = `${nodeIndex}:${nodeName}`
            if (this.reportedRemovedGenerators.has(key)) continue
            this.reportedRemovedGenerators.add(key)
            const message = removedGeneratorMessage(nodeName)
            console.warn(message)
            await this.appendConsoleLine(message)
        }
    }

    private setStatus(status: string) {
        this.status = status
        this.changed()
    }

    private changed() {
        this.dispatchEvent({type: 'stateChange'})
    }

    private startHeartbeat() {
        this.stopHeartbeat()
        this.heartbeat = setInterval(() => void this.writeState(), 5_000)
    }

    private stopHeartbeat() {
        if (!this.heartbeat) return
        clearInterval(this.heartbeat)
        this.heartbeat = undefined
    }

    /**
     * Releases viewers, listeners, timers, and console overrides.
     * Editor teardown calls it when replacing the manager.
     */
    dispose() {
        this.unsubscribe?.()
        this.stopHeartbeat()
        window.removeEventListener('error', this.onWindowError)
        window.removeEventListener('unhandledrejection', this.onUnhandledRejection)
        window.removeEventListener('pagehide', this.onPageHide)
        this.game?.dispose()
        if (this.viewer) {
            this.detachIdleFrameCap()
            this.viewer.scene.removeEventListener('sceneUpdate', this.onEditSceneUpdate)
            this.nestedAssets?.dispose()
            this.nestedAssets = undefined
            this.viewer.dispose()
            this.viewer.container.remove()
        }
        if (this.originalConsoleError) console.error = this.originalConsoleError
        if (this.originalConsoleWarn) console.warn = this.originalConsoleWarn
        delete (window as Window & {viewer?: ThreeViewer}).viewer
    }
}

function findPluginExport(module: ModuleExports, definition: ExternalPlugin): Class<IViewerPlugin> {
    const requested = definition.className || 'default'
    const selected = module[requested]
    if (isPluginType(selected)) return selected
    if (!definition.className) {
        const candidates = Object.values(module).filter(isPluginType)
        if (candidates.length === 1) return candidates[0]
    }
    throw new Error(`Cannot find plugin export "${requested}" in ${definition.import}`)
}

function isPluginType(value: unknown): value is Class<IViewerPlugin> {
    return typeof value === 'function'
        && typeof (value as {PluginType?: unknown}).PluginType === 'string'
}

function normalizeProjectPath(path: string) {
    return path.replace(/^\.\//, '').replace(/\\/g, '/').split(/[?#]/, 1)[0]
}

function projectEntryBytes(path: string, kind: Exclude<ProjectEntryKind, 'folder'>): Uint8Array {
    const name = path.split('/').pop()?.replace(/\.(?:scene\.gltf|asset\.glb|asset\.mat|plugin\.js|script\.js|json)$/i, '') || 'NewEntry'
    if (kind === 'scene') return encode(`${JSON.stringify({
        asset: {version: '2.0', generator: 'Kite3D'},
        scene: 0,
        scenes: [{name, nodes: []}],
        nodes: [],
    }, null, 2)}\n`)
    if (kind === 'asset') return emptyGlbBytes()
    if (kind === 'physical-material' || kind === 'unlit-material') {
        const material = kind === 'physical-material' ? new PhysicalMaterial() : new UnlitMaterial()
        material.name = name
        return encode(`${JSON.stringify(material.toJSON(), null, 2)}\n`)
    }
    if (kind === 'plugin') {
        const className = safeClassName(name, 'ProjectPlugin')
        return encode(`import {AViewerPluginSync} from 'threepipe'\n\nexport class ${className} extends AViewerPluginSync {\n  static PluginType = '${className}'\n}\n`)
    }
    if (kind === 'script') {
        const className = safeClassName(name, 'ProjectComponent')
        return encode(`import {Object3DComponent} from 'threepipe'\n\nexport class ${className} extends Object3DComponent {\n  static ComponentType = '${className}'\n  static StateProperties = ['speed']\n\n  speed = 1\n\n  update({deltaTime}) {\n    this.object.rotation.y += this.speed * deltaTime / 1000\n    return true\n  }\n}\n`)
    }
    return encode('{}\n')
}

function safeClassName(value: string, fallback: string): string {
    const words = value.replace(/[^a-zA-Z0-9_$]+/g, ' ').trim().split(/\s+/).filter(Boolean)
    const result = words.map((word) => word[0].toUpperCase() + word.slice(1)).join('').replace(/^[^a-zA-Z_$]+/, '')
    return result || fallback
}

function emptyGlbBytes(): Uint8Array {
    const json = encode(JSON.stringify({asset: {version: '2.0', generator: 'Kite3D'}, scene: 0, scenes: [{nodes: []}], nodes: []}))
    const paddedLength = Math.ceil(json.byteLength / 4) * 4
    const bytes = new Uint8Array(12 + 8 + paddedLength)
    const view = new DataView(bytes.buffer)
    view.setUint32(0, 0x46546c67, true)
    view.setUint32(4, 2, true)
    view.setUint32(8, bytes.byteLength, true)
    view.setUint32(12, paddedLength, true)
    view.setUint32(16, 0x4e4f534a, true)
    bytes.fill(0x20, 20)
    bytes.set(json, 20)
    return bytes
}

function safeFileStem(value: string): string {
    return value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'asset'
}

function uniqueProjectAssetPath(path: string, entries: ProjectFileEntry[]): string {
    const used = new Set(entries.map((entry) => entry.path))
    if (!used.has(path)) return path
    const extensionIndex = path.indexOf('.asset.')
    const stem = extensionIndex >= 0 ? path.slice(0, extensionIndex) : path
    const extension = extensionIndex >= 0 ? path.slice(extensionIndex) : ''
    let suffix = 1
    while (used.has(`${stem}-${suffix}${extension}`)) suffix += 1
    return `${stem}-${suffix}${extension}`
}

async function hashBytes(bytes: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
    return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}

async function compositeScreenshot(source: HTMLCanvasElement): Promise<Blob> {
    const canvas = document.createElement('canvas')
    canvas.width = source.width
    canvas.height = source.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('The editor could not create a screenshot canvas.')
    const viewport = source.closest<HTMLElement>('.editorCanvasContainer') || source.parentElement
    const app = source.closest<HTMLElement>('.editorSplitContainer')
    const viewportBackground = viewport ? getComputedStyle(viewport).backgroundColor : ''
    const appBackground = app ? getComputedStyle(app).backgroundColor : ''
    context.fillStyle = isTransparent(viewportBackground) ? appBackground : viewportBackground
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(source, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) resolve(blob)
            else reject(new Error('The editor did not produce a screenshot.'))
        }, 'image/png')
    })
}

function isTransparent(color: string): boolean {
    return !color || color === 'transparent' || color === 'rgba(0, 0, 0, 0)'
}

function versionedPath(path: string, sha256?: string, reloadRevision?: string) {
    const [withoutFragment, fragment = ''] = path.split('#', 2)
    const [pathname, query = ''] = withoutFragment.split('?', 2)
    const parameters = new URLSearchParams(query)
    if (sha256) parameters.set('v', sha256)
    if (reloadRevision) parameters.set('r', reloadRevision)
    const suffix = parameters.size ? `?${parameters}` : ''
    return `${pathname}${suffix}${fragment ? `#${fragment}` : ''}`
}

function uniqueImportPath(name: string, entries: ProjectFileEntry[]) {
    const safe = name.replace(/[^a-zA-Z0-9._-]+/g, '-') || 'asset.glb'
    const used = new Set(entries.map(({path}) => path))
    let path = `assets/imports/${safe}`
    let suffix = 1
    const dot = safe.lastIndexOf('.')
    const stem = dot < 0 ? safe : safe.slice(0, dot)
    const extension = dot < 0 ? '' : safe.slice(dot)
    while (used.has(path)) path = `assets/imports/${stem}-${suffix++}${extension}`
    return path
}

function uniqueAssetId(path: string, manifest: AssetsJSONManifest): string {
    const filename = path.split('/').pop() || 'asset'
    const extension = filename.lastIndexOf('.')
    const stem = extension < 0 ? filename : filename.slice(0, extension)
    const base = stem.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'asset'
    let id = base
    let suffix = 1
    while (manifest.files[id]) id = `${base}-${suffix++}`
    return id
}

function assetIdUrl(id: string, path: string): string {
    const extension = path.split(/[?#]/, 1)[0].split('.').pop()?.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'bin'
    return `${assetUrlPrefix}@${id}/f.${extension}`
}

interface DownloadedLibraryResource {
    path: string
    bytes: Uint8Array
}

async function downloadLibraryAsset(url: string, rootName: string): Promise<DownloadedLibraryResource[]> {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Unable to import ${url}: ${response.status}`)
    const rootBytes = new Uint8Array(await response.arrayBuffer())
    if (!rootName.toLowerCase().endsWith('gltf')) return [{path: rootName, bytes: rootBytes}]

    let document: {
        buffers?: Array<{uri?: string}>
        images?: Array<{uri?: string}>
    }
    try {
        document = JSON.parse(decode(rootBytes)) as typeof document
    } catch {
        throw new Error(`Unable to import ${url}: the library file is not valid JSON glTF`)
    }

    const references = [
        ...(document.buffers || []).filter((value) => externalResourceUri(value.uri)),
        ...(document.images || []).filter((value) => externalResourceUri(value.uri)),
    ] as Array<{uri: string}>
    const pathsByUrl = new Map<string, string>()
    const urlsByPath = new Map<string, string>()
    const downloads: Array<{path: string, url: string}> = []
    for (const [index, reference] of references.entries()) {
        const resourceUrl = new URL(reference.uri, url).href
        let path = pathsByUrl.get(resourceUrl)
        if (!path) {
            path = safeLibraryResourcePath(reference.uri, index)
            if (urlsByPath.has(path) && urlsByPath.get(path) !== resourceUrl) {
                path = `resources/${index}-${safeFileName(path.split('/').pop() || 'file.bin')}`
            }
            pathsByUrl.set(resourceUrl, path)
            urlsByPath.set(path, resourceUrl)
            downloads.push({path, url: resourceUrl})
        }
        reference.uri = path
    }

    const dependencies = await Promise.all(downloads.map(async ({path, url: resourceUrl}) => {
        const resource = await fetch(resourceUrl)
        if (!resource.ok) throw new Error(`Unable to import ${resourceUrl}: ${resource.status}`)
        return {path, bytes: new Uint8Array(await resource.arrayBuffer())}
    }))
    return [{path: rootName, bytes: encode(`${JSON.stringify(document, null, 2)}\n`)}, ...dependencies]
}

function externalResourceUri(uri?: string): uri is string {
    return typeof uri === 'string' && !uri.startsWith('data:') && !uri.startsWith('blob:')
}

function safeLibraryResourcePath(uri: string, index: number): string {
    const withoutQuery = uri.split(/[?#]/, 1)[0].replace(/\\/g, '/')
    let decoded = withoutQuery
    try {
        decoded = decodeURIComponent(withoutQuery)
    } catch { /* keep the encoded path */ }
    const segments = decoded.split('/')
    if (decoded && !decoded.startsWith('/') && !/^[a-z][a-z\d+.-]*:/i.test(decoded)
        && segments.every((segment) => segment && segment !== '.' && segment !== '..')) {
        return segments.join('/')
    }
    const fallback = safeFileName(new URL(uri, 'https://kite3d.invalid/').pathname.split('/').pop() || 'file.bin')
    return `resources/${index}-${fallback}`
}

function safeFileName(name: string): string {
    return name.replace(/[^a-zA-Z0-9._-]+/g, '-') || 'file.bin'
}

function selectedNames(viewer?: ThreeViewer): string[] {
    const selected = viewer?.getPlugin(PickingPlugin)?.getSelectedObject()
    if (!selected) return []
    const values = Array.isArray(selected) ? selected : [selected]
    return values.map((value) => value.name || value.uuid)
}

function formatConsoleValue(value: unknown): string {
    if (value instanceof Error) return `${value.message}\n${value.stack || ''}`
    if (typeof value === 'string') return value
    try { return JSON.stringify(value) } catch { return String(value) }
}

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error)
}

function pluginStatusKey(plugin: ExternalPlugin, index: number) {
    return `${plugin.import}:${plugin.className || ''}:${index}`
}

function projectModuleErrorStatus(error: unknown, path?: string, source?: string): ProjectLoadStatus {
    const message = errorMessage(error).replace(/^Error:\s*/i, '').split('\n')[0]
    const stack = error instanceof Error ? error.stack || '' : ''
    const escapedPath = path?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const diagnostic = `${errorMessage(error)}\n${stack}`
    const reportedLine = escapedPath
        ? diagnostic.match(new RegExp(`${escapedPath}[^\\n]*?:(\\d+):\\d+`))?.[1]
        : diagnostic.match(/:(\d+):\d+(?:\)?$)/m)?.[1]
    const eofLine = source && /unexpected end of (?:input|file)/i.test(message)
        ? String(source.trimEnd().split('\n').length)
        : undefined
    const line = reportedLine || eofLine
    const type = error instanceof Error && error.name && error.name !== 'Error' ? `${error.name}: ` : ''
    return {
        kind: 'error',
        text: `${type}${message}${line ? `, line ${line}` : ''}`,
    }
}

function isBenignResizeObserverError(message: string): boolean {
    return message === 'ResizeObserver loop completed with undelivered notifications.'
        || message === 'ResizeObserver loop limit exceeded'
}

function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
}
