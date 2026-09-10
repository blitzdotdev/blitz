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
    type IObject3D,
    type IViewerPlugin,
} from 'threepipe'
import {
    CannonPhysicsPlugin,
    authoringQualityReport,
    createGame,
    GeneratorComponent,
    HtmlUiComponent,
    parseAssetsJSONManifest,
    parsePackageJSON,
    parsePackageJsonSettingsConfig,
    persistenceReport,
    readProjectGeneratorStates,
    registerScripts,
    RUNTIME_VERSION,
    runGenerator,
    semanticSceneSnapshot,
    serializeSceneGltf,
    validateSceneSource,
    type AuthoringValidationIssue,
    type AssetsJSONManifest,
    type CreatedGame,
    type ExternalPlugin,
    type ProjectConfigSettings,
    type ProjectGeneratorState,
    type ProjectPackageJSON,
    type RuntimeCleanupReport,
    type SerializedSceneGltf,
} from '@blitzdev/engine'
import {AppToaster} from 'uiconfig-blueprint/lib/esm/lib'
import {DevServerSource} from '../DevServerSource.ts'
import {ProjectConflictError, type ProjectEvent, type ProjectFileEntry} from '../ProjectSource.ts'
import {BlueprintJsUiPlugin2} from '../UiConfigRendererBlueprint2.tsx'
import {EditModePlugin} from './EditModePlugin.ts'
import {writeEditorState, type EditorState} from './editorState.ts'

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
const encode = (text: string) => new TextEncoder().encode(text)

export interface EditorProject {
    name: string
    path: string
    file: string
    mainScene: string
    packageJson: ProjectPackageJSON
    config: ProjectConfigSettings
}

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

export interface EditorCheckOutcome {
    name: 'Playable' | 'Editable' | 'Persisted'
    status: 'pass' | 'fail'
    summary: string
    codes: string[]
    durationMs?: number
    report?: unknown
}

export interface EditorCheckResult {
    ok: boolean
    mode: 'editor'
    checkedAt: string
    outcomes: EditorCheckOutcome[]
}

type ModuleExports = Record<string, unknown>

/** Owns the persistent edit viewer and the disposable published-game viewer. */
export class ViewerInstanceManager extends EventDispatcher<ManagerEventMap> {
    readonly source: DevServerSource
    readonly hashes = new Map<string, string>()

    viewer?: ThreeViewer
    game?: CreatedGame
    project?: EditorProject
    manifest: ProjectFileEntry[] = []
    sceneText = ''
    scenePath = 'assets/main.scene.gltf'
    generatorStates: ProjectGeneratorState[] = []
    componentTypes: string[] = [GeneratorComponent.ComponentType]
    status = 'Loading project…'
    error?: string
    projectLoaded = false
    isPlaying = false
    isStartingPlay = false
    isChecking = false
    checkResult?: EditorCheckResult
    welcomeOpen = false
    loadedProject: EditorProject | null = null
    loadedProjectFile: LoadedProjectFile | null = null
    loadedScene: string | null = null
    loadedAssetObj: null = null
    loadedPath: string | null = null
    selectedFilePath: string | null = null

    private _loadedNeedsSave = false
    private _sourceDraftDirty = false
    private initializing?: Promise<void>
    private playPromise?: Promise<void>
    private checkPromise?: Promise<EditorCheckResult>
    private readyResolve!: () => void
    private readyReject!: (error: unknown) => void
    private readonly ready = new Promise<void>((resolve, reject) => {
        this.readyResolve = resolve
        this.readyReject = reject
    })
    private unsubscribe?: () => void
    private heartbeat?: ReturnType<typeof setInterval>
    private playCanvas?: HTMLCanvasElement
    private assetUrlModifier?: (url: string) => string
    private loadingScene = false
    private savingScene = false
    private consoleErrorTimes: number[] = []
    private runtimeErrorCount = 0
    private moduleReloadSequence = 0
    private moduleRevision?: string
    private consoleWriteQueue: Promise<void> = Promise.resolve()
    private stateWriteQueue: Promise<void> = Promise.resolve()
    private originalConsoleError?: typeof console.error
    private originalConsoleWarn?: typeof console.warn
    private editorVersion = RUNTIME_VERSION
    private readonly onWindowError = (event: ErrorEvent) => void this.reportError(event.error || event.message)
    private readonly onUnhandledRejection = (event: PromiseRejectionEvent) => void this.reportError(event.reason)
    private readonly onPageHide = () => {
        this.isPlaying = false
        this.isStartingPlay = false
        this.stopHeartbeat()
        void this.writeState()
    }

