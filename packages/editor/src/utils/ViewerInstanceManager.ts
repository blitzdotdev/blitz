import {
    AssetExporterPlugin,
    BoxGeometry,
    CanvasSnapshotPlugin,
    DepthBufferPlugin,
    DirectionalLight2,
    EditorViewWidgetPlugin,
    EntityComponentPlugin,
    EventDispatcher,
    FrameFadePlugin,
    GBufferPlugin,
    generateUUID,
    getEmptyMeta,
    GLTFAnimationPlugin,
    GLTFLoader2,
    GLTFMeshOptDecodePlugin,
    HalfFloatType,
    HemisphereLight2,
    htmlDialogWrapper,
    IGeometry,
    IMaterial,
    ImportResult,
    ImportResultExtras,
    IObject3D,
    ISerializedViewerConfig,
    ITexture,
    JSONMaterialLoader,
    KTX2LoadPlugin,
    KTXLoadPlugin,
    LoadingScreenPlugin,
    mergeResources,
    Mesh2,
    metaToResources,
    NormalBufferPlugin,
    Object3DGeneratorPlugin,
    Object3DWidgetsPlugin,
    OrbitControls3,
    PickingPlugin,
    PlaneGeometry,
    PLYLoadPlugin,
    PopmotionPlugin,
    RenderTargetPreviewPlugin,
    Rhino3dmLoadPlugin,
    STLLoadPlugin,
    ThreeViewer,
    TransformControlsPlugin,
    TypedClass,
    UndoManagerPlugin,
    UnlitMaterial,
    USDZLoadPlugin
} from 'threepipe'
import {BlueprintJsUiPlugin2} from '../UiConfigRendererBlueprint2.tsx'
import {GeometryGeneratorPlugin} from '@threepipe/plugin-geometry-generator'
import {createProjectAssetURLModifier} from '@kite3d/engine/projectFormat'
import {serializeSceneGltf} from '@kite3d/engine/sceneSerialization'
import {EditorFeatures} from './EditorFeatures.ts'
import {EditModePlugin} from "./EditModePlugin.ts";
import {FileManifestEntry, manifestEntryToFile, SelectedInspectorItem} from "./AssetsProvider.ts";
import {
    AssetsJSONManifest,
    assetUrlPrefix,
    initProjectHandles,
    LoadedProject,
    parseAssetsJSONManifest,
    parsePackageJsonSettings,
    resolveFile,
    SavedSceneFile,
    SavedSceneFileMeta,
    settingsKey
} from "./project.ts";
import {ProjectDirectoryHandle, ProjectManifest} from "../devserver/handles.ts";
import {DevServerSource, ProjectConflictError, ProjectEvent} from "../devserver/DevServerSource.ts";
import {ask, AskChoice} from "./AskDialog.tsx";
import {AnotherFSHelper, getDirHandle, getFileHandle} from "./fsApi.ts";
import {AssetTracker, cloneAssetItem, defSPropsMat, defSPropsObj} from "./AssetTracker.ts";
import {CannonPhysicsPlugin} from "../plugins/cannon/CannonPhysicsPlugin.ts";
import {CanvasFileDropHandler} from "./CanvasFileDropHandler.tsx";
import {HtmlUiComponent} from "../plugins/HtmlUiComponent.ts";
import {generatePreview} from "./three/GeneratePreview.ts";
import {mimeToExt, typesExts} from '../data/fileTypes.ts'
import {ScriptUtil} from "./ScriptUtil.ts";
import {TExternalFile} from "../components/ExternalFilesPanel.tsx";
import {queryClient} from "../tsdb/client.ts";
import {fetchQueryFunc, libAssetEndpoints} from "../tsdb/libAsset.ts";
import z from "zod";
import {PlayModeHelper} from "./PlayModeHelper.ts";
import {EditPreviewHelper} from "./EditPreviewHelper.ts";
import {ProjectSettingsManager} from "./ProjectSettingsManager.ts";
import {
    backupPath,
    canMakeAsset,
    canSaveAsset,
    isExternalObject,
    isLoadableFile,
    isPackageProject, SelectFileRef,
    thumbPath
} from "./projectUtils.ts";

export interface ViewerProps {
    msaa: boolean,
    rgbm: boolean,
    zPrepass: boolean
    renderScale: number | 'auto'
    debug: boolean
    tonemap: boolean
}

