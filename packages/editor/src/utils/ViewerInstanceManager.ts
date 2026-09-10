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
    createGame,
    GeneratorComponent,
    HtmlUiComponent,
    parseAssetsJSONManifest,
    parsePackageJSON,
    parsePackageJsonSettingsConfig,
    readProjectGeneratorStates,
    registerScripts,
    RUNTIME_VERSION,
    runGenerator,
    serializeSceneGltf,
    validateSceneSource,
    type AssetsJSONManifest,
    type CreatedGame,
    type ExternalPlugin,
    type ProjectConfigSettings,
    type ProjectGeneratorState,
    type ProjectPackageJSON,
    type SerializedSceneGltf,
} from '@blitzdev/engine'
import {DevServerSource} from '../DevServerSource.ts'
import {ProjectConflictError, type ProjectEvent, type ProjectFileEntry} from '../ProjectSource.ts'
import {BlueprintJsUiPlugin2} from '../UiConfigRendererBlueprint2.tsx'
import {EditModePlugin} from './EditModePlugin.ts'

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
    welcomeOpen = false
    loadedProject: EditorProject | null = null
    loadedProjectFile: LoadedProjectFile | null = null
    loadedScene: string | null = null
    loadedAssetObj: null = null
    loadedPath: string | null = null

    private _loadedNeedsSave = false
    private initializing?: Promise<void>
    private playPromise?: Promise<void>
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
    private consoleWriteQueue: Promise<void> = Promise.resolve()
    private stateWriteQueue: Promise<void> = Promise.resolve()
    private originalConsoleError?: typeof console.error
    private editorVersion = RUNTIME_VERSION
    private readonly onWindowError = (event: ErrorEvent) => void this.reportError(event.error || event.message)
    private readonly onUnhandledRejection = (event: PromiseRejectionEvent) => void this.reportError(event.reason)

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
        this.heartbeat = setInterval(() => void this.writeState(), 5_000)
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

    private async registerProjectScripts(config: ProjectConfigSettings) {
        const modules: ModuleExports[] = []
        for (const definition of config.scripts) {
            if (definition.active === false) continue
            modules.push(await this.importProjectModule(definition.import))
        }
        const registered = await registerScripts(this.get(), modules)
        this.componentTypes = [
            GeneratorComponent.ComponentType,
            ...registered.components.map(({value}) => value.ComponentType),
            ...registered.plugins.map(({value}) => (value as unknown as {PluginType: string}).PluginType),
        ].filter((value, index, values) => values.indexOf(value) === index).sort()
        this.changed()
    }

    private importProjectModule(path: string): Promise<ModuleExports> {
        if (isBareModule(path)) return import(/* @vite-ignore */ path) as Promise<ModuleExports>
        const normalized = normalizeProjectPath(path)
        return import(/* @vite-ignore */ this.source.fileUrl(normalized, this.hashes.get(normalized))) as Promise<ModuleExports>
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
            const entries = await this.source.list()
            const fileRevisions = Object.fromEntries(entries.map(({path, sha256}) => [path, sha256]))
            this.get().renderEnabled = false
            this.game = await createGame({
                base: new URL('/files/', location.origin).href,
                canvas: this.playCanvas,
                fileRevisions,
                onError: (error) => void this.reportError(error),
            })
            this.isPlaying = true
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

    async stopPlay() {
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
        const serialized = await serializeSceneGltf(this.get(), {scenePath: this.scenePath})
        downloadBlob(new Blob([serialized.gltf as BlobPart], {type: 'model/gltf+json'}), this.scenePath.split('/').pop() || 'scene.gltf')
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
            const state = {
                editorVersion: this.editorVersion,
                engineVersion: RUNTIME_VERSION,
                projectLoaded: this.projectLoaded,
                playState: this.isPlaying ? 'playing' : 'stopped',
                selectionNames: selectedNames(this.viewer),
                lastLoadError: error || this.error || null,
                updatedAt: new Date().toISOString(),
                clientId: this.source.clientId,
            }
            try {
                const result = await this.source.write(
                    '.blitz/state.json',
                    encode(`${JSON.stringify(state, null, 2)}\n`),
                    this.hashes.get('.blitz/state.json') || '*',
                )
                this.hashes.set('.blitz/state.json', result.sha256)
            } catch (caught) {
                if (!(caught instanceof ProjectConflictError)) throw caught
            }
        })
        this.stateWriteQueue = write.catch(() => undefined)
        return this.stateWriteQueue
    }

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
        const write = this.consoleWriteQueue.then(async () => {
            let previous = ''
            let ifMatch: string | '*' = this.hashes.get('.blitz/console.log') || '*'
            try {
                const current = await this.source.read('.blitz/console.log')
                previous = decode(current.bytes)
                ifMatch = current.sha256
            } catch { /* first log entry */ }
            const next = `${previous}${new Date().toISOString()} ${message}\n`.slice(-200_000)
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
        console.error = (...values: unknown[]) => {
            this.originalConsoleError?.(...values)
            if (this.isPlaying || this.isStartingPlay) {
                void this.appendConsoleError(`[console.error] ${values.map(formatConsoleValue).join(' ')}`)
            }
        }
    }

    private async onProjectEvent(event: ProjectEvent) {
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

        if (event.path === this.scenePath) {
            if (this.loadedNeedsSave && !window.confirm('Changed on disk: reload and discard the editor copy?')) {
                this.setStatus('Kept unsaved editor scene')
                return
            }
            const disk = await this.source.read(this.scenePath)
            const text = decode(disk.bytes)
            validateSceneSource(this.scenePath, text)
            this.hashes.set(this.scenePath, disk.sha256)
            await this.loadEditScene(text)
            this.setStatus('Scene reloaded from disk')
            return
        }

        const entries = await this.source.list()
        this.manifest = entries
        const nextHash = entries.find(({path}) => path === event.path)?.sha256
        if (nextHash) this.hashes.set(event.path, nextHash)
        else this.hashes.delete(event.path)

        if (event.path === 'package.json' || event.path === 'assets.json') {
            await this.reloadProject()
            return
        }

        const isListedModule = this.project && [
            ...this.project.config.scripts.map(({import: path}) => normalizeProjectPath(path)),
            ...this.project.config.plugins.filter(({import: path}) => !isBareModule(path))
                .map(({import: path}) => normalizeProjectPath(path)),
        ].includes(event.path)
        const generator = this.generatorStates.find(({module}) => normalizeProjectPath(module) === event.path)

        if (isListedModule) {
            await this.registerProjectScripts(this.project!.config)
            if (this.isPlaying) await this.restartPlay()
            this.setStatus(`${event.path} reloaded`)
        } else if (generator) {
            const object = this.get().scene.modelRoot.getObjectByName(generator.nodeName)
            if (object) {
                await runGenerator({
                    node: object as IObject3D,
                    params: generator.params,
                    viewer: this.get(),
                    module: versionedPath(generator.module, nextHash),
                    base: new URL('/files/', location.origin),
                })
            }
            if (this.isPlaying) await this.restartPlay()
            this.setStatus(`${event.path} regenerated`)
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

    dispose() {
        this.unsubscribe?.()
        if (this.heartbeat) clearInterval(this.heartbeat)
        window.removeEventListener('error', this.onWindowError)
        window.removeEventListener('unhandledrejection', this.onUnhandledRejection)
        this.game?.dispose()
        if (this.viewer) {
            this.viewer.scene.removeEventListener('sceneUpdate', this.onEditSceneUpdate)
            this.viewer.dispose()
            this.viewer.container.remove()
        }
        if (this.originalConsoleError) console.error = this.originalConsoleError
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

function versionedPath(path: string, sha256?: string) {
    if (!sha256) return path
    const separator = path.includes('?') ? '&' : '?'
    return `${path}${separator}v=${encodeURIComponent(sha256)}`
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