    constructor(source: DevServerSource) {
        super()
        this.source = source
    }

    get loadedNeedsSave() {
        return this._loadedNeedsSave
    }

    set loadedNeedsSave(value: boolean) {
        if (this._loadedNeedsSave === value) return
        this._loadedNeedsSave = value
        this.dispatchEvent({type: 'loadedNeedsSaveChange'})
        this.changed()
        if (this.projectLoaded) void this.writeState()
    }

    get sourceDraftDirty() {
        return this._sourceDraftDirty
    }

    setSourceDraftDirty(value: boolean) {
        if (this._sourceDraftDirty === value) return
        this._sourceDraftDirty = value
        this.changed()
        if (this.projectLoaded) void this.writeState()
    }

    selectFile(path: string) {
        this.selectedFilePath = path
        this.get().getPlugin(PickingPlugin)?.setSelectedObject(null)
        this.changed()
    }

    get(): ThreeViewer {
        if (!this.viewer) this.viewer = this.createEditViewer()
        return this.viewer
    }

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

    async loadProject(): Promise<void> {
        this.setStatus('Loading project…')
        const [serverState, entries, packageFile, assetsFile] = await Promise.all([
            this.source.state() as unknown as Promise<ServerState>,
            this.source.list(),
            this.source.read('package.json'),
            this.source.read('assets.json'),
        ])
        this.replaceManifest(entries)
        this.hashes.set('package.json', packageFile.sha256)
        this.hashes.set('assets.json', assetsFile.sha256)

        const packageJson = parsePackageJSON(decode(packageFile.bytes))
        const config = await parsePackageJsonSettingsConfig(packageJson)
        const assetsManifest = parseAssetsJSONManifest(decode(assetsFile.bytes))
        const scenePath = packageJson.mainScene
        const scene = await this.source.read(scenePath)
        const sceneText = decode(scene.bytes)
        validateSceneSource(scenePath, sceneText)
        this.hashes.set(scenePath, scene.sha256)

        this.editorVersion = serverState.versions.editor || RUNTIME_VERSION
        this.project = {
            name: serverState.name,
            path: '/',
            file: 'package.json',
            mainScene: scenePath,
            packageJson,
            config,
        }
        this.loadedProject = this.project
        this.loadedProjectFile = {path: scenePath}
        this.loadedScene = scenePath
        this.loadedPath = this.source.fileUrl(scenePath)
        this.scenePath = scenePath
        this.sceneText = sceneText
        this.generatorStates = readProjectGeneratorStates(sceneText)

        await this.prepareEditViewer(config, assetsManifest)
        await this.loadEditScene(sceneText)
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
        const entityComponents = new EntityComponentPlugin(false)
        const physics = new CannonPhysicsPlugin(true, false)
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
            new GLTFAnimationPlugin(),
            new GLTFMeshOptDecodePlugin(true, document.head),
            new KTX2LoadPlugin(),
            new KTXLoadPlugin(),
            new PLYLoadPlugin(),
            new Rhino3dmLoadPlugin(),
            new STLLoadPlugin(),
            new USDZLoadPlugin(),
            new PickingPlugin(undefined, false),
            new TransformControlsPlugin(true),
            new EditorViewWidgetPlugin('bottom-right', 100),
            new Object3DWidgetsPlugin(true),
            new Object3DGeneratorPlugin(),
            new CanvasSnapshotPlugin(),
            new AssetExporterPlugin(),
        ])
        viewer.addPluginSync(EditModePlugin)
        entityComponents.addComponentType(HtmlUiComponent)
        entityComponents.addComponentType(GeneratorComponent)
        viewer.getPlugin(GLTFAnimationPlugin)!.autoIncrementTime = false
        viewer.timeline.endTime = 0
        viewer.scene.addEventListener('sceneUpdate', this.onEditSceneUpdate)
        ;(window as Window & {viewer?: ThreeViewer}).viewer = viewer
        return viewer
    }

    private async prepareEditViewer(config: ProjectConfigSettings, assetsManifest: AssetsJSONManifest) {
        const viewer = this.get()
        const base = new URL('/files/', location.origin)
        GeneratorComponent.configureViewer(viewer, {base, onError: (error) => void this.reportError(error)})

        if (this.assetUrlModifier) viewer.assetManager.importer.removeURLModifier(this.assetUrlModifier)
        this.assetUrlModifier = createURLModifier(base, assetsManifest)
        viewer.assetManager.importer.addURLModifier(this.assetUrlModifier)

        await this.registerProjectPlugins(config)
        await this.registerProjectScripts(config)
    }

    private async registerProjectPlugins(config: ProjectConfigSettings) {
        const viewer = this.get()
        for (const definition of config.plugins) {
            if (definition.active === false) continue
            const module = await this.importProjectModule(definition.import)
            const plugin = findPluginExport(module, definition)
            if (!viewer.getPlugin(plugin)) await viewer.addPlugin(plugin, ...(definition.params || []))
        }
    }

    private async registerProjectScripts(config: ProjectConfigSettings, moduleRevision = this.moduleRevision) {
        const modules: ModuleExports[] = []
        for (const definition of config.scripts) {
            if (definition.active === false) continue
            modules.push(await this.importProjectModule(definition.import, moduleRevision))
        }
        const registered = await registerScripts(this.get(), modules)
        this.componentTypes = [
            GeneratorComponent.ComponentType,
            ...registered.components.map(({value}) => value.ComponentType),
            ...registered.plugins.map(({value}) => (value as unknown as {PluginType: string}).PluginType),
        ].filter((value, index, values) => values.indexOf(value) === index).sort()
        this.changed()
    }

    private importProjectModule(path: string, moduleRevision = this.moduleRevision): Promise<ModuleExports> {
        if (isBareModule(path)) return import(/* @vite-ignore */ path) as Promise<ModuleExports>
        const normalized = normalizeProjectPath(path)
        return import(
            /* @vite-ignore */ this.source.fileUrl(normalized, this.hashes.get(normalized), moduleRevision)
        ) as Promise<ModuleExports>
    }

    private async loadEditScene(sceneText: string) {
        const viewer = this.get()
        this.loadingScene = true
        try {
            viewer.scene.disposeSceneModels(true, true)
            viewer.scene.disposeTextures(true)
            const loaded = await viewer.load(this.source.fileUrl(this.scenePath, this.hashes.get(this.scenePath)), {
                importAsModelRoot: true,
            })
            if (!loaded?.isObject3D) throw new Error(`The main scene did not load as an Object3D: ${this.scenePath}`)
            await GeneratorComponent.waitForViewer(viewer)
            this.sceneText = sceneText
            this.generatorStates = readProjectGeneratorStates(sceneText)
            this.error = undefined
            this.loadedNeedsSave = false
            viewer.getPlugin(EditModePlugin)?.resetView()
            this.selectInitialGenerator()
        } finally {
            this.loadingScene = false
            this.changed()
        }
    }

    private selectInitialGenerator() {
        const first = this.generatorStates[0]
        if (!first) return
        const object = this.get().scene.modelRoot.getObjectByName(first.nodeName)
        if (object) this.get().getPlugin(PickingPlugin)?.setSelectedObject(object)
    }

    private onEditSceneUpdate = (event: {object?: IObject3D}) => {
        if (!this.loadingScene && !this.savingScene && event.object?.userData.blitzGenerated !== true) {
            this.loadedNeedsSave = true
        }
        this.changed()
    }

    async saveScene(): Promise<boolean> {
        if (!this.projectLoaded || !this.loadedScene || !this.loadedNeedsSave) return true
        this.savingScene = true
        this.setStatus('Saving scene…')
        try {
            const serialized = await serializeSceneGltf(this.get(), {scenePath: this.scenePath})
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

    async createCheckpoint(label = 'editor'): Promise<{hash: string} | undefined> {
        if (!this.source.checkpoint) throw new Error('Project checkpoints are unavailable.')
        if (!await this.saveScene()) return undefined
        this.setStatus('Creating checkpoint…')
        try {
            const result = await this.source.checkpoint(label)
            this.setStatus(`Checkpoint ${result.hash}`)
            AppToaster().show({
                message: `Checkpoint ${result.hash} created.`,
                intent: 'success',
                icon: 'git-commit',
                timeout: 3000,
            })
            return result
        } catch (error) {
            await this.reportError(error)
            return undefined
        }
    }

    async restoreLastCheckpoint(): Promise<{hash: string} | undefined> {
        if (!this.source.restore) throw new Error('Project restore is unavailable.')
        if (this.loadedNeedsSave && !window.confirm('Restore the last checkpoint and discard unsaved scene edits?')) return undefined
        if (this.isPlaying || this.isStartingPlay) await this.stopPlay()
        this.loadedNeedsSave = false
        this.setStatus('Restoring checkpoint…')
        try {
            const result = await this.source.restore()
            this.setStatus(`Restored checkpoint ${result.hash}`)
            AppToaster().show({
                message: `Restored checkpoint ${result.hash}.`,
                intent: 'success',
                icon: 'history',
                timeout: 3000,
            })
            return result
        } catch (error) {
            await this.reportError(error)
            return undefined
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
        this.sceneText = decode(serialized.gltf)
        this.generatorStates = readProjectGeneratorStates(this.sceneText)
        this.manifest = await this.source.list()
        this.changed()
    }

    async updateGenerator(generator: ProjectGeneratorState, module: string, params: Record<string, unknown>) {
        const object = this.get().scene.modelRoot.getObjectByName(generator.nodeName)
        if (!object) throw new Error(`Generator node not found: ${generator.nodeName}`)
        const component = EntityComponentPlugin.GetComponent(object, GeneratorComponent)
        if (!component) throw new Error(`Generator component not found on ${generator.nodeName}`)
        component.setState({module, params})
        const objectComponents = EntityComponentPlugin.GetObjectData(object)
        if (objectComponents?.[component.uuid]) objectComponents[component.uuid].state = component.stateRef
        object.setDirty?.({change: 'generator state', source: 'Blitz editor'})
        await GeneratorComponent.waitForViewer(this.get())
        this.loadedNeedsSave = true
        await this.saveScene()
        this.changed()
    }

    async requestBake(nodeName: string, force = false) {
        if (!this.source.bake) throw new Error('Bake is not supported by this project source')
        this.setStatus(`Baking ${nodeName}…`)
        await this.source.bake(nodeName, force)
    }

    private async performBake(nodeName: string) {
        const matches: IObject3D[] = []
        this.get().scene.modelRoot.traverse((object) => {
            if (object.name === nodeName) matches.push(object as IObject3D)
        })
        if (matches.length !== 1) throw new Error(`Generator node is not unique: ${nodeName}`)
        const component = EntityComponentPlugin.GetComponent(matches[0], GeneratorComponent)
        if (!component) throw new Error(`Generator component not found on ${nodeName}`)
        const children = await component.bake()
        this.loadedNeedsSave = true
        await this.saveScene()
        this.setStatus(`Baked ${nodeName}`)
        return {ok: true, nodeName, children}
    }

    async startPlay(canvas: HTMLCanvasElement): Promise<void> {
        this.playCanvas = canvas
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
            await this.appendConsoleLine(`# Blitz play log started ${new Date().toISOString()}; levels: console.warn, console.error, uncaught errors`, false)
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

    async stopPlay(): Promise<RuntimeCleanupReport | undefined> {
        const cleanup = this.game?.dispose()
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
        if (cleanup && !cleanup.ok) await this.reportCleanupFailure(cleanup)
        return cleanup
    }

    async runCheck(): Promise<EditorCheckResult> {
        if (this.checkPromise) return this.checkPromise
        const task = this.performCheck()
        this.checkPromise = task
        this.isChecking = true
        this.setStatus('Checking game…')
        this.changed()
        try {
            return await task
        } finally {
            this.isChecking = false
            if (this.checkPromise === task) this.checkPromise = undefined
            this.changed()
        }
    }

    private async performCheck(): Promise<EditorCheckResult> {
        await this.ready
        if (this.isPlaying || this.isStartingPlay) await this.stopPlay()
        const before = semanticSceneSnapshot(this.get())
        this.loadedNeedsSave = true
        const saved = await this.saveScene()
        const editableStarted = performance.now()
        const editable = authoringQualityReport(this.get())
        const editableOutcome: EditorCheckOutcome = {
            name: 'Editable',
            status: editable.ok ? 'pass' : 'fail',
            summary: editable.summary,
            codes: issueCodes(editable.issues),
            durationMs: Math.round((performance.now() - editableStarted) * 10) / 10,
            report: editable,
        }

        const canvas = document.createElement('canvas')
        canvas.width = 640
        canvas.height = 360
        canvas.style.position = 'fixed'
        canvas.style.left = '-10000px'
        document.body.append(canvas)
        const playStarted = performance.now()
        const errorStart = this.runtimeErrorCount
        let playableOutcome: EditorCheckOutcome
        try {
            await this.startPlay(canvas)
            if (!this.game) throw new Error('The game did not start.')
            await waitForViewerFrames(this.game.viewer, 30)
            const projectValidation = await this.game.runGameValidation()
            const relationships = authoringQualityReport(this.game.viewer).issues.filter(({code}) =>
                code === 'MISSING_AUTHORING_SOURCE' || code === 'RUNTIME_SOURCE_DRIFT')
            const cleanup = await this.stopPlay()
            const cleanupIssues = cleanup?.issues.filter(({severity}) => severity === 'error') || []
            const runtimeErrors = this.runtimeErrorCount - errorStart
            const playable = runtimeErrors === 0 && projectValidation.ok && relationships.length === 0 && cleanupIssues.length === 0
            const reasons = [
                runtimeErrors ? `${runtimeErrors} runtime error(s).` : '',
                !projectValidation.ok ? projectValidation.summary : '',
                relationships.length ? `${relationships.length} runtime source issue(s).` : '',
                cleanupIssues.length ? `${cleanupIssues.length} cleanup issue(s).` : '',
            ].filter(Boolean)
            playableOutcome = {
                name: 'Playable',
                status: playable ? 'pass' : 'fail',
                summary: playable ? 'The game booted and ran 30 frames without errors.' : reasons.join(' '),
                codes: issueCodes([...relationships, ...cleanupIssues]),
                durationMs: Math.round((performance.now() - playStarted) * 10) / 10,
                report: {projectValidation, cleanup, runtimeErrors, relationships},
            }
        } catch (error) {
            await this.stopPlay()
            playableOutcome = {
                name: 'Playable',
                status: 'fail',
                summary: `The game did not complete its play check: ${errorMessage(error)}`,
                codes: [],
                durationMs: Math.round((performance.now() - playStarted) * 10) / 10,
            }
        } finally {
            canvas.remove()
        }

        const persistenceStarted = performance.now()
        let persistedOutcome: EditorCheckOutcome
        if (!saved) {
            persistedOutcome = {
                name: 'Persisted', status: 'fail', summary: 'The scene could not be saved before reload.', codes: [],
            }
        } else {
            try {
                const disk = await this.source.read(this.scenePath)
                const text = decode(disk.bytes)
                validateSceneSource(this.scenePath, text)
                this.hashes.set(this.scenePath, disk.sha256)
                await this.loadEditScene(text)
                const persisted = persistenceReport(before, semanticSceneSnapshot(this.get()))
                persistedOutcome = {
                    name: 'Persisted',
                    status: persisted.ok ? 'pass' : 'fail',
                    summary: persisted.summary,
                    codes: issueCodes(persisted.issues),
                    durationMs: Math.round((performance.now() - persistenceStarted) * 10) / 10,
                    report: persisted,
                }
            } catch (error) {
                persistedOutcome = {
                    name: 'Persisted', status: 'fail', summary: `Save/Reload failed: ${errorMessage(error)}`, codes: [],
                }
            }
        }

        const outcomes = [playableOutcome, editableOutcome, persistedOutcome]
        const result: EditorCheckResult = {
            ok: outcomes.every(({status}) => status === 'pass'),
            mode: 'editor',
            checkedAt: new Date().toISOString(),
            outcomes,
        }
        await this.writeCheckResult(result)
        await this.appendConsoleLine(`[blitz check] ${outcomes.map(({name, status, codes}) =>
            `${name}=${status}${codes.length ? `(${codes.join(',')})` : ''}`).join(' ')}`)
        this.checkResult = result
        this.setStatus(result.ok ? 'Check passed' : 'Check failed')
        AppToaster().show({
            message: result.ok ? 'Playable, Editable, and Persisted checks passed.' : 'Blitz check failed. See the result cards and .blitz/check.json.',
            intent: result.ok ? 'success' : 'danger',
            icon: result.ok ? 'tick' : 'error',
            timeout: 4000,
            isCloseButtonShown: true,
        })
        return result
    }

    private async writeCheckResult(result: EditorCheckResult): Promise<void> {
        const path = '.blitz/check.json'
        let ifMatch: string | '*' = this.hashes.get(path) || '*'
        try {
            const current = await this.source.read(path)
            ifMatch = current.sha256
        } catch { /* first check */ }
        const written = await this.source.write(path, encode(`${JSON.stringify(result, null, 2)}\n`), ifMatch)
        this.hashes.set(path, written.sha256)
    }

    private async reportCleanupFailure(report: RuntimeCleanupReport): Promise<void> {
        const codes = issueCodes(report.issues)
        await this.appendConsoleLine(`[blitz stop] runtime cleanup failed: ${codes.join(', ')}`)
        AppToaster().show({
            message: `Runtime cleanup failed: ${codes.join(', ')}`,
            intent: 'danger',
            icon: 'error',
            timeout: 5000,
            isCloseButtonShown: true,
        })
    }

    private async restartPlay() {
        if (!this.isPlaying || !this.playCanvas) return
        const canvas = this.playCanvas
        this.game?.dispose()
        this.game = undefined
        this.isPlaying = false
        await this.startPlay(canvas)
    }

    async importFiles(files: Iterable<File>) {
        for (const file of files) {
            const path = uniqueImportPath(file.name, this.manifest)
            const result = await this.source.write(path, new Uint8Array(await file.arrayBuffer()), '*')
            this.hashes.set(path, result.sha256)
            const loaded = await this.get().load(this.source.fileUrl(path, result.sha256))
            if (loaded?.isObject3D && loaded.parent !== this.get().scene.modelRoot) {
                this.get().scene.addObject(loaded as IObject3D)
            }
            this.loadedNeedsSave = true
            this.setStatus(`Imported ${file.name}`)
        }
        this.replaceManifest(await this.source.list())
    }

    async importUrl(url: string) {
        const response = await fetch(url)
        if (!response.ok) throw new Error(`Unable to import ${url}: ${response.status}`)
        const name = new URL(url).pathname.split('/').pop() || 'imported-asset.glb'
        await this.importFiles([new File([await response.blob()], name)])
    }

    setWelcomeOpen(open: boolean) {
        this.welcomeOpen = open
        this.changed()
    }

    async snapshot() {
        await this.get().getPlugin(CanvasSnapshotPlugin)?.downloadSnapshot(`${this.project?.name || 'blitz'}-snapshot.png`, {
            waitForProgressive: false,
        })
    }

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

    async beforePublish(): Promise<boolean> {
        if (this.sourceDraftDirty) {
            await this.writeState()
            throw new Error('Save the unsaved source draft before publishing.')
        }
        return this.saveScene()
    }

    async sourceFileSaved(path: string, sha256: string) {
        await this.applyProjectFileChange(path, sha256, false)
        this.restoreSelectedFile(path)
    }

    unlistedScripts(): ProjectFileEntry[] {
        const listed = new Set([
            ...(this.project?.config.scripts || []).map(({import: path}) => normalizeProjectPath(path)),
            ...(this.project?.config.plugins || []).filter(({import: path}) => !isBareModule(path))
                .map(({import: path}) => normalizeProjectPath(path)),
        ])
        return this.manifest.filter(({path}) =>
            (path.endsWith('.script.js') || path.endsWith('.plugin.js')) && !listed.has(path)
        )
    }

    async writeState(error?: string) {
        const write = this.stateWriteQueue.then(async () => {
            const state: EditorState = {
                editorVersion: this.editorVersion,
                engineVersion: RUNTIME_VERSION,
                projectLoaded: this.projectLoaded,
                playState: this.isPlaying ? 'playing' : 'stopped',
                dirty: this.loadedNeedsSave || this.sourceDraftDirty,
                selectionNames: selectedNames(this.viewer),
                lastLoadError: error || this.error || null,
                updatedAt: new Date().toISOString(),
                clientId: this.source.clientId,
            }
            try {
                const sha256 = await writeEditorState(
                    this.source,
                    state,
                    this.hashes.get('.blitz/state.json') || '*',
                )
                this.hashes.set('.blitz/state.json', sha256)
            } catch (caught) {
                if (!(caught instanceof ProjectConflictError)) throw caught
            }
        })
        this.stateWriteQueue = write.catch(() => undefined)
        return this.stateWriteQueue
    }

    async reportError(error: unknown) {
        if (this.isPlaying || this.isStartingPlay) this.runtimeErrorCount += 1
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
            let ifMatch: string | '*' = this.hashes.get('.blitz/console.log') || '*'
            try {
                const current = await this.source.read('.blitz/console.log')
                previous = decode(current.bytes)
                ifMatch = current.sha256
            } catch { /* first log entry */ }
            const line = timestamp ? `${new Date().toISOString()} ${message}` : message
            const next = `${previous}${line}\n`.slice(-200_000)
            try {
                const result = await this.source.write('.blitz/console.log', encode(next), ifMatch)
                this.hashes.set('.blitz/console.log', result.sha256)
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
                this.runtimeErrorCount += 1
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
        if (event.type === 'command' && event.command === 'check' && typeof event.id === 'string') {
            try {
                const result = await this.runCheck()
                await this.source.commandResult?.(event.id, {ok: true, result})
            } catch (error) {
                await this.source.commandResult?.(event.id, {ok: false, error: errorMessage(error)})
                await this.reportError(error)
            }
            return
        }
        if (event.type === 'command' && event.command === 'bake'
            && typeof event.id === 'string' && typeof event.nodeName === 'string') {
            try {
                const result = await this.performBake(event.nodeName)
                await this.source.commandResult?.(event.id, result)
            } catch (error) {
                await this.source.commandResult?.(event.id, {ok: false, error: errorMessage(error)})
                await this.reportError(error)
            }
            return
        }
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
        const generator = this.generatorStates.find(({module}) => normalizeProjectPath(module) === path)

        if (isJavaScript) {
            const moduleRevision = String(++this.moduleReloadSequence)
            this.moduleRevision = moduleRevision
            await this.registerProjectScripts(this.project!.config, moduleRevision)
            if (generator) {
                const object = this.get().scene.modelRoot.getObjectByName(generator.nodeName)
                if (object) {
                    await runGenerator({
                        node: object as IObject3D,
                        params: generator.params,
                        viewer: this.get(),
                        module: versionedPath(generator.module, nextHash, moduleRevision),
                        base: new URL('/files/', location.origin),
                    })
                }
            }
            if (this.isPlaying) await this.restartPlay()
            this.setStatus(`${path} ${generator ? 'regenerated' : 'reloaded'}`)
        }
        this.changed()
    }

    private async reloadProject() {
        const wasPlaying = this.isPlaying
        const canvas = this.playCanvas
        if (wasPlaying) await this.stopPlay()
        if (this.viewer) {
            this.viewer.scene.removeEventListener('sceneUpdate', this.onEditSceneUpdate)
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

    dispose() {
        this.unsubscribe?.()
        this.stopHeartbeat()
        window.removeEventListener('error', this.onWindowError)
        window.removeEventListener('unhandledrejection', this.onUnhandledRejection)
        window.removeEventListener('pagehide', this.onPageHide)
        this.game?.dispose()
        if (this.viewer) {
            this.viewer.scene.removeEventListener('sceneUpdate', this.onEditSceneUpdate)
            this.viewer.dispose()
            this.viewer.container.remove()
        }
        if (this.originalConsoleError) console.error = this.originalConsoleError
        if (this.originalConsoleWarn) console.warn = this.originalConsoleWarn
        delete (window as Window & {viewer?: ThreeViewer}).viewer
    }
}

function createURLModifier(base: URL, assets: AssetsJSONManifest) {
    return (url: string): string => {
        if (url.startsWith('/blitz/@')) {
            const id = url.slice('/blitz/@'.length).split('/', 1)[0]
            const asset = assets.files[id]
            if (!asset?.path) throw new Error(`Unknown asset id in URL: ${id}`)
            return new URL(asset.path, base).href
        }
        if (url.startsWith('/blitz/')) return new URL(url.slice('/blitz/'.length), base).href
        return url
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

function isBareModule(path: string) {
    return !path.startsWith('.') && !path.startsWith('/') && !/^[a-z][a-z\d+.-]*:/i.test(path)
}

function normalizeProjectPath(path: string) {
    return path.replace(/^\.\//, '').replace(/\\/g, '/').split(/[?#]/, 1)[0]
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

function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
}

function issueCodes(issues: AuthoringValidationIssue[]): string[] {
    return [...new Set(issues.map(({code}) => code))]
}

function waitForViewerFrames(viewer: ThreeViewer, target: number): Promise<void> {
    return new Promise((resolveFrames, reject) => {
        let frames = 0
        const timeout = window.setTimeout(() => {
            viewer.removeEventListener('preFrame', onFrame)
            reject(new Error(`The game did not render ${target} frames within 10 seconds.`))
        }, 10_000)
        const onFrame = () => {
            frames += 1
            if (frames < target) {
                viewer.setDirty()
                return
            }
            window.clearTimeout(timeout)
            viewer.removeEventListener('preFrame', onFrame)
            resolveFrames()
        }
        viewer.addEventListener('preFrame', onFrame)
        viewer.setDirty()
    })
}