export class ViewerInstanceManager extends EventDispatcher<{
    loadedNeedsSaveChange: {},
    loadedProjectFileChange: {},
    projectFilesChange: {},
    // assetRegistryChange: {},
}>{
    private _viewers = new Map<string, ThreeViewer>()
    features = new EditorFeatures(this)
    scriptUtil = new ScriptUtil()
    playMode = new PlayModeHelper(this)
    editPreview = new EditPreviewHelper(this.features)
    settingsManager = new ProjectSettingsManager(this)
    fsHelper = new AnotherFSHelper()

    constructor(readonly source: DevServerSource, readonly manifest: ProjectManifest) {
        super()
        this.scriptUtil.onObserveFileChange = this.onObserveFileChange
        this.scriptUtil.fileUrl = (path, revision)=>
            this.source.fileUrl(path, this.manifest.files.get(path)?.sha256, revision)
    }

    private unsubscribeEvents: (() => void) | null = null

    /** Opens the change stream, so a write by anyone else reaches this tab. */
    initialize() {
        this.unsubscribeEvents = this.source.events((event) => void this.onProjectEvent(event))
    }

    get(props?: Partial<ViewerProps>, id = 'default', container?: HTMLElement) {
        const viewer = this._viewers.get(id) ?? this._create(props, id)
        if (container && viewer && viewer.container.parentElement !== container) {
            viewer.container.remove()
            container.appendChild(viewer.container)
        }
        return viewer
    }

    private _trackerReplaceItem = (e: { old: ImportResult, new: ImportResult })=>{
        const picking = this.get()?.getPlugin(PickingPlugin)
        if(picking){
            if(e.old === picking.getSelectedObject()){
                picking.setSelectedObject(e.new as any)
            }
        }
    }

    protected _create(props?: Partial<ViewerProps>, id = 'default') {
        const container = document.createElement('div')
        container.style.width = '100%'
        container.style.height = '100%'
        container.style.maxWidth = '100%'
        container.style.maxHeight = '100%'
        container.style.display = 'block'
        container.style.position = 'relative'
        container.style.zIndex = '0'
        // document.body.appendChild(container)
        const viewer = new ThreeViewer({
            container,
            debug: true,
            rgbm: false,
            msaa: true,
            zPrepass: false,
            renderScale: "auto",
            ...props,
            assetManager: {
                //todo
                simpleCache: false,
                storage: false,
            },
            dropzone: {
                //todo
            },
            plugins: []
            // todo: add more options
        })
        this.scriptUtil.viewer = viewer

        // override autoSetName logic to account for asset id paths
        viewer.assetManager.importer.autoSetName = false
        viewer.assetManager.importer.addEventListener('processRaw', (event) => {
            const res = event.data
            const rootPath = res.__rootPath
            // const rootPathOptions = res.__rootPathOptions
            const rootBlob = res.__rootBlob
            if (res?.name === '') {
                res.name = this.resolveAssetIdPath(rootBlob?.filePath || rootBlob?.name || rootPath || '')
                    .replace(/^\/|\/$/, '')
                    .split('/').pop()!
            }
        })

        const tracker = new AssetTracker(viewer)
        tracker.isEditor = true
        viewer.assetManager.tracker = tracker
        tracker.addEventListener('replaceItem', this._trackerReplaceItem)
        tracker.addEventListener('registryChanged', this.handlePreviewRefresh)

        // viewer.getPlugin(DropzonePlugin)!.enabled = false

        if(id === 'default' && this.loadedProject){
            console.error('Viewer recreated while the project is loaded, this will create issues with plugins, scripts')
        }
        if(id === 'default'){
            (window as any).viewer = viewer
        }

        viewer.canvas.style.width = '100%'
        viewer.canvas.style.height = '100%'
        viewer.addPluginSync(BlueprintJsUiPlugin2)

        EntityComponentPlugin.AddObjectUiConfig = false
        ThreeViewer.Dialog = htmlDialogWrapper
        GLTFLoader2._EmbedResourcePath = false // todo this should be true when the glb path is relative, not with ids

        JSONMaterialLoader.FindExistingMaterial = false // this is required for material asset loading same instance
        KTX2LoadPlugin.SAVE_SOURCE_BLOBS = true // so that embedded ktx files can be exported after import

        viewer.addPluginsSync([
            // LoadingScreenPlugin,
            // AssetExporterPlugin,
            // GLTFDracoExportPlugin,
            // GLTFSpecGlossinessConverterPlugin,
            PopmotionPlugin,
            new EntityComponentPlugin(false),
            new CanvasFileDropHandler(this),
            // AnimationObjectPlugin,
            // new ProgressivePlugin(),
            // new SSAAPlugin(),
            GLTFAnimationPlugin,
            // TransformAnimationPlugin,
            new GBufferPlugin(HalfFloatType, true, true, true),
            // new DepthBufferPlugin(HalfFloatType, false, false),
            // new NormalBufferPlugin(HalfFloatType, false),
            // CameraViewPlugin,
            // FullScreenPlugin,
            new PickingPlugin(undefined, false), // false to disable built-in picking uiconfig
            // ObjectConstraintsPlugin,
            new TransformControlsPlugin(true),
            // OutlinePlugin,
            new EditorViewWidgetPlugin('bottom-right', 100),
            // ViewerUiConfigPlugin,
            // ClearcoatTintPlugin,
            // FragmentClippingExtensionPlugin,
            // NoiseBumpMaterialPlugin,
            CannonPhysicsPlugin,
            // CustomBumpMapPlugin,
            // AnisotropyPlugin,
            // new ParallaxMappingPlugin(false),
            // GLTFKHRMaterialVariantsPlugin,
            // VirtualCamerasPlugin,
            // new SceneUiConfigPlugin(), // this is already in ViewerUiPlugin
            // new RenderTargetPreviewPlugin(false),
            // new FrameFadePlugin(),
            // new HDRiGroundPlugin(false, true),
            // new VignettePlugin(false),
            // new ChromaticAberrationPlugin(false),
            // new FilmicGrainPlugin(false),
            // new SSAOPlugin(UnsignedByteType, 1),
            // SSReflectionPlugin,
            // new SSContactShadowsPlugin(false),
            // new DepthOfFieldPlugin(false),
            // BloomPlugin,
            // TemporalAAPlugin, new VelocityBufferPlugin(UnsignedByteType, false),
            // new SSGIPlugin(/*UnsignedByteType*/undefined, 1, false),
            KTX2LoadPlugin, KTXLoadPlugin, PLYLoadPlugin, Rhino3dmLoadPlugin, STLLoadPlugin, USDZLoadPlugin,
            // BlendLoadPlugin,
            new Object3DWidgetsPlugin(true),
            Object3DGeneratorPlugin,
            GeometryGeneratorPlugin,
            // GaussianSplattingPlugin, // todo embedded serialize
            // ContactShadowGroundPlugin,
            // AdvancedGroundPlugin,
            CanvasSnapshotPlugin,
            // DeviceOrientationControlsPlugin,
            // PointerLockControlsPlugin,
            // ThreeFirstPersonControlsPlugin,
            // InteractionPromptPlugin, // todo disable when not in Viewer tab, like in webgi
            // new MeshOptSimplifyModifierPlugin(false, document.head), // will auto-initialize on first use.
            new GLTFMeshOptDecodePlugin(true, document.head),
            // new BasicSVGRendererPlugin(false, true),
            // ...extraImportPlugins,
            // MaterialConfiguratorPlugin,
            // SwitchNodePlugin,
            // AWSClientPlugin, // todo
            // TransfrSharePlugin, // todo
            //
            // EnvironmentControlsPlugin, GlobeControlsPlugin,
            // B3DMLoadPlugin, I3DMLoadPlugin, PNTSLoadPlugin, CMPTLoadPlugin,
            // TilesRendererPlugin, DeepZoomImageLoadPlugin, /* SlippyMapTilesLoadPlugin,*/
            // new AssimpJsPlugin(false),
            // new ThreeGpuPathTracerPlugin(false),
            // new TimelineUiPlugin(false, document.body), // todo
            // TroikaTextPlugin,
            // new CascadedShadowsPlugin(false),
            new AssetExporterPlugin()

        ])
        viewer.timeline.endTime = 0 // infinite
        viewer.getPlugin(PickingPlugin)!.widgetEnabled = false
        viewer.getPlugin(EditorViewWidgetPlugin)!.enabled = false
        viewer.getPlugin(TransformControlsPlugin)!.selectionFilterTest = (obj)=>{
            // todo return the first parent that is not external
            return isExternalObject(obj) ? null : obj
        }

        viewer.addPluginSync(EditModePlugin)
        viewer.assetManager.importer.cacheImportedAssets = false

        viewer.assetManager.importer.addURLModifier(this.resolveAssetUrl)

        // todo when an asset file is loaded (right now only materials), watch for file changes and import it again as in inspector

        // todo use forPlugin
        // to show more details in the UI and allow to edit changes in title etc.
        // const mat = viewer.getPlugin(MaterialConfiguratorPlugin)
        // mat && (mat.enableEditContextMenus = true)
        // const swi = viewer.getPlugin(SwitchNodePlugin)
        // swi && (swi.enableEditContextMenus = true)

        viewer.getPlugin(GLTFAnimationPlugin)!.autoIncrementTime = false

        viewer.getPlugin(PickingPlugin)!.picker!.pickingMode = 'object'
        viewer.getPlugin(EntityComponentPlugin)?.addComponentType(HtmlUiComponent)

        // disable fading on update
        const fade = viewer.getPlugin(FrameFadePlugin)
        fade && (fade.isEditor = true)

        // const taa = viewer.getPlugin(TemporalAAPlugin)
        // taa && (taa.stableNoise = true)

        const rt = viewer.getPlugin(RenderTargetPreviewPlugin)
        if(rt) {
            rt.addTarget(viewer.getPlugin(DepthBufferPlugin)?.target, 'depth', false, false, false)
            rt.addTarget(viewer.getPlugin(NormalBufferPlugin)?.target, 'normal', false, true, false)
        }

        const loadingPlugin = viewer.getPlugin(LoadingScreenPlugin)
        if (loadingPlugin) {
            loadingPlugin.isEditor = true
            loadingPlugin.hide()
        }

        // const hemiLight = viewer.scene.addObject(new HemisphereLight(0xffffff, 0x444444, 5), {addToRoot: true})
        // hemiLight.name = 'Hemisphere Light'

        // viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr')
        // console.log(viewer)

        this._viewers.set(id, viewer)
        ;(viewer as any)._props = {...props}
        return viewer
    }

    remove(id = 'default') {
        const viewer = this._viewers.get(id)
        if (viewer) {
            if(id === 'default'){
                this.defaultViewerSettings = null
                viewer.removeEventListener('addPlugin', this._viewerPluginAdded)
                delete (window as any).viewer
            }
            this._disposeViewer(viewer)
            this._viewers.delete(id)
        }
    }

    private _disposeViewer(viewer: ThreeViewer) {
        const tracker = viewer.assetManager.tracker
        tracker?.removeEventListener('replaceItem', this._trackerReplaceItem)
        viewer.dispose()
        viewer.container.remove()
    }

    reset(props?: Partial<ViewerProps>, id = 'default') {
        const v = this._viewers.get(id)
        if (!v) return this.get(props, id)
        if (JSON.stringify((v as any)._props ?? {}) === JSON.stringify(props ?? {})) {
            v.scene.disposeSceneModels(true, true)
            v.scene.disposeTextures(true)
            return v
        }

        // todo set property instead of recreating the viewer
        this.remove(id)
        return this.get(props, id)
    }

    dispose() {
        this.unsubscribeEvents?.()
        this.unsubscribeEvents = null
        this._viewers.forEach(this._disposeViewer)
        this._viewers.clear()
    }

    /**
     * One file event, from this tab or from anyone else. The listing is always brought up to date;
     * what else happens depends on what the path is to this tab.
     */
    private onProjectEvent = async (event: ProjectEvent) => {
        if (event.type === 'command') return                    // the screenshot answer is its own pass
        if (event.client === this.source.clientId) return        // this tab wrote it, its base is already the new sha
        this.manifest.apply(event)
        if (event.path === this.loadedProjectFile?.path) await this.openFileChangedOnDisk()
        // package.json and assets.json reload the settings, a module re-imports: the queue does both
        else if (event.path === 'package.json' || event.path === 'assets.json' || /\.m?js$/i.test(event.path)) {
            this.scriptUtil.changedFilesQ.push(event.path)
            await this.scriptUtil.refreshChangedFilesQ()
        } else this.scheduleAssetRefresh(event.path)
        this.dispatchEvent({type: 'projectFilesChange'})
    }

    /** The open file changed under the editor. A clean editor takes the disk copy, a dirty one asks. */
    private async openFileChangedOnDisk() {
        const path = this.loadedProjectFile?.path
        if (!path) return
        if (this.loadedNeedsSave && await this.sceneDiffersFromSaved()) {
            const reload = await ask('Changed on disk', `${path} changed on disk. Reload it and discard the editor copy?`, [
                {label: 'Keep editing', value: false},
                {label: 'Reload', value: true, intent: 'danger'},
            ])
            if (!reload) return
        }
        await this.reloadOpenFile()
    }

    // The text this tab last loaded or saved for the open scene.
    private savedSceneHash: string | null = null

    /**
     * The dirty flag follows scene events, and a load or a save can leave one queued for the next
     * frame. Serializing is the answer that cannot be wrong, so it settles the cases that discard work.
     */
    private async sceneDiffersFromSaved(): Promise<boolean> {
        if (!this.loadedScene || !this.savedSceneHash) return true
        const {gltf} = await serializeSceneGltf(this.get(), {scenePath: this.loadedScene})
        return await sha256Hex(gltf) !== this.savedSceneHash
    }

    /** The edit camera takes the scene's own camera, so a scene opens where it was authored. */
    private restoreEditCamera() {
        const viewer = this.get()
        const editMode = viewer.getPlugin(EditModePlugin)
        if (!editMode) return
        const saved = viewer.scene.defaultCamera
        editMode.cameraMode = saved.isPerspectiveCamera ? 'perspective' : 'orthographic'
        const camera = editMode.cameraMode === 'orthographic' ? editMode.cameraOrtho : editMode.cameraPerspective
        camera.position.copy(saved.position)
        camera.quaternion.copy(saved.quaternion)
        camera.target.copy(saved.target)
        camera.setDirty({change: 'transform'})
    }

    /** Replaces the open file with the copy on disk. Unsaved edits are lost. */
    private async reloadOpenFile() {
        const project = this.loadedProject
        const path = this.loadedProjectFile?.path
        if (!project || !path) return
        await this.loadProjectFile(await this.getLoadedFile(project, path), true)
    }

    // One timer per asset: Blender writes the .gltf, its .bin and its textures within a few ms.
    private assetRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>()

    private scheduleAssetRefresh(path: string) {
        const owner = this.assetOwning(path)
        if (!owner) return
        clearTimeout(this.assetRefreshTimers.get(owner))
        this.assetRefreshTimers.set(owner, setTimeout(() => {
            this.assetRefreshTimers.delete(owner)
            void this.refreshAsset(owner).catch(e => console.error('Unable to refresh changed asset', owner, e))
        }, 250))
    }

    /** Re-imports the asset, so every placed instance shows the new file and keeps its own transform. */
    private async refreshAsset(assetPath: string) {
        const project = this.loadedProject
        if (!project) return
        const key = await this.toAssetIdPath({path: assetPath})
        const tracker = this.get().assetManager.tracker
        if (!tracker.registry[key]) return                       // on disk, never placed: nothing to refresh
        const file: File = await resolveFile(assetPath, project.handle)
        await tracker.refreshFromRegistry(key, {importedFile: file}).pms
    }

    /** The assets.json entry this file belongs to: the asset, one of its listed files, or its sibling .bin. */
    private assetOwning(path: string): string | null {
        const assets = Object.values(this.loadedProject?.assetsManifest?.files ?? {})
        const sibling = path.replace(/\.bin$/i, '.gltf')
        const owner = assets.find(a => a.path === path || a.path === sibling || Object.values(a.files ?? {}).includes(path))
        return owner?.path ?? null
    }

    // assetsManifest is replaced on every asset id write, so every lookup goes through the current one
    private resolveAssetUrl = (url: string) => {
        const assets = this.loadedProject?.assetsManifest
        return assets ? createProjectAssetURLModifier(this.filesBase, assets)(url) : url
    }
    private readonly filesBase = new URL('/files/', location.href)

    async getLoadedFile(project: LoadedProject, path: string, file?: File): Promise<SavedSceneFile | null> {
        if (!project || !path) return null
        file = file ?? await resolveFile(path, project.handle)
        if(typeof file !== 'object') {
            if((!file || file === path) && path.endsWith('.scene.gltf')){
                // empty file, handled in loadImport
                file = new File([''], path.split('/').pop() || 'scene.scene.gltf', {type: 'model/gltf+json', lastModified: Date.now()})
            }else if(file) {
                console.error('Not supported file - ', file)
                return null
            }
        }
        if(!file) return null
        return {
            path,
            file,
            lastModified: file.lastModified,
            // preview: null,
            handle: project.handle,
        }
    }

    async initReadWriteProject(meta: SavedSceneFileMeta): Promise<LoadedProject>{
        const init = await initProjectHandles(meta)

        if(!init.package.file){
            throw new Error('No package.json file in project')
        }

        if(meta.assets) {
            const p = meta.assets.replace(/\/$/, '')
            let assetsDirHandle = await init.base.getDirectoryHandle(p).catch((e) => {
                // todo handle if there is dir with same name
                // if(e.name === "NotFoundError") return null
                if(e.name === "TypeMismatchError") {
                    throw new Error(`A file with the name "${p}" exists in the project folder, cannot continue`)
                }
                return undefined
            })
            if (!assetsDirHandle) {
                assetsDirHandle = await init.base.getDirectoryHandle(p, {create: true}).catch(e=>{
                    console.error('ThreeEditor - cannot create assets dir', e)
                    return undefined
                })
            }
        }


        if(!init.mainJs.file) {
            console.error('No main.js file in project')
        }

        // asset manifest.json
        if(!init.assetsJson.handle || !init.assetsJson.file){
            const file = new File([JSON.stringify({
                files: {},
                version: 1,
            } as AssetsJSONManifest)], 'assets.json', {type: 'application/json', lastModified: Date.now()})
            const w = await this.fsHelper.writeFile(init.base, 'assets.json', file, true).catch(e=>{
                console.error('ThreeEditor - cannot write default assets.json file', e)
                return false
            })
            // if(!w) throw new Error('No assets.json file in project and cannot create one')
            if(w) init.assetsJson.file = file
        }
        if(!init.assetsJson.file) {
            // throw new Error('No assets.json file in project')
            console.error('No assets.json file in project and cannot create one')
        }

        try {
            const m = await parsePackageJsonSettings(init.package.file, meta)
            const assetsJsonText = init.assetsJson.file ? await init.assetsJson.file.text() : ''
            const json = parseAssetsJSONManifest(assetsJsonText)
            m.assetsManifest = json
            return m
        }catch (e){
            console.error('ThreeEditor - cannot read package.json file', e)
            throw new Error('Cannot read package.json file')
        }
    }

    async addIdToAssetsManifest(file: FileManifestEntry| { path: string, file?: File }, assetId?: string){
        assetId = assetId || readableAssetId(file.path, this.loadedProject?.assetsManifest)
        const project = this.loadedProject
        if(!project?.handle) throw new Error('No handle to add asset to manifest')
        const handle = project.handle
        const fileName = 'assets.json'
        let fileHandle = await handle.getFileHandle(fileName).catch((e) => {
            // todo handle if there is dir with same name
            // if(e.name === "NotFoundError") return null
            // if(e.name === "TypeMismatchError") return true
            return undefined
        })
        if(!fileHandle) throw new Error('No file handle for assets manifest')
        let fileObj = await fileHandle.getFile()
        const text = await fileObj.text()

        const json = parseAssetsJSONManifest(text)

        // todo version check etc

        // todo checksum
        if('isFSEntry' in file && file.isFSEntry){

        }

        json.files[assetId] = {path: file.path}

        project.assetsManifest = json

        // write file
        const newFile = new File(
            [JSON.stringify(json, null, 2)],
            fileName,
            {type: 'application/json', lastModified: Date.now()}
        )
        const saved = await this.fsHelper.writeFile(project.handle, fileName, newFile).catch(e => {
            console.error(e)
            return false
        })
        if (!saved) {
            throw new Error('Failed to save assets manifest file')
        }
        return assetId
    }

    /** Runs an export with the editor's own grid, gizmos, picking and components out of the way. */
    private async withEditorHidden<T>(run: (viewer: ThreeViewer) => Promise<T>): Promise<T> {
        const viewer = this.get()
        this.features.disable('edit-mode', 'exportScene')
        this.features.disable('picking', 'exportScene')
        viewer.getPlugin(EntityComponentPlugin)?.disable('exportScene')

        const controls = viewer.scene.mainCamera.controls as OrbitControls3|undefined
        if(controls?.stopDamping) controls.stopDamping()

        try {
            return await run(viewer)
        } finally {
            this.features.enable('edit-mode', 'exportScene')
            this.features.enable('picking', 'exportScene')
            viewer.getPlugin(EntityComponentPlugin)?.enable('exportScene')
        }
    }

    /** Holds the frame still while an exporter walks the scene. */
    private async whileNotRendering<T>(viewer: ThreeViewer, run: () => Promise<T>): Promise<T> {
        const renderEnabled = viewer.renderEnabled
        viewer.renderEnabled = false
        try {
            return await run()
        } finally {
            viewer.renderEnabled = renderEnabled
        }
    }

    /**
     * The scene as the project's text glTF. The sidecars, its buffer and any embedded image, are
     * written next to it; the `.gltf` itself is returned so the save writes it with its own base sha.
     */
    async exportScene(scenePath: string, takePreview = true) {
        if(this.playMode.isRunningMode){
            return {
                error: 'cannot export scene while running/playing'
            }
        }
        const handle = this.loadedProject?.handle
        if (!handle) return {error: 'no project to export the scene into'}

        const exported = await this.withEditorHidden(async (viewer)=>{
            const serialized = await this.whileNotRendering(viewer, ()=>serializeSceneGltf(viewer, {scenePath}))
            // The thumbnail is taken while the grid and the gizmos are still hidden.
            const snapshot = takePreview && viewer.renderEnabled
                ? await viewer.getPlugin(CanvasSnapshotPlugin)!.getFile('snapshot.jpeg', {
                    mimeType: 'image/jpeg',
                    quality: 0.85,
                    waitForProgressive: false,
                })
                : null
            return {serialized, preview: snapshot ? new File([snapshot], 'preview.jpg', {type: 'image/jpeg'}) : ''}
        }).catch(e=>{
            console.error('Failed to export scene', e)
            return undefined
        })
        if (!exported) return {error: 'failed to export scene'}

        for (const sidecar of exported.serialized.files) {
            const bytes = sidecar.bytes as Uint8Array<ArrayBuffer>   // every producer allocates a plain ArrayBuffer
            await this.fsHelper.writeFile(handle, sidecar.path, new File([bytes], sidecar.path.split('/').pop()!))
        }
        // A scene whose last mesh went away has no buffer left, so its .bin would be stale bytes on disk.
        const binPath = scenePath.replace(/\.gltf$/i, '.bin')
        if (!exported.serialized.files.some(f=>f.path === binPath) && this.manifest.files.has(binPath)) {
            await this.source.delete(binPath)
            this.manifest.files.delete(binPath)
            this.manifest.based.delete(binPath)
        }

        return {
            file: new File([exported.serialized.gltf as Uint8Array<ArrayBuffer>], scenePath.split('/').pop()!, {type: 'model/gltf+json'}),
            preview: exported.preview,
        }
    }

    /** The scene as one self-contained glTF. Play holds it in memory and reloads it on Stop. */
    async exportRunningScene() {
        const blob = await this.withEditorHidden((viewer)=>this.whileNotRendering(viewer, ()=>viewer.exportScene({
            binary: false,
            exportExt: 'gltf',
            preserveUUIDs: true,
            viewerConfig: true,
        }))).catch(e=>{
            console.error('Failed to export the running scene', e)
            return undefined
        })
        if (!blob) return {error: 'failed to export scene'}
        return {file: new File([blob], 'running.gltf', {type: 'model/gltf+json'})}
    }

    async exportObject(obj: IObject3D|IMaterial, name = 'asset') {
        const viewer = this.get()
        if (!viewer) {
            return {
                error: 'no viewer'
            }
        }

        if(this.playMode.isRunningMode){
            return {
                error: 'cannot export object while running/playing'
            }
        }

        // this.features.disable('edit-mode', 'exportScene')
        // this.features.disable('picking', 'exportScene')

        const controls = viewer.scene.mainCamera.controls as OrbitControls3|undefined
        if(controls?.stopDamping) controls.stopDamping()
        // todo disable interactions etc?

        // todo any other plugin/editor features to disable?

        const ext = (obj as IMaterial).isMaterial ? 'mat' : 'glb'
        const blob = await viewer?.export(obj, {
            exportExt: ext,
            binary: true,
            // do not save uuid when saving glb asset object
            // preserveUUIDs: !(obj as IObject3D).isObject3D, // only for objects
            preserveUUIDs: true, // always save
            viewerConfig: false,
        })
        if (!blob) {
            return {
                error: 'failed to export scene'
            }
        }
        const mimes = {
            glb: 'model/gltf-binary',
            mat: 'application/json',
        }
        const file = new File([blob], name + '.' + ext, {type: mimes[ext] || 'application/octet-stream'})

        // const snapshotPlugin = viewer.getPlugin(CanvasSnapshotPlugin)!
        // const preview = await snapshotPlugin.getFile('snapshot.jpeg', {
        //     mimeType: 'image/jpeg',
        //     quality: 0.85,
        //     waitForProgressive: true,
        //     progressiveFrames: Math.min(64, viewer.getPlugin(ProgressivePlugin)?.maxFrameCount??64),
        // })
        const preview = null

        const previewFile = !preview ? '' : new File([preview], 'preview.jpg', {type: 'image/jpeg'})

        // this.features.enable('edit-mode', 'exportScene')
        // this.features.enable('picking', 'exportScene')

        return {file, preview: previewFile, ext}
    }

    // Returns a result only when the asset did not land on disk; the caller stops on it.
    async writeAssetFile(obj: IObject3D|IMaterial, assetId: string, handle: ProjectDirectoryHandle, assetPath: string, res: {file: File, preview?: string | File}) {
        const res1 = await this.writeResolvingConflict(handle, assetPath, res.file).catch(e => {
            console.error('Failed to save asset file.', e)
            return null
        })
        if(!res1){
            // delete obj.userData.tpAssetId
            return {error: 'Failed to save asset file.'}
        }
        if(res1 !== 'written'){
            return res1 === 'reloaded'
                ? {error: null, warn: `Reloaded ${assetPath} from disk. The editor copy is gone.`}
                : {error: null, warn: `${assetPath} changed on disk. Nothing was saved.`}
        }
        // todo
        //  save preview thumbnail

        const ext = assetPath.split('.').pop() || 'glb'
        ;(obj as ImportResultExtras).__rootPath = assetUrlPrefix + '@' + assetId + '/f.' + ext
        // todo root blob?
        obj.userData.rootPath = (obj as ImportResultExtras).__rootPath
        obj.userData.rootPathOptions = {}
        this.convertToAsset(obj)

    }

    // todo support texture assets
    convertToAsset(obj: IObject3D|IMaterial){
        // obj.userData.tpAssetId = assetId

        // note - sProperties, _sChildren should not be set on the asset themselves, only on the items that are cloned from them


        // obj.userData.sProperties = []
        if((obj as IObject3D).isObject3D) {
            // (obj as IObject3D)._sChildren = []
            // obj.userData.sProperties.push(...defSPropsObj)

            if((obj as IObject3D).parent){
                console.warn('Newly created asset object already inside a parent', obj)
            }
            if((obj as IObject3D)._sChildren){
                console.warn('Newly created asset object has _sChildren set', obj)
            }
            if((obj as IObject3D).userData.sProperties){
                console.warn('Newly created asset object has userData.sProperties set', obj)
            }
        }
        if((obj as IMaterial).isMaterial) {
            // obj.userData.sProperties.push(...defSPropsMat)
            if((obj as IMaterial).appliedMeshes.size){
                console.warn('Newly created asset material already applied to some meshes', obj)
            }
            if((obj as IMaterial).userData.sProperties){
                console.warn('Newly created asset object has userData.sProperties set', obj)
            }
        }

        this.get().assetManager.tracker.processRawPopulateRefs(obj)
    }

    resolveAssetIdPath(url: string, project?: LoadedProject|null){
        project = project ?? this.loadedProject
        if(!project || !url) return url
        const url1 = url.startsWith(assetUrlPrefix) ? url.slice(assetUrlPrefix.length) : url
        let filePath
        if(url1.startsWith('@')){
            const assetId = url1.slice(1).split('/')[0]
            const assetManifest = project.assetsManifest
            if(!assetManifest?.files[assetId]){
                // debugger
                console.error('Asset id not found in manifest', url1)
                return url
            }
            filePath = assetManifest.files[assetId].path
        }else {
            filePath = url1
        }
        // console.log('Resolved asset url', url, 'to path', filePath)
        return filePath
    }

    defaultViewerSettings: ISerializedViewerConfig|null = null
    loadedProject: LoadedProject|null = null

    _viewerPluginAdded = (e: any)=>{
        if(!e.plugin || !this.defaultViewerSettings) return
        const meta = getEmptyMeta()
        const v = this.get()
        const c = v.serializePlugin(e.plugin, meta)
        if(c){
            const lastIndex = this.defaultViewerSettings.plugins.findIndex(p=>p.type === c.type)
            if(lastIndex !== -1){
                this.defaultViewerSettings.plugins.splice(lastIndex, 1, c)
            }else {
                this.defaultViewerSettings.plugins.push(c)
            }
            this.defaultViewerSettings.resources = mergeResources(this.defaultViewerSettings.resources||{}, metaToResources(meta))
        }
    }
    async loadProject(meta: LoadedProject|null, props: Partial<ViewerProps>){
        if(this.loadedProject === meta) return this.get() // already loaded
        let v: ThreeViewer
        if(meta && isPackageProject(meta) && meta.settings) {
            // todo
            // read package.json
            // load deps in import maps
            // listen to file change?
            // const json = meta.settings.json ?? {}
            const config = meta.settings.config // todo validate value types etc

            v = this.reset({...props, ...config.viewer})

            this.defaultViewerSettings = v.exportConfig(false)

            v.addEventListener('addPlugin', this._viewerPluginAdded)

            // todo remove event listener on dispose
            // v.assetManager.importer.addEventListener('processRaw', (event) => {
            //     // asset registry
            //     if(!v) return
            //
            //     if(!event.data.userData || !event.data.isObject3D && !event.data.isMaterial) return
            //
            //     // asset id stuff
            //     const f = async(obj: IObject3D|IMaterial)=>{
            //         if(!this.loadedProject) return
            //
            //         // todo - if some file is imported that is a supported type, but it doesnt have an asset id, make it into a new asset
            //         let isNewAssetId = false
            //         if(!obj.userData.tpAssetId){
            //             const path = obj.userData?.rootPath
            //             if(path
            //                 && path.startsWith(assetUrlPrefix) // part of the project
            //                 && !notAssetableFileTypes.some(e=>path.endsWith(e)) // not a scene or something
            //                 && assetableFileTypes.some(e=>path.endsWith(e))){ // its a model, material, etc
            //                 // todo make it into a new asset and set needsSave on this, or save instantly
            //                 const id = generateUUID()
            //                 // obj._isTpAsset = true
            //                 // obj._tpAssetId = id
            //                 this.convertToAsset(obj, id)
            //                 isNewAssetId = true
            //                 // todo needssave
            //                 // note - we are not saving right now as it could be a file we dont have an exporter(or extension) for
            //             }else {
            //                 return
            //             }
            //         }
            //
            //         // asset is imported, handle remap moved files, and asset id changed externally
            //         const assetId = obj.userData?.tpAssetId
            //         if(!assetId) {
            //             console.error('Asset without an id imported', obj)
            //             return
            //         }
            //         const path = (obj as ImportResult).__rootPath || obj.userData?.rootPath
            //         if(!path){
            //             console.error('Asset without a path imported', assetId, obj)
            //             return
            //         }
            //         const p1 = path.startsWith(assetUrlPrefix) ? path.slice(assetUrlPrefix.length) : path
            //         const existing = this.assetManifest.files[assetId]
            //         if(existing){
            //             const p2 = existing.startsWith(assetUrlPrefix) ? existing.slice(assetUrlPrefix.length) : existing
            //             if(p1 !== p2){
            //                 console.warn('Asset with same id but different path imported', assetId, p1, p2, obj)
            //                 //  get lastest asset id for the existing
            //                 //  if it doesnt exist, change path in manifest
            //                 //  if it exists with same id, generate new id for new asset
            //                 //  if it exists with diff id, change path in manifest
            //                 const existingId = await this.getAssetIdFromPath(p2)
            //                 if(!existingId){ // file doesnt exist
            //                     this.assetManifest.files[assetId] = p1
            //                     await this.saveAssetManifest()
            //                 }else {
            //                     if(existingId !== assetId){ // id changed inside the existing asset
            //                         this.assetManifest.files[assetId] = p1
            //                         await this.saveAssetManifest()
            //                     }else { // file duplicated or copied, change id and save new asset
            //                         console.warn('Duplicated asset imported, generating new asset id')
            //                         const newId = generateUUID()
            //                         if(!obj.userData){
            //                             console.warn('Object doesnt have a userData', obj)
            //                             obj.userData = {}
            //                         }
            //                         obj.userData.tpAssetId = newId
            //                         await this.saveProjectAsset(this.loadedProject, null, obj, p1)
            //                         isNewAssetId = true
            //                         // not adding to maifest here, its done in save project asset
            //                         // this.assetManifest.files[newId] = p1
            //                         // await this.saveAssetManifest()
            //                     }
            //                 }
            //             }else {
            //                 // all good, same asset reimported
            //             }
            //         }else {
            //             if(!isNewAssetId) {// if new asset id, it will be added to manifest when its first saved
            //                 this.assetManifest.files[assetId] = p1
            //                 // todo queue save manifest
            //                 // await this.saveAssetManifest().catch(e => {
            //                 //     //ignore?
            //                 // })
            //             }
            //         }
            //     }
            //     if(event.data._loadingPromise) event.data._loadingPromise.then(()=>f(event.data as any))
            //     else f(event.data as any)
            // })

            this.loadedProject = meta
            this.scriptUtil.project = meta

            await this.scriptUtil.loadProjectExtScript({import: "threepipe"})
            // todo promise?
            await this.settingsManager.onProjectSettingsChange(config, null)
        }else {
            v = this.reset(props)
            this.loadedProject = meta
            // this.scriptUtil.project = meta

            await this.scriptUtil.loadProjectExtScript({import: "threepipe"})
        }
        this._loadedNeedsSave = false
        return v
    }

    async refreshPackageJson(){
        const project = this.loadedProject
        if(!project?.handle || !project?.settings) return

        const file: File = await resolveFile('package.json', project.handle)
        const project2 = await parsePackageJsonSettings(file, project)
        project.file = project2.file
        project.lastModified = project2.lastModified
        project.handle = project2.handle
        if(project.settings && project2.settings) {
            project.settings.json = project2.settings.json
            project.settings.mainScene = project2.settings.mainScene
            if (JSON.stringify(project2.settings.config) !== JSON.stringify(project.settings.config)) {
                await this.settingsManager.setSettings(project2.settings.config, false)
            }
        }
    }

    onObserveFileChange = async (path: string, project1: LoadedProject)=>{
        // console.log('Project file changed detected:', path, project1.path)
        const project = this.loadedProject
        if(!project?.handle || !project?.settings) return
        if(project !== project1) {
            console.error('Project file change for another project?', project1.path, project.path)
            return
        }
        if(path === 'package.json'){
            await this.refreshPackageJson()
        }
        if(path === 'assets.json'){
            try {
                const file: File = await resolveFile(path, project.handle)
                const text = await file.text()
                const json = parseAssetsJSONManifest(text)
                project.assetsManifest = json
            }catch (e) {
                console.error('Unable to refresh assets.json after change')
                console.error(e)
            }
        }
    }

    // pluginsLoading = false

    // assetManifest = {
    //     files: {} as Record<string, { // id to files meta
    //         path: string,
    //
    //     }>,
    //     version: 1,
    // }

    // for this.loadedProject
    loadedScene: string|null = null
    // loadedAssetId: string|null = null
    loadedPath: string|null = null
    loadedAssetObj: IObject3D|IMaterial|ITexture|null = null
    // loadedAssetType: 'object'|'material'|'texture'|null = null
    _loadedProjectFile: SavedSceneFile | null = null
    get loadedProjectFile() {
        return this._loadedProjectFile
    }
    set loadedProjectFile(v) {
        this._loadedProjectFile = v
        this.dispatchEvent({type: 'loadedProjectFileChange'})
    }

    _loadedNeedsSave = false
    get loadedNeedsSave() {
        if(this.playMode.isRunningMode) return false
        return this._loadedNeedsSave
    }
    set loadedNeedsSave(v) {
        if(this.playMode.isRunningMode) return
        if(this._loadedNeedsSave === v) return
        this._loadedNeedsSave = v
        this.dispatchEvent({type: 'loadedNeedsSaveChange'})
        if(v && this.loadedScene) this.recheckSceneDirty()
    }

    private sceneDirtyCheck?: ReturnType<typeof setTimeout>

    /**
     * A scene update is raised by an authored change, and also by the editor settling around it: the
     * canvas takes its size, the grid appears, the edit camera moves. Serializing is the answer that
     * cannot be wrong, so once the updates stop the flag is checked against the text that was saved.
     */
    private recheckSceneDirty() {
        clearTimeout(this.sceneDirtyCheck)
        this.sceneDirtyCheck = setTimeout(async ()=>{
            if(!this._loadedNeedsSave || this.savingScene || this.playMode.isRunningMode) return
            if(await this.sceneDiffersFromSaved().catch(()=>true)) return
            this.loadedNeedsSave = false
        }, 300)
    }

    // this will refresh file in the asset registry, i.e load it again.
    async loadImport(file: SavedSceneFile | {path: string, file?: File}, project: LoadedProject, isMain = false) {
        const sceneFile: File | undefined = file.file ??
            (file === project ?
            await resolveFile(project.file, project.handle) :
            await resolveFile(file.path, project.handle))
        await this.scriptUtil.scriptsRefreshing
        const isValidFile = !!sceneFile && !!(sceneFile).name && (sceneFile).name.includes('.')
        if (isValidFile) { // empty files when new scene is created
            const v = this.get()
            let res: ImportResult|undefined

            // const fileRootPath = assetUrlPrefix+file.path
            const fileRootPath = await this.toAssetIdPath(file);

            if (isMain) {
                this.get()?.getPlugin(EditModePlugin)?.disable('loadImport') // todo do for single files also?
                // console.log(this.get()?.getPlugin(EditModePlugin))
                if(this.defaultViewerSettings) {
                    v.fromJSON(this.defaultViewerSettings)
                }
                if(file !== project && !file.path.endsWith('.scene.gltf')) {
                    res = await v.assetManager.tracker.refreshFromRegistry(fileRootPath, {
                        // processRaw: true,
                        // cacheAsset: false,
                        // pathOverride: fileRootPath,
                        importedFile: sceneFile,
                    }).pms
                    // todo we need to reset the asset if not saved when its removed from scene (or remove from registry)
                    // res = await v.assetManager.loadImported(res)
                }else { // isMain and ends with .scene.gltf
                    const isEmptyScene = isValidFile && ((sceneFile).name === 'dummy' || sceneFile.size === 0)
                    if(!isEmptyScene) {
                        // The scene loads from its own URL, so its .bin and its textures resolve next to
                        // it. Play's snapshot is held in memory and never on disk, so its bytes come along.
                        res = await v.load(this.source.fileUrl(file.path, this.manifest.files.get(file.path)?.sha256), {
                            importAsModelRoot: true,
                            importedFile: sceneFile,
                        })
                    }
                    else res = v.scene.modelRoot // modelRoot is returning when opening a scene file
                }
                this.get()?.getPlugin(EditModePlugin)?.enable('loadImport')
            } else {
                if(fileRootPath === this.loadedPath){
                    // do not reload the asset if its the same as the loaded one
                    res = await this.getAssetFromPath(fileRootPath) ?? undefined
                }else {
                    res = await v.assetManager.tracker.refreshFromRegistry(fileRootPath, {
                        // processRaw: true,
                        // cacheAsset: false,
                        // pathOverride: fileRootPath,
                        importedFile: sceneFile,
                    }).pms
                }
                // res = await v.assetManager.importer.importSingle(sceneFile, {
                //     processRaw: true,
                //     cacheAsset: false,
                //     pathOverride: fileRootPath,
                // })
            }
            // todo check if asset id is not set inside the file, if not create it and set needsSave
            if(!res) throw new Error('Failed to load file ' + file.path)
            if (res._loadingPromise) await res._loadingPromise // wait for parent to load first
            return res
        }

        return null
    }

    private async toAssetIdPath(entry: FileManifestEntry | { path: string; file?: File }) {
        if(entry.path.startsWith('@')){
            console.error('Unexpected: Entry path already has asset id: ', entry)
            return entry.path
        }
        if(!this.loadedProject?.assetsManifest){
            if(this.loadedProject && isPackageProject(this.loadedProject))
                console.error('No assets manifest loaded in project, cannot get asset id for file: ', entry.path)
            return entry.path
        }
        let assetId = Object.entries(this.loadedProject.assetsManifest.files).find(([id, f]) => f.path === entry.path)?.[0] || null
        if (!assetId) {
            if (!entry.path.endsWith('.scene.gltf') && entry.path.startsWith((this.loadedProject?.assets?.replace(/\/$/, '') ?? 'assets') + '/')) {
                assetId = await this.addIdToAssetsManifest(entry).catch(e => {
                    console.error(e)
                    return null
                })
                console.warn('Asset id for file: ', entry.path, assetId)
            }
        }
        const ext = entry.path.split('?')[0].split('.').pop()?.toLowerCase() || ''
        const fileRootPath = assetId ? `${assetUrlPrefix}@${assetId}/f.${ext}` : assetUrlPrefix + entry.path
        return fileRootPath;
    }

    // this will load the asset again even if in memory
    async loadAsset (file: FileManifestEntry|null, project: LoadedProject){
        if(!file) return null
        if(!project) return null
        let loadable = isLoadableFile(file.path);

        if(!loadable) return null

        const fi = await manifestEntryToFile(file)
        const r = await this.getLoadedFile(project, file.path, fi || undefined)
        if(!r) return null

        const res = await this.loadImport(r, project, false).catch(e=>{
            console.error(e)
            return null
        })

        if(!res) return null

        if(res.userData?.rootSceneModelRoot) {
            console.error('Cannot load a scene model root as an asset')
            return null
        }

        return res
    }

    unloadAsset(obj: ImportResult | {
        pms: Promise<ImportResult|undefined>
    }){
        this.get()?.assetManager.tracker.removeAssetItem(obj)
    }

    async loadAssetMaterialClone(entry: FileManifestEntry, project: LoadedProject){
        // todo use getFromPath to avoid reloading if already in memory
        const res = await this.loadAsset(entry, project)
        if (!res || !res.isMaterial) {
            // toast error
            console.error('Unable to load material')
            if (typeof res?.dispose === 'function') res.dispose()
            return null
        }
        return this.cloneAssetMaterial(res as IMaterial);
    }

    cloneAssetMaterial(res: IMaterial) {
        const clone = cloneAssetItem(res)
        // if(clone._tpAssetId) delete clone._tpAssetId // note that asset id needs to be set later when saving or assigning the object
        if (clone._tpRootPath) delete clone._tpRootPath // note that root path needs to be set later when saving or assigning the object
        // if(clone._tpRootUid) delete clone._tpRootUid
        if (!clone.userData.sProperties) clone.userData.sProperties = [...defSPropsMat]

        this.get().assetManager.tracker.subsToAsset(clone)
        return clone
    }

    async loadAssetObjectClone(entry: FileManifestEntry, project: LoadedProject){
        // todo use getFromPath to avoid reloading if already in memory
        const res = await this.loadAsset(entry, project)
        if(!res || !res.isObject3D){
            // toast error
            console.error('Unable to load object from file')
            if(typeof res?.dispose === 'function') res.dispose()
            return null
        }
        return this.cloneAssetObject(res as IObject3D);
    }

    cloneAssetObject(res: IObject3D) {
        const clone = cloneAssetItem(res as IObject3D)
        // if(clone._tpAssetId) delete clone._tpAssetId // note that asset id needs to be set later when saving or assigning the object
        if(clone._tpRootPath) delete clone._tpRootPath // note that root path needs to be set later when saving or assigning the object
        if(clone._tpRootUid) delete clone._tpRootUid
        if(!clone.userData.sProperties) clone.userData.sProperties = [...defSPropsObj]
        if(!clone._sChildren) clone._sChildren = []
        this.get().assetManager.tracker.subsToAsset(clone)
        return clone
    }
    cloneAssetTexture(res: ITexture) {
        // todo returning the same now, change when supported
        return res
    }

    // for unique run mode
    editorId = generateUUID()
    _runningSceneFile: File|null = null

    // todo expose for scripts
    async loadRunningScene(path: string){
        if(!this.playMode.isRunningMode || !this.loadedProject || !isPackageProject(this.loadedProject)) return

        const viewer = this.get()
        viewer.timeline.stop()
        viewer.timeline.reset()
        viewer.getPlugin(EntityComponentPlugin)!.stop()
        this.unloadScene()

        const project = this.loadedProject

        if(path === this.loadedPath && this._runningSceneFile) {
            // todo if _runningSceneFile doesnt exists, read running file from disk like in stop
            const filePath = `.${settingsKey}/running/${this.editorId}.scene.gltf`
            await this.loadImport({
                file: this._runningSceneFile, path: filePath,
            }, project, true).catch(e => {
                return {error: e.message}
            })
        }else {
            const r = await this.getLoadedFile(project, path)
            if (!r || !r.file) {
                console.error('No scene file found, cannot reload scene.')
                return
            }
            await this.loadImport(r, project, true)
        }

        viewer.timeline.start()
        viewer.getPlugin(EntityComponentPlugin)!.start()
    }

    /**
     *
     * @param file
     * @param force - unload current even if unsaved changes
     */
    async loadProjectFile(file: SavedSceneFile | null, force = false){
        // if(project !== this.loadedProject){
        //     console.error('Project does not match the loaded project, cannot load scene/asset.', file)
        //     return {error: 'Unknown Error loading scene/asset.'}
        // }
        const project = this.loadedProject
        if(file && !project){
            console.error('No project loaded, cannot load scene/asset.', file)
            return {error: 'No project loaded, cannot load scene/asset.'}
        }
        if(file && !file.path){
            console.error('No file path provided, cannot load scene/asset.', file)
            return {error: 'No file path provided, cannot load scene/asset.'}
        }
        if(this.loadedProjectFile){
            if(this.loadedProjectFile === file){
                // todo check if file has updated hash and ask to reload?
                // already loaded
                return
            }
            if(this.loadedNeedsSave && !force) return {error: 'Current scene/asset has unsaved changes, please save before loading another file.'}
            await this._unloadProjectFile()
        }

        if(project && !file && !isPackageProject(project)){
            file = project
        }

        console.log(file)
        if(!file || !project) return undefined

        const res = await this.loadImport(file, project, true).catch(e=>{
            return {error: e.message}
        })
        if(res?.error) return res as {error: string|null}
        if (res) {
            const v = this.get()
            const obj = res as (IObject3D | IMaterial | ITexture) & ImportResult
            if(!obj.isObject3D && !obj.isMaterial && !obj.isTexture){
                console.error(res)
                if(typeof (obj as any)?.dispose === 'function') (obj as any).dispose()
                return {error: 'Failed to load asset, invalid object: ' +  file.path}
            }
            const isScene = obj === v.scene.modelRoot
            // const isAsset = !isScene && !!obj.userData.tpAssetId

            // if(!isScene && !isAsset){
            //     // todo make it an asset
            // }

            this.loadedScene = isScene ? file.path : null
            // this.loadedAssetId = isAsset ? obj.userData.tpAssetId : null
            // this.loadedPath = assetUrlPrefix+file.path
            this.loadedPath = (res as ImportResultExtras).__rootPath ?? (assetUrlPrefix+file.path)
            this.loadedAssetObj = !isScene ? obj : null
            this.loadedProjectFile = file
            this.loadedNeedsSave = false // the editor copy came from disk, so there is nothing to save yet

            // todo remove event listeners on file unload

            if(obj.isObject3D){
                if(this.loadedAssetObj) {
                    // (obj as IObject3D).addEventListener('objectUpdate', () => {
                    //     if (this.loadedAssetObj !== obj) return
                    //     this.loadedNeedsSave = true
                    //     // todo update _tpAssetNeedsSave in threepipe and use that
                    // })
                    // listener is required on the scene because the bubble is to parentRoot not parent(for optimization)
                    v.scene.addObject(obj as IObject3D)
                    v.scene.addEventListener('objectUpdate', (ev)=>{
                        if(ev.object._tpRootPath !== this.loadedPath) return
                        if (this.loadedAssetObj !== obj) return
                        this.loadedNeedsSave = true
                        // todo use asset tracker instead of manual sub
                    })
                    v.scene.addEventListener('materialUpdate', (ev)=>{
                        // todo handle material array
                        if(!Array.isArray(ev.material) && ev.material._tpRootPath !== this.loadedPath) return
                        if (this.loadedAssetObj !== obj) return
                        this.loadedNeedsSave = true
                        // todo use asset tracker instead of manual sub
                    })
                    v.scene.addEventListener('textureUpdate', (ev)=>{
                        if(ev.texture._tpRootPath !== this.loadedPath) return
                        if (this.loadedAssetObj !== obj) return
                        this.loadedNeedsSave = true
                        // todo use asset tracker instead of manual sub
                    })
                    v.scene.addEventListener('geometryUpdate', (ev)=>{
                        if(ev.geometry._tpRootPath !== this.loadedPath) return
                        if (this.loadedAssetObj !== obj) return
                        this.loadedNeedsSave = true
                        // todo use asset tracker instead of manual sub
                    })
                    // todo any other events? materialChanged, geometryChanged etc
                }else if(this.loadedScene){
                    v.scene.addEventListener('objectUpdate', (ev)=>{
                        if(ev.object._tpRootPath) return // part of some asset
                        if(this.loadedScene !== file.path) return
                        this.loadedNeedsSave = true
                        // todo use asset tracker instead of manual sub
                    })
                    v.scene.addEventListener('materialUpdate', (ev)=>{
                        // todo handle material array
                        if(!Array.isArray(ev.material) && ev.material._tpRootPath) return // part of some asset
                        if(this.loadedScene !== file.path) return
                        this.loadedNeedsSave = true
                        // todo use asset tracker instead of manual sub
                    })
                    v.scene.addEventListener('textureUpdate', (ev)=>{
                        if(ev.texture._tpRootPath) return // part of some asset
                        if(this.loadedScene !== file.path) return
                        this.loadedNeedsSave = true
                        // todo use asset tracker instead of manual sub
                    })
                    v.scene.addEventListener('geometryUpdate', (ev)=>{
                        if(ev.geometry._tpRootPath) return // part of some asset
                        if(this.loadedScene !== file.path) return
                        this.loadedNeedsSave = true
                        // todo use asset tracker instead of manual sub
                    })
                    // todo any other events? materialChanged, geometryChanged etc
                }
            }
            if(obj.isMaterial){
                // todo line material
                const box = new BoxGeometry(1, 1, 1)
                const boxObj = new Mesh2(box as any, obj as IMaterial)
                v.scene.addObject(boxObj)
                v.scene.add(new HemisphereLight2(0xffffff, 0x444444, 1) as any)
                v.scene.add(new DirectionalLight2(0xffffff, 0.5) as any)
                await v.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr')
                // todo size, camera controls

                ;(obj as IMaterial).addEventListener('materialUpdate', ()=>{
                    console.warn('materialUpdate', obj)
                    if(this.loadedAssetObj !== obj) return
                    this.loadedNeedsSave = true
                    // todo use asset tracker instead of manual sub
                })
            }
            if(obj.isTexture){
                const plane = new PlaneGeometry(1, 1)
                const mat = new UnlitMaterial({map: obj as ITexture})
                const planeObj = new Mesh2(plane as any, mat as any)
                // todo size, camera controls
                v.scene.addObject(planeObj)

                ;(obj as ITexture).addEventListener('textureUpdate', ()=>{
                    if(this.loadedAssetObj !== obj) return
                    this.loadedNeedsSave = true
                    // todo use asset tracker instead of manual sub
                })
            }

            if(obj._loadingPromise) await obj._loadingPromise
            console.log('Loaded scene/asset: ', file.path, obj)
            if(this.loadedScene) {
                this.restoreEditCamera()
                // Loading the scene and placing the edit camera raise update events of their own, so
                // the flag is cleared once the scene is settled, against the text it serializes to now.
                this.savedSceneHash = await sha256Hex((await serializeSceneGltf(v, {scenePath: this.loadedScene})).gltf)
                this.loadedNeedsSave = false
            } else {
                this.get().getPlugin(EditModePlugin)?.resetView()
            }
            // if(this.loadedProjectFile)
            //     this.startRunMode()
            return obj
        }else {
            // 404 no file
            if(file.path.endsWith('.scene.gltf') || file.path.endsWith('.scene.json')) {
                // new project maybe
                this.loadedScene = file.path
                // this.loadedAssetId = null
                this.loadedPath = assetUrlPrefix+file.path
                this.loadedAssetObj = null
                this.loadedProjectFile = file
                this.loadedNeedsSave = true
                return {error: null}
            } else {
                if(file.file.name === 'dummy' || file.file.size === 0){ // new file
                    return {error: null}
                }
                return {error: 'File not found: ' +  file.path}
            }
        }
        return {error: 'Unknown error loading scene/asset.'}

    }

    unloadScene(){
        const v = this.get()
        v.scene.disposeSceneModels(true, true)
        v.scene.disposeTextures(true)
        // todo for now
        const comps = EntityComponentPlugin.ObjectToComponents.get(v.scene.defaultCamera)
        // v.getPlugin(EntityComponentPlugin)?.removeComponent()
        comps?.forEach(c=>{
            v.getPlugin(EntityComponentPlugin)?.removeComponent(v.scene.defaultCamera, c.uuid)
        })
        delete v.scene.defaultCamera.userData.EntityComponentPlugin
    }

    // use loadProjectFile(null)
    async _unloadProjectFile(){
        if(this.loadedProjectFile){ // todo we have to reset the current loaded asset, on remove it from the registry
            // todo unload current scene/asset
            this.unloadScene()
            this.get().assetManager.tracker.removeFromRegistry(assetUrlPrefix + this.loadedProjectFile.path)
            this.loadedScene = null
            // this.loadedAssetId = null
            this.loadedPath = null
            this.loadedAssetObj = null
            this.loadedProjectFile = null
            this.loadedNeedsSave = false
            // this.loadedAssetType = null
        }
    }

    // todo
    //  reloadScene

    savingScene = false

    /**
     * Writes the file. The server refuses a write whose base is not what is on disk, which means
     * someone else wrote the path since this tab read it, so the user picks what wins.
     */
    private async writeResolvingConflict(handle: ProjectDirectoryHandle, path: string, file: File): Promise<'written' | 'reloaded' | 'cancelled'> {
        try {
            await this.fsHelper.writeFile(handle, path, file)
            return 'written'
        } catch (e) {
            if (!(e instanceof ProjectConflictError)) throw e
            // Reload answers only for the file on screen. No other path has an editor copy to replace.
            const choices: AskChoice<'cancelled' | 'reload' | 'overwrite'>[] = [{label: 'Cancel', value: 'cancelled'}]
            if (path === this.loadedProjectFile?.path) choices.push({label: 'Reload from disk', value: 'reload', intent: 'danger'})
            choices.push({label: 'Overwrite', value: 'overwrite', intent: 'primary'})
            const answer = await ask('Changed on disk', `${path} changed on disk since you opened it.`, choices)
            if (answer === 'cancelled') return 'cancelled'
            if (answer === 'reload') {
                await this.reloadOpenFile()
                return 'reloaded'
            }
            // The editor copy wins: rebase on what the 412 reported, then send the same write again.
            if (e.sha256) this.manifest.based.set(path, e.sha256)
            else this.manifest.based.delete(path)
            await this.fsHelper.writeFile(handle, path, file)
            return 'written'
        }
    }

    async saveProjectSceneOrAsset(project: LoadedProject, file: SavedSceneFile): Promise<{ error: string | null, warn?: string }> {
        if(project !== this.loadedProject){
            console.error('Project does not match the loaded project, cannot save scene/asset.', file)
            return {error: 'Unknown Error saving scene/asset.'}
        }
        if(!this.loadedProjectFile){
            console.error('No scene/asset loaded, cannot save.', file)
            return {error: 'Unknown Error saving scene/asset.'}
        }
        if(this.loadedProjectFile !== file){
            console.error('Path to save does not match the loaded path, cannot save.', file, this.loadedProjectFile)
            return {error: 'Unknown Error saving scene/asset.'}
        }
        const scene = this.loadedScene === this.loadedProjectFile.path ? this.loadedScene : null
        const asset = this.loadedAssetObj
        if(!scene && !asset){
            console.error('Loaded path is neither a scene nor an asset, cannot save.', file)
            return {error: 'Unknown Error saving scene/asset.'}
        }
        if(scene && asset){
            throw new Error('Loaded path cannot be both a scene and an asset.')
        }
        const handle = project.handle
        if (!handle) return {error: 'Cannot get project directory handle'}

        this.savingScene = true

        if(scene) {
            const res = await this.exportScene(scene)
            if (!res.file) {
                this.savingScene = false
                return res
            }
            const filePath = scene
            const backupFilePath = backupPath(scene, Date.now().toFixed()) // todo clear old backups?
            const previewFilePath = thumbPath(scene)

            const listed = this.manifest.files.get(filePath)
            if (listed) {
                // The backup keeps the copy that is on disk now. It reads through the transport, not
                // through the handle, so the save below still carries the base this tab loaded.
                const original = await this.source.read(filePath, listed.sha256)
                this.fsHelper.writeFile(handle, backupFilePath, new File([original.bytes], listed.path.split('/').pop()!)).catch(e => {
                    console.error('Failed to create backup of scene file.', e)
                })
            }
            const saved = await this.writeResolvingConflict(handle, filePath, res.file).catch(e => {
                console.error(e)
                return null
            })
            if (saved !== 'written') {
                this.savingScene = false
                if (!saved) return {error: 'Failed to save scene file.'}
                return saved === 'reloaded'
                    ? {error: null, warn: `Reloaded ${filePath} from disk. The editor copy is gone.`}
                    : {error: null, warn: `${filePath} changed on disk. Nothing was saved.`}
            }

            if (res.preview) {
                if ((res.preview as File).name) {
                    await this.fsHelper.writeFile(handle, previewFilePath, res.preview as File).catch(e => {
                        console.error('Unable to save scene thumbnail')
                        console.error(e)
                        return false
                    })
                } else {
                    console.error('Invalid preview file, cannot save scene thumbnail.')
                }
            }

            project.lastModified = Date.now()

            this.savedSceneHash = await sha256Hex(await res.file.arrayBuffer())
            this.loadedNeedsSave = false
            this.savingScene = false
            return {error: null}
        }
        if(this.loadedAssetObj){
            if((this.loadedAssetObj as ITexture).isTexture){
                this.savingScene = false
                return {error: "Texture Save not implemented yet."}
            }
            this.savingScene = false
            return this.saveProjectAsset(project, null, this.loadedAssetObj as IObject3D|IMaterial, file.path)
        }
        this.savingScene = false
        return {error: 'Unknown error saving scene/asset.'}
    }

    async saveNewProjectAsset(project: LoadedProject, scene: SavedSceneFile|null, obj: IObject3D|IMaterial, ext2 = 'asset') {
        if(!canMakeAsset(obj)) return {error: 'Object cannot be saved as asset. Make sure it has geometry and a material.'}

        const {handle, assets} = project
        if (!handle) return {error: 'Cannot get project directory handle'}
        if (!assets) return {error: 'Project does not have an assets folder configured.'}

        const dirHandle = await getDirHandle(handle, assets).catch(e=>{
            console.error(e)
            return undefined
        })
        if(!dirHandle){
            // console.error('MakeAssetMenuItem: ', meta.handle, meta.assets)
            // setIsMaking(false)
            // return false
            return {error: 'No assets folder found in project, cannot save asset.'}
        }

        // generate asset id
        // export object as name.asset.glb
        //  preserve uuid should be true(for objects) - done
        //  for materials and textures, uuid should be saved
        //  loop through all children, materials, textures, etc and set asset id on them. (not in userdata). - done
        //  when exporting(the scene, other objects) check if any object/mat/tex has asset id, and only export its uuid. - done
        //  when loading assets, set asset id on object and other used objects, also set proper rootPath - done
        // save gltf in assets folder
        // set the rootPath, rootPathOptions in userdata
        // set sChildren to []
        // set userData.sProperties to []

        const assetId = generateUUID()
        // obj.userData.tpAssetId = assetId

        let objParent = (obj as IObject3D).isObject3D ? (obj as IObject3D).parent : null
        if(objParent){
            (obj as IObject3D).removeFromParent() // this should also dispose any assets
        }

        const res = await this.exportObject(obj).catch(e=>{
            console.error(e)
            return {error: e?.message || e?.toString() || 'Unknown error exporting asset', file: null}
        })
        if (!res.file) {
            // delete obj.userData.tpAssetId
            return res
        }

        let assetName = obj.name // todo clean for file name
            .replace(new RegExp(`\.${ext2}\.${res.ext}$`), '')
            .replace(new RegExp(`\.${res.ext}$`), '') || ((obj as IObject3D).isObject3D ? 'object' : 'material')

        const ext = `.${ext2}.${res.ext}`
        while (true) {
            const exists = !!(await dirHandle.getFileHandle(assetName + ext).catch((e) => {
                if(e.name === "NotFoundError") return null
                if(e.name === "TypeMismatchError") return true
                throw e
            }))
            if (exists) {
                const match = assetName.match(/(.*?)(\d+)$/)
                if (match) {
                    const num = parseInt(match[2]) + 1
                    assetName = match[1] + num
                } else {
                    assetName = assetName + '1'
                }
            } else {
                break
            }
        }

        const assetPath = assets + assetName + ext

        const res2 = await this.writeAssetFile(obj, assetId, handle, assetPath, res)
        if(res2){
            // delete obj.userData.tpAssetId
            return res2
        }

        let result = obj

        const obj1 = obj as IObject3D
        if(obj1.isObject3D){
            const clone = cloneAssetItem(obj1)
            // if(clone._tpAssetId) delete clone._tpAssetId // note that asset id needs to be set later when saving or assigning the object
            if(!clone.userData.sProperties) clone.userData.sProperties = [...defSPropsObj]
            if(!clone._sChildren) clone._sChildren = []
            result = clone
            if(objParent){
                objParent.add(result)
            }
        }

        if((obj as IMaterial).isMaterial){
            const mat = (obj as IMaterial)
            const clone = cloneAssetItem(mat)
            // if(clone._tpAssetId) delete clone._tpAssetId // note that asset id needs to be set later when saving or assigning the object
            if(!clone.userData.sProperties) clone.userData.sProperties = [...defSPropsMat]
            result = clone

            const appliedMeshes = mat.appliedMeshes
            appliedMeshes.forEach((obj)=>{
                if(obj.material === mat){
                    obj.material = clone
                }else if(Array.isArray(obj.material) && obj.material.includes(mat)){
                    const ind =  obj.material.indexOf(mat)
                    if(ind !== -1) {
                        const newMats = [...obj.material]
                        newMats[ind] = clone
                        obj.material = newMats
                    }
                }
            })
        }

        if(scene){
            const res3 = await this.saveProjectSceneOrAsset(project, scene)
            if(res3?.error){
                // todo rollback asset creation, setting asset id reference, setting rootPath userData
                return res3
            }
        }

        await this.addIdToAssetsManifest({path: assetPath, file: res.file}, assetId).catch(e=>{
            //ignore?
            console.error(e)
            return null
        })

        return {error: null, path: assetPath, result}
    }

    async getAssetFromPath(path: string): Promise<((IObject3D | IMaterial | ITexture) & ImportResultExtras) | null>{
        // path = path.replace(assetUrlPrefix, '')
        const reg = this.get()?.assetManager.tracker.getFromRegistry(path, {
            // processRaw: true,
            // cacheAsset: false,
        })
        if(reg?.object) return reg.object as any
        return (reg?.pms || null) as any
    }

    async getAssetFromEntry(entry: FileManifestEntry|TExternalFile|{path: string, isFSEntry: false}): Promise<((IObject3D | IMaterial | ITexture) & ImportResultExtras) | null>{
        if(!entry.isFSEntry) {
            const libFileId = 'libFileId' in entry ? entry.libFileId : undefined
            let fileInfo
            if(libFileId) {
                fileInfo = await queryClient.fetchQuery({
                    queryKey: [libAssetEndpoints.info.key, libFileId],
                    queryFn: async ({signal, queryKey}) => {
                        const r = await fetchQueryFunc(libAssetEndpoints.info.url + queryKey[1], {signal, queryKey});
                        return libAssetEndpoints.info.schema.parse(r.asset);
                    }
                }).catch(e=>{
                    console.error('Error fetching lib asset info for asset load: ', libFileId, e)
                    return undefined
                })
            }
            let asset = this.getAssetFromPath(entry.path)
            if(libFileId && fileInfo && asset){
                asset = asset.then(async (r)=>{
                    if(!r) return r
                    if(r.isObject3D && r.name === 'Scene' &&
                        libFileId.startsWith('@polyhaven/')) {
                        r.name = fileInfo.name || libFileId.replace('@polyhaven/', '')
                    }
                    r._libFileInfo = fileInfo
                    // r._libFileId = libFileId
                    return r
                })
            }
            return asset
        }
        let path = entry.path
        if(!entry.path.startsWith('@')) {
            path = await this.toAssetIdPath(entry)
        }
        // path = path.replace(assetUrlPrefix, '')
        const reg = this.get()?.assetManager.tracker.getFromRegistry(path, {
            // processRaw: true,
            // cacheAsset: false,
        })
        if(reg?.object) return reg.object as any
        return (reg?.pms || null) as any
    }

    async saveProjectAsset(project: LoadedProject, scene: SavedSceneFile|null, obj: IObject3D|IMaterial, path: string) {
        if(!canSaveAsset(obj) || !path) return {error: 'Asset cannot be saved, make sure it is a valid asset'}

        const handle = project.handle
        if (!handle) return {error: 'Cannot get project directory handle'}

        const rootPath = (obj as ImportResult).__rootPath
        if(!rootPath?.startsWith(assetUrlPrefix + '@')){
            return {
                error: 'Not a valid asset, cannot save.'
            }
        }
        const assetId = rootPath.substring((assetUrlPrefix + '@').length).split('/')[0]?.trim()
        if(!assetId?.length){
            return {
                error: 'Invalid asset id, cannot save.'
            }
        }

        const res = await this.exportObject(obj).catch(e=>{
            console.error(e)
            return {error: e?.message || e?.toString() || 'Unknown error exporting asset', file: null}
        })
        if (!res.file) {
            return res
        }

        const res2 = await this.writeAssetFile(obj, assetId, handle, path, res)
        if(res2){
            return res2
        }

        let saveScene = true

        if(scene && saveScene) {
            if ((obj as IMaterial).isMaterial) {
                const mat = obj as IMaterial
                if(!mat.appliedMeshes?.size) saveScene = false
            }
            if ((obj as IObject3D).isObject3D) {
                const object = obj as IObject3D
                if(!object.parent) saveScene = false
            }
        }

        // todo manifest
        // if(this.assetManifest.files[assetId]?.path !== path) {
        //     this.assetManifest.files[assetId] = {path}
        //     await this.saveAssetManifest().catch(e => {
        //         //ignore?
        //     })
        // }

        if(obj === this.loadedAssetObj){
            this.loadedNeedsSave = false
        }

        return scene && saveScene ? this.saveProjectSceneOrAsset(project, scene) : {error: null}
    }

    // only for this session to avoid checking for file exists
    private _previewGeneratedCache = new Set<string>()
    private handlePreviewRefresh = (e: {path: string, action: string}) => {
        if (e.action !== 'load' || !e.path.startsWith(assetUrlPrefix)) return

        const tracker = this.get().assetManager.tracker

        const res = tracker.registry[e.path]?.object
        if (!res) return

        const project = this.loadedProject
        if (!project) return

        const path = this.resolveAssetIdPath(e.path, project)
        const previewPath = thumbPath(path)

        const previewRefresh = async () => {
            if (!project.handle) return
            // check if file exists

            const e1 = this._previewGeneratedCache.has(previewPath)
            const exists = e1 || !!(await getFileHandle(project.handle, previewPath, false, false)).fileHandle
            if (exists) {
                if(!e1) {
                    this._previewGeneratedCache.add(previewPath)
                }
                return
            }
            this._previewGeneratedCache.add(previewPath)

            const viewer = this.get()
            let prev = await generatePreview(res, viewer);

            if (prev) {
                const blob = await (await fetch(prev)).blob()
                const f = new File([blob], previewPath, {type: blob.type, lastModified: Date.now()})
                await this.fsHelper.writeFile(project.handle, previewPath, f).catch(e => {
                    console.error('Error writing texture preview: ', previewPath, e)
                    return false
                })
            }
        }
        previewRefresh() // not awaiting
    }

}

/**
 * An asset id a human can read in assets.json and in a scene's rootPath: the file's name, lowercased
 * and punctuation collapsed, with a counter when that name is taken.
 */
function readableAssetId(path: string, manifest?: AssetsJSONManifest): string {
    const name = path.split('/').pop() || 'asset'
    const dot = name.lastIndexOf('.')
    const base = (dot < 0 ? name : name.slice(0, dot))
        .toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'asset'
    let id = base
    for (let suffix = 1; manifest?.files[id]; suffix++) id = `${base}-${suffix}`
    return id
}

async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
    return Array.from(new Uint8Array(digest), (value)=>value.toString(16).padStart(2, '0')).join('')
}

async function fileFromDataUrl(dataUrl: string, name: string = 'file') {
    const type = dataUrl.slice(5, dataUrl.indexOf(';'))
    const ext = mimeToExt[type] ?? type.split('/')[1]
    const blob = await (await fetch(dataUrl)).blob()
    return new File([blob], name + '.' + ext, {type: blob.type})
}

declare module 'threepipe'{
    interface AssetManager{
        tracker: AssetTracker
    }
    interface ImportResultExtras{
        _libFileInfo?: z.infer<typeof libAssetEndpoints.info.schema>
    }
}
