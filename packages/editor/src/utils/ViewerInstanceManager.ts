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
import {browserFileStore} from './BrowserFileStore.ts'
import {EditorFeatures} from './EditorFeatures.ts'
import {EditModePlugin} from "./EditModePlugin.ts";
import {FileManifestEntry, manifestEntryToFile, SelectedInspectorItem} from "./AssetsProvider.ts";
import {
    AssetsJSONManifest,
    assetUrlPrefix,
    buildProjectBundleCode,
    createMeta,
    FILE_META_KEY,
    getMeta,
    getMetaWithPreview,
    initProjectHandles,
    LoadedProject,
    parseAssetsJSONManifest,
    parsePackageJsonSettings,
    resolveFile,
    SavedSceneFile,
    SavedSceneFileMeta,
    SavedSceneFileMetaStored,
    settingsKey,
    STORE_NAME
} from "./project.ts";
import {
    agentsMdTemplate,
    defaultIconTemplatePng,
    defaultIconTemplateSvg,
    gitignoreTemplate,
    mainJsTemplate,
    mcpJsonTemplate,
    packageJsonTemplate
} from '../data/projectTemplates.ts'
import {AnotherFSHelper, getDirHandle, getFileHandle, queryHandlePerm, writeFileHandle} from "./fsApi.ts";
import {FetchProxy} from "./FetchProxy.ts";
import {AssetTracker, cloneAssetItem, defSPropsMat, defSPropsObj} from "./AssetTracker.ts";
import {CannonPhysicsPlugin} from "../plugins/cannon/CannonPhysicsPlugin.ts";
import {CanvasFileDropHandler} from "./CanvasFileDropHandler.tsx";
import {FileTracker} from "./FileTracker.ts";
import {registerKiteGameComponentTypes} from "../game-runtime/index.ts";
import {generatePreview} from "./three/GeneratePreview.ts";
import {emptyProjectSettings} from "../data/EmptyProjectSettings.ts";
import {mimeToExt, typesExts} from '../data/fileTypes.ts'
import {ScriptUtil} from "./ScriptUtil.ts";
import {refreshProjectQueryState} from "./refreshProjectQueryState.ts";
import {TExternalFile} from "../components/ExternalFilesPanel.tsx";
import {queryClient} from "../tsdb/client.ts";
import {fetchQueryFunc, libAssetEndpoints} from "../tsdb/libAsset.ts";
import z from "zod";
import {PlayModeHelper} from "./PlayModeHelper.ts";
import {EditPreviewHelper} from "./EditPreviewHelper.ts";
import {ProjectSettingsManager} from "./ProjectSettingsManager.ts";
import {initMCPBridge, MCPBridgeClient} from "./ai";
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
    renderScale: number
    debug: boolean
    tonemap: boolean
}

export interface BroadcastDataTypes{
    'file-change': {path: string, project: string, file: File}
}

export class ViewerInstanceManager extends EventDispatcher<{
    loadedNeedsSaveChange: {},
    loadedProjectFileChange: {},
    mcpBridgeChange: {},
    projectFilesChanged: {paths: string[]},
    // assetRegistryChange: {},
}>{
    private _viewers = new Map<string, ThreeViewer>()
    features = new EditorFeatures(this)
    fileTracker = new FileTracker()
    scriptUtil = new ScriptUtil()
    playMode = new PlayModeHelper(this)
    editPreview = new EditPreviewHelper(this.features)
    settingsManager = new ProjectSettingsManager(this)
    fsHelper = new AnotherFSHelper()

    static {
    }
    constructor() {
        super()
        FetchProxy.Setup(assetUrlPrefix)
        FetchProxy.Set(this.fetchProjectAsset)
        this.fsHelper.broadcastMessage = (type, data)=> {
            const b = {...data, type, editorId: this.editorId}
            this.receiveBroadcastMessage({data: b})
            this.fsHelper.broadcastChannel.postMessage(b)
        }
        // todo only use broadcast channel if fsobserver is not available
        this.fsHelper.broadcastChannel.onmessage = this.receiveBroadcastMessage
        this.fsHelper.broadcastChannel.onmessageerror = (e)=>{
            console.error('Broadcast message error', e)
        }
        this.scriptUtil.onObserveFileChange = this.onObserveFileChange
        this.scriptUtil.initFsObserver()
    }

    private receiveBroadcastMessage = (e: { data: BroadcastDataTypes[keyof BroadcastDataTypes] & {type: keyof BroadcastDataTypes, editorId: string} })=>{
        if(!this.loadedProject) return
        // console.log('Broadcast message received', e)
        if(e.data.type === 'file-change'){
            const data = e.data as BroadcastDataTypes['file-change'] & {editorId: string, type: 'file-change'}
            if(data.project === this.loadedProject.path){
                const url = data.project + data.path
                this.fileTracker.updateFile(url, data.file)
                const ex = this.fileTracker.getFile(url)

                if(this.editorId !== data.editorId){
                    // todo use the File object from data instead of reading again from disk
                    this.scriptUtil.changedFilesQ.push(data.path)
                }
                this.dispatchEvent({type: 'projectFilesChanged', paths: [data.path]})
            }
        }
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
        if (id === 'default') {
            const authoringChanged = () => {
                if (this.loadedProject && !this.playMode.isRunningMode) this.authoringRevision += 1
            }
            // Observe changes independently of the already-dirty UI flag, including
            // empty unsaved projects that have no loadProjectFile listeners yet.
            viewer.scene.addEventListener('objectUpdate', event => {
                let object = event.object
                while (object && object !== viewer.scene.modelRoot) object = object.parent as IObject3D
                if (object) authoringChanged()
            })
            for (const type of ['materialUpdate', 'geometryUpdate', 'textureUpdate'] as const) {
                viewer.scene.addEventListener(type, authoringChanged)
            }
            viewer.scene.addEventListener('sceneUpdate', event => {
                if (event.hierarchyChanged) authoringChanged()
            })
        }
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
            // SandboxPlugin,
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

        FetchProxy.Set(this.fetchProjectAsset)  // just in case

        // for runtime player
        // viewer.assetManager.importer.addURLModifier((url)=>{
        //     if(url.startsWith(assetUrlPrefix)){
        //         return ''
        //     }else {
        //         return url
        //     }
        // })

        // todo when an asset file is loaded (right now only materials), watch for file changes and import it again as in inspector

        // todo use forPlugin
        // to show more details in the UI and allow to edit changes in title etc.
        // const mat = viewer.getPlugin(MaterialConfiguratorPlugin)
        // mat && (mat.enableEditContextMenus = true)
        // const swi = viewer.getPlugin(SwitchNodePlugin)
        // swi && (swi.enableEditContextMenus = true)

        viewer.getPlugin(GLTFAnimationPlugin)!.autoIncrementTime = false

        viewer.getPlugin(PickingPlugin)!.picker!.pickingMode = 'object'
        registerKiteGameComponentTypes(viewer)

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

    readonly browserStore = browserFileStore

    dispose() {
        this._viewers.forEach(this._disposeViewer)
        this._viewers.clear()
        this.browserStore.dispose()
    }

    // static readonly STORE_NAME = STORE_NAME
    // static readonly FILE_META_KEY = FILE_META_KEY
    static readonly SAVE_DIR_PICKER_ID = 'threepipe-editor-dir-1'

    // used for testing
    static readonly ENABLE_FS_WRITE_API = true

    async saveFileAdHoc(scene: SavedSceneFile, changeName: (n: string, e: string) => Promise<string | null>, props?: {
        isNewName?: boolean
        saveTempOnly?: boolean
    }): Promise<SavedSceneFile | { error?: string, warn?: string }> {
        const meta = await getMeta(scene.path)
        let isNewHandle = false
        let handle = meta?.handle
        let name = scene.path.replace(/\/$/, '').split('/').pop() || 'scene'
        let file: File/* | string*/ = scene.file
        let filePath: string|null = typeof file === 'string' ? file : null
        const preview = scene.preview

        props = {...props ?? {}}

        if (!props.saveTempOnly && ViewerInstanceManager.ENABLE_FS_WRITE_API) {

            if ((!meta?.handle || props.isNewName) && 'showDirectoryPicker' in window) {
                const handle1 = await window.showDirectoryPicker({
                    id: ViewerInstanceManager.SAVE_DIR_PICKER_ID,
                    mode: 'readwrite',
                    // startIn: 'documents',
                    startIn: meta?.handle,
                }).catch(e => {
                    console.warn(e)
                    return undefined
                })
                if (handle1) {
                    handle = handle1
                    isNewHandle = true
                }
            }

            if (handle) {
                try {
                    await queryHandlePerm(handle)
                }catch (e: any){
                    return {
                        error: 'no permission to write to the file system, cannot save file', //e?.message || 'Unknown error'
                    }
                }
                const fileFile = typeof file === 'string' ? await fileFromDataUrl(file, name) : file
                const previewFile = typeof preview === 'string' ? await fileFromDataUrl(preview, name) : preview
                // console.log(scene)
                const fileExt = fileFile.name.split('.').pop()!
                const previewExt = previewFile?.name.split('.').pop()

                // check for overwrite if new handle
                // complicated loop prompting the user
                if (isNewHandle || props.isNewName) {
                    const fileExists = async (f: string) => !!(await handle!.getFileHandle(f).catch((e) => {
                        if(e.name === "NotFoundError") return null
                        if(e.name === "TypeMismatchError") return true
                        throw e
                    }))

                    let name1: string | null = name
                    const checkPreview = async () => {
                        if (!previewFile) return true
                        if (!await fileExists(name + '.' + previewExt)) {
                            return true
                        }
                        name1 = await changeName(name, previewExt!) // ask for overwrite(returns the same name if yes), or asks for a new name(returns that), or returns null if cancelled on new name stage
                        return name1 === name;
                    }
                    while (true) {
                        if (!name1) {
                            return {
                                warn: 'saving file cancelled'
                            }
                        }
                        name = name1
                        if (!await fileExists(name + '.' + fileExt)) {
                            if (await checkPreview()) break
                            continue
                        }
                        name1 = await changeName(name, fileExt) // ask for overwrite(returns the same name if yes), or asks for a new name(returns that), or returns null if cancelled on new name stage
                        if (name1 === name && await checkPreview()) break
                    }
                    name = name1 // not needed actually
                }

                const fileHandle = await handle.getFileHandle(name + '.' + fileExt, {create: true})
                const previewHandle = previewFile && await handle.getFileHandle(name + '.' + previewExt!, {create: true})
                const writer = await fileHandle.createWritable()
                await writer.write(fileFile)
                await writer.close()
                if (previewHandle) {
                    const writer = await previewHandle.createWritable()
                    await writer.write(previewFile)
                    await writer.close()
                }
                filePath = name + '.' + fileExt
                // this is commented so that the preview is always stored in idb, since handles can require permission on reload.
                // preview = previewFile && (name + '.' + previewExt)

            }
        }

        const fileKey = typeof file === 'string' ? 'file' : file.name
        const previewKey = typeof preview === 'string' ? 'preview' : preview?.name || 'preview'
        const metaKey = FILE_META_KEY
        const meta1 = {
            path: name,
            lastModified: scene.lastModified,
            file: (typeof filePath === 'string' && filePath.length < 500) ?
                filePath :
                (STORE_NAME + ':./' + fileKey),
            preview: (typeof preview === 'string' && preview.length < 500) ?
                preview :
                (STORE_NAME + ':./' + previewKey),
            handle,
        } as SavedSceneFileMetaStored
        if (!meta1.path.endsWith('/')) meta1.path += '/'
        await this.browserStore.put(meta1, meta1.path + metaKey)
        if (filePath !== meta1.file) await this.browserStore.put(file, meta1.path + fileKey)
        if (preview !== meta1.preview) await this.browserStore.put(preview, meta1.path + previewKey)

        this.loadedNeedsSave = false
        return (await this.getFileFromMeta(meta1)) ?? {error: 'Failed to get saved file'}
    }

    async isTempFile(path: string) {
        const meta = await getMeta(path)
        if (!meta) return false
        return !meta.handle || typeof meta.file === 'string' && meta.file.startsWith(STORE_NAME + ':')
    }

    // async refreshFile(meta: SavedSceneFile): Promise<SavedSceneFile | undefined> {
    //     if (!meta) return
    //     if (meta.file) meta.file = await resolveFile(meta.file, meta.path, meta.handle)
    //     return meta
    // }

    async getFileFromMeta(meta: SavedSceneFileMetaStored | SavedSceneFileMeta): Promise<SavedSceneFile | undefined> {
        if (!meta) return
        const meta2: SavedSceneFile = {
            ...meta,
            file: await resolveFile(meta.file, meta.path, meta.handle),
            preview: typeof meta.preview === 'string' ? await resolveFile(meta.preview, meta.path, meta.handle) : null,
        }
        return meta2
    }
    async getLoadedProject(meta: SavedSceneFileMetaStored | SavedSceneFileMeta | null): Promise<LoadedProject | null> {
        if (!meta) return null
        if (!meta.handle) return null
        const handle = meta.handle
        await queryHandlePerm(handle);
        return isPackageProject(meta) ?
            await this.initReadWriteProject(meta) :
            await this.getFileFromMeta(meta) || null
    }
    async getLoadedFile(project: LoadedProject, path: string, file?: File): Promise<SavedSceneFile | null> {
        if (!project || !path) return null
        file = file ?? await resolveFile(path, project.path, project.handle)
        if(typeof file !== 'object') {
            if((!file || file === path) && path.endsWith('.scene.glb')){
                // empty file, handled in loadImport
                file = new File([''], path.split('/').pop() || 'scene.scene.glb', {type: 'model/gltf-binary', lastModified: Date.now()})
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

    private async initReadWriteProject(meta: SavedSceneFileMeta | SavedSceneFileMetaStored): Promise<LoadedProject>{
        const init = await initProjectHandles(meta)

        if(!init.package.handle || !init.package.file){
            // packageFileHandle = await handle.getFileHandle(meta.file, {create: true}).catch(e=>{
            //     console.error('ThreeEditor - cannot create package.json file', e)
            //     return undefined
            // })
            // if(!packageFileHandle) throw new Error('No package.json file in project and cannot create one')
            const defaultPackageJson = {
                ...packageJsonTemplate,
                name: meta.path.replace(/\/$/, '').split('/').pop() || packageJsonTemplate.name,
            }
            const file = new File([JSON.stringify(defaultPackageJson, null, 2)], 'package.json', {type: 'application/json', lastModified: Date.now()})
            // @ts-ignore todo fix all types, browser store thing...
            const filename = typeof meta.file === 'string' ? meta.file : meta.file.name
            const w = await this.fsHelper.writeFile(init.base, filename, file, meta.path, true).catch(e=>{
                console.error('ThreeEditor - cannot write default package.json file', e)
                return false
            })
            if(!w) throw new Error('No package.json file in project and cannot create one')
            init.package.file = file
        }
        if(!init.package.file){
            throw new Error('No package.json file in project')
        }

        if(typeof meta.preview === 'string') { // todo when is it a File object? is it possible in package.json projects?
            let iconFileHandle = await init.base.getFileHandle(meta.preview).catch((e) => {
                // todo handle if there is dir with same name
                // if(e.name === "NotFoundError") return null
                // if(e.name === "TypeMismatchError") return true
                return undefined
            })
            if (!iconFileHandle) {
                iconFileHandle = await init.base.getFileHandle(meta.preview, {create: true}).catch(e=>{
                    console.error('ThreeEditor - cannot create icon file', e)
                    return undefined
                })
                if(iconFileHandle) {
                    // const writer = await iconFileHandle.createWritable()
                    // // write empty png
                    // await writer.write(Uint8Array.from(defaultIconTemplate, c => c.charCodeAt(0)))
                    // await writer.close()
                    const d = meta.preview.endsWith('.svg') ?
                        defaultIconTemplateSvg :
                        Uint8Array.from(defaultIconTemplatePng, c => c.charCodeAt(0))
                    await writeFileHandle(iconFileHandle, d).catch(e=>{
                        console.error('ThreeEditor - cannot write default icon file', e)
                        // ignore error
                    })
                }
            }
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


        if(!init.mainJs.handle || !init.mainJs.file){
            // mainJsHandle = await handle.getFileHandle(meta.file, {create: true}).catch(e=>{
            //     console.error('ThreeEditor - cannot create main.js file', e)
            //     return undefined
            // })
            // if(!mainJsHandle) throw new Error('No main.js file in project and cannot create one')
            // const writer = await mainJsHandle.createWritable()
            // await writer.write(mainJsTemplate)
            // await writer.close()
            const file = new File([mainJsTemplate], 'main.js', {type: 'application/javascript', lastModified: Date.now()})
            const w = await this.fsHelper.writeFile(init.base, 'main.js', file, meta.path, true).catch(e=>{
                console.error('ThreeEditor - cannot write default main.js file', e)
                return false
            })
            // if(!w) throw new Error('No main.js file in project and cannot create one')
            if(w) init.mainJs.file = file
        }
        if(!init.mainJs.file) {
            // throw new Error('No main.js file in project and cannot create one')
            console.error('No main.js file in project and cannot create one')
        }

        // asset manifest.json
        if(!init.assetsJson.handle || !init.assetsJson.file){
            const file = new File([JSON.stringify({
                files: {},
                version: 1,
            } as AssetsJSONManifest)], 'assets.json', {type: 'application/json', lastModified: Date.now()})
            const w = await this.fsHelper.writeFile(init.base, 'assets.json', file, meta.path, true).catch(e=>{
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

        if(meta.handle && !(await meta.handle.getFileHandle('AGENTS.md').catch(()=>null))){
            const file = new File([agentsMdTemplate], 'AGENTS.md', {type: 'text/markdown', lastModified: Date.now()})
            const w = await this.fsHelper.writeFile(init.base, 'AGENTS.md', file, meta.path, true).catch(e=>{
                console.error('ThreeEditor - cannot write default AGENTS.md file', e)
                return false
            })
            if(!w) console.error('ThreeEditor - cannot create AGENTS.md file')
        }

        if(meta.handle && !(await meta.handle.getFileHandle('.gitignore').catch(()=>null))){
            const file = new File([gitignoreTemplate], '.gitignore', {type: 'text/plain', lastModified: Date.now()})
            const w = await this.fsHelper.writeFile(init.base, '.gitignore', file, meta.path, true).catch(e=>{
                console.error('ThreeEditor - cannot write default .gitignore file', e)
                return false
            })
            if(!w) console.error('ThreeEditor - cannot create .gitignore file')
        }

        if(meta.handle && !(await meta.handle.getFileHandle('.mcp.json').catch(()=>null))){
            const file = new File([JSON.stringify(mcpJsonTemplate, null, 2)], '.mcp.json', {type: 'application/json', lastModified: Date.now()})
            const w = await this.fsHelper.writeFile(init.base, '.mcp.json', file, meta.path, true).catch(e=>{
                console.error('ThreeEditor - cannot write default .mcp.json file', e)
                return false
            })
            if(!w) console.error('ThreeEditor - cannot create .mcp.json file')
        }

        try {
            const m = await parsePackageJsonSettings(init.package.file, meta)
            const assetsJsonText = init.assetsJson.file ? await init.assetsJson.file.text() : ''
            const json = parseAssetsJSONManifest(assetsJsonText)
            m.assetsManifest = json
            await this.browserStore.put(m, m.path + FILE_META_KEY)
            return m
        }catch (e){
            console.error('ThreeEditor - cannot read package.json file', e)
            throw new Error('Cannot read package.json file')
        }
    }

    async addIdToAssetsManifest(file: FileManifestEntry| { path: string, file?: File }, assetId?: string){
        assetId = assetId || generateUUID()
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
        const saved = await this.fsHelper.writeFile(project.handle, fileName, newFile, project.path).catch(e => {
            console.error(e)
            return false
        })
        if (!saved) {
            throw new Error('Failed to save assets manifest file')
        }
        return assetId
    }

    async buildProjectBundleCode(){
        if(!this.loadedProject?.settings) throw new Error('No loaded project or settings to build main.js')
        const settings = this.loadedProject?.settings
        // todo mainjs, baseUrl
        const code = buildProjectBundleCode(settings)
        // todo copy asset files, imports files, write code to dist
    }

    async createNewProjectMeta(name: string, handle: FileSystemDirectoryHandle) {
        // store meta in idb
        const meta1 = await createMeta(name, handle)
        // if (file !== meta1.file) await this.browserStore.put(file, meta1.path + fileKey)
        // if (preview !== meta1.preview) await this.browserStore.put(preview, meta1.path + previewKey)
        const meta2 = await this.initReadWriteProject(meta1)
        return meta2
    }

    async listFiles(prefix = '') {
        const keys = await this.browserStore.getKeys()
        return keys
            .filter(k => k.startsWith(prefix) && k.endsWith('/' + FILE_META_KEY))
            .map(k => k.slice(0, -FILE_META_KEY.length - 1))
    }

    async listFilesMeta(prefix = '', preview = false): Promise<SavedSceneFileMeta[]> {
        const keys = await this.listFiles(prefix)
        const meta = (await Promise.all(keys.map(k => preview ? getMetaWithPreview(k) : getMeta(k)))).filter(v=>!!v)
        return meta.filter(m => m)
    }

    // this should not use this.loadedProject, loadedScene etc
    async exportScene(name = 'scene', takePreview = true, ext = 'glb') {
        const viewer = this.get()
        if (!viewer) {
            return {
                error: 'no viewer'
            }
        }

        if(this.playMode.isRunningMode){
            return {
                error: 'cannot export scene while running/playing'
            }
        }

        this.features.disable('edit-mode', 'exportScene')
        this.features.disable('picking', 'exportScene')
        viewer.getPlugin(EntityComponentPlugin)?.disable('exportScene')

        const controls = viewer.scene.mainCamera.controls as OrbitControls3|undefined
        if(controls?.stopDamping) controls.stopDamping()
        // todo disable interactions etc?

        // todo any other plugin/editor features to disable? like animations, timeline etc

        const e = viewer.renderEnabled
        viewer.renderEnabled = false

        const binary = ext === 'glb'

        const blob = await viewer.exportScene({
            binary,
            exportExt: ext,
            preserveUUIDs: true,
            viewerConfig: true,
            compress: false,
        }).catch(e=>{
            console.error('Failed to export scene', e)
            return undefined
        })

        viewer.renderEnabled = e

        if (blob) {

            const file = new File([blob], name + '.' + ext, {type: binary ? 'model/gltf-binary' : 'model/gltf+json'})

            let previewFile
            if (takePreview && viewer.renderEnabled) {
                const snapshotPlugin = viewer.getPlugin(CanvasSnapshotPlugin)!
                const preview = await snapshotPlugin.getFile('snapshot.jpeg', {
                    mimeType: 'image/jpeg',
                    quality: 0.85,
                    waitForProgressive: false,
                    // progressiveFrames: Math.min(64, viewer.getPlugin(ProgressivePlugin)?.maxFrameCount ?? 64),
                })

                previewFile = !preview ? '' : new File([preview], 'preview.jpg', {type: 'image/jpeg'})
            }

            this.features.enable('edit-mode', 'exportScene')
            this.features.enable('picking', 'exportScene')
            viewer.getPlugin(EntityComponentPlugin)?.enable('exportScene')

            return {file, preview: previewFile || ''}
        } else {

            this.features.enable('edit-mode', 'exportScene')
            this.features.enable('picking', 'exportScene')

            return {
                error: 'failed to export scene'
            }
        }

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

    async saveSceneAdHoc(name: string, changeName: (n: string, e: string) => Promise<string | null>, props: Parameters<ViewerInstanceManager['saveFileAdHoc']>[2]) {
        const res = await this.exportScene()
        if (!res.file) return res
        return await this.saveFileAdHoc({
            file: res.file, preview: res.preview,
            path: name,
            lastModified: Date.now()
        }, changeName, props)
    }

    async writeAssetFile(project: string, obj: IObject3D|IMaterial, assetId: string, handle: FileSystemDirectoryHandle, assetPath: string, res: {file: File, preview?: string | File}) {
        const res1 = await this.fsHelper.writeFile(handle, assetPath, res.file, project).catch(e => {
            console.error('Failed to save asset file.', e)
            return false
        })
        if(!res1){
            // delete obj.userData.tpAssetId
            return {error: 'Failed to save asset file.'}
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

    private async getProjectMeta(project: LoadedProject){
        const meta = await getMeta(project.path) as LoadedProject|undefined
        if(!meta?.handle) {
            return {error: 'No handle found for project, cannot save.'}
        }
        if(!meta.assets) {
            return {error: 'Project does not have an assets folder configured.'}
        }
        if(project.assetsManifest){
            if(!meta.assetsManifest) meta.assetsManifest = project.assetsManifest
            else {
                if(meta.assetsManifest.version <= project.assetsManifest.version){
                    meta.assetsManifest = project.assetsManifest
                }
            }
        }
        if(typeof project.file === 'object'){
            // temp hack for type issue in meta browser store.
            if(typeof meta.file === 'string') meta.file = project.file
        }
        return {meta, error: null, handle: meta.handle, assets: meta.assets}
    }

    // async getProjectFile(project: string, file: string){
    //     const {meta, ...res} = await this.getProjectMeta(project)
    //     if(res.error || !meta) throw new Error(res.error || 'Unknown error getting project meta')
    //     return resolveFile(file, meta.path, meta.handle)
    // }

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

    fetchProjectAsset = async (url: string, project?: LoadedProject|null) => {
        if(!url.startsWith(assetUrlPrefix)) return url
        project = project ?? this.loadedProject
        if(!project){
            console.error('No project loaded, cannot import asset')
            return url
        }

        const filePath = this.resolveAssetIdPath(url, project)

        const ex = this.fileTracker.getFile(project.path + filePath)
        if(ex) {
            ex.lastUsed = Date.now()
            // console.log('Returning from stash', project.path + url1, ex)
            return ex.objectUrl
        }

        // console.log('not found in stash', project.path + filePath, ex)
        // const meta = await getMeta(project)
        const sceneFile = project ? await resolveFile(filePath, project.path, project.handle) : undefined
        const objectUrl = this.fileTracker.setFile(project.path + filePath, sceneFile)
        // console.log('add to stash', project.path + filePath, ex)
        return objectUrl
    }

    defaultViewerSettings: ISerializedViewerConfig|null = null
    loadedProject: LoadedProject|null = null

    mcpBridge: MCPBridgeClient | undefined

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
        this.mcpBridge?.disconnect()
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

            // const imports: Record<string, string> = config.imports ?? {}
            // dependencies.push(...Object.entries(imports).map(([k, url])=>({
            //     key: k,
            //     url: url,
            //     version: ''
            // })))
            // ImportMapsManager.addDependency(...dependencies)
            this.loadedProject = meta
            this.scriptUtil.project = meta

            await this.scriptUtil.loadProjectExtScript({import: "threepipe"})
            // todo promise?
            await this.settingsManager.onProjectSettingsChange(config, null)
        }else {
            v = this.reset(props)
            this.loadedProject = meta
            // this.scriptUtil.project = meta

            // console.time('settings load')
            await this.scriptUtil.loadProjectExtScript({import: "threepipe"})
            // todo promise?
            await this.settingsManager.onProjectSettingsChange(emptyProjectSettings, null)
            // console.timeEnd('settings load')
        }
        this._loadedNeedsSave = false
        if (this.loadedProject) {
            const query = new URLSearchParams(globalThis.location?.search || '')
            const wsUrl = query.get('kiteCompanion') || undefined
            const token = globalThis.sessionStorage?.getItem('kite-companion-token') || undefined
            const projectId = query.get('kiteProject') || this.loadedProject.path.replace(/\/$/, '')
            const sceneId = query.get('kiteScene') || this.loadedProject.settings?.mainScene || undefined
            this.mcpBridge = initMCPBridge({manager: this, wsUrl, token, projectId, editorId: this.editorId, sceneId})
            if (wsUrl && token && sceneId) this.mcpBridge.connect().catch(error => console.error('[MCPBridge] Unable to pair with companion', error))
        } else {
            this.mcpBridge = undefined
        }
        this.dispatchEvent({type: 'mcpBridgeChange'})
        return v
    }

    async refreshPackageJson(){
        const project = this.loadedProject
        if(!project?.handle || !project?.settings) return

        const file: File = await resolveFile('package.json', project.path, project.handle)
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
                const file: File = await resolveFile(path, project.path, project.handle)
                const text = await file.text()
                const json = parseAssetsJSONManifest(text)
                project.assetsManifest = json
            }catch (e) {
                console.error('Unable to refresh assets.json after change')
                console.error(e)
            }
        }
    }

    async refreshProjectFiles(paths: string[]) {
        const project = this.loadedProject
        if (!project) throw new Error('No project loaded')
        const uniquePaths = [...new Set(paths)]
        for (const path of uniquePaths) await this.onObserveFileChange(path, project)
        await this.scriptUtil.scriptFilesChanged(uniquePaths)
        this.dispatchEvent({type: 'projectFilesChanged', paths: uniquePaths})
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

    authoringRevision = 0
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
    }

    // this will refresh file in the asset registry, i.e load it again.
    async loadImport(file: SavedSceneFile | {path: string, file?: File}, project: LoadedProject, isMain = false) {
        const sceneFile: File | undefined = file.file ??
            (file === project ?
            await resolveFile(project.file, project.path, project.handle) :
            await resolveFile(file.path, project.path, project.handle))
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
                if(file !== project && !file.path.endsWith('.scene.glb')) {
                    res = await v.assetManager.tracker.refreshFromRegistry(fileRootPath, {
                        // processRaw: true,
                        // cacheAsset: false,
                        // pathOverride: fileRootPath,
                        importedFile: sceneFile,
                    }).pms
                    // todo we need to reset the asset if not saved when its removed from scene (or remove from registry)
                    // res = await v.assetManager.loadImported(res)
                }else { // isMain and ends with .scene.glb
                    // todo use tracker to import, then call loadImported in manager
                    const isEmptyScene = isValidFile && ((sceneFile).name === 'dummy' || sceneFile.size === 0)
                    if(!isEmptyScene)
                        res = await v.load(fileRootPath, {
                            // processRaw: true,
                            // cacheAsset: false,
                            // pathOverride: assetUrlPrefix + file.path
                            importedFile: sceneFile,
                        })
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
            if (!entry.path.endsWith('.scene.glb') && entry.path.startsWith((this.loadedProject?.assets?.replace(/\/$/, '') ?? 'assets') + '/')) {
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
            const filePath = `.${settingsKey}/running/${this.editorId}.scene.glb`
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
    async loadProjectFile(file: SavedSceneFile | null, force = false, unloadingProject = false){
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

        refreshProjectQueryState({project: unloadingProject ? null : project?.path||null, file: file?.path??null})

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
            this.loadedNeedsSave = true // obj._tpAssetNeedsSave ?? false

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
            // this.get().getPlugin(EditModePlugin)?.fitView()
            this.get().getPlugin(EditModePlugin)?.resetView()
            // if(this.loadedProjectFile)
            //     this.startRunMode()
            return obj
        }else {
            // 404 no file
            if(file.path.endsWith('.scene.glb') || file.path.endsWith('.scene.json')) {
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
        // get latest meta
        const {meta, handle, ...rese} = await this.getProjectMeta(project)
        if (!handle || !meta) return {...rese, error: rese.error || 'Cannot get project directory handle'}
        // debugger
        Object.assign(project, meta)

        this.savingScene = true

        if(scene) {
            const res = await this.exportScene(scene ? 'scene' : 'asset', true)
            if (!res.file) {
                this.savingScene = false
                return res
            }
            const filePath = scene
            const backupFilePath = backupPath(scene, Date.now().toFixed()) // todo clear old backups?
            const previewFilePath = thumbPath(scene)

            let handles = await getFileHandle(handle, filePath, false)
            if (handles.fileHandle) {
                // file exists, create a backup
                const originalFile = await handles.fileHandle.getFile()
                this.fsHelper.writeFile(handle, backupFilePath, originalFile, project.path).catch(e => {
                    console.error('Failed to create backup of scene file.', e)
                })
            }
            const saved = await this.fsHelper.writeFile(handle, filePath, res.file, project.path).catch(e => {
                console.error(e)
                return false
            })
            if (!saved) {
                this.savingScene = false
                return {error: 'Failed to save scene file.'}
            }

            if (res.preview) {
                if ((res.preview as File).name) {
                    await this.fsHelper.writeFile(handle, previewFilePath, res.preview as File, project.path).catch(e => {
                        console.error('Unable to save scene thumbnail')
                        console.error(e)
                        return false
                    })
                } else {
                    console.error('Invalid preview file, cannot save scene thumbnail.')
                }
            }

            project.lastModified = Date.now()
            // @ts-ignore
            project.lastScene = scene || undefined // todo use this when loading project
            await this.browserStore.put(project, project.path + FILE_META_KEY)

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

        // get latest meta
        const {meta, handle, assets, ...rese} = await this.getProjectMeta(project)
        if (!handle || !meta || !assets) return {...rese, error: rese.error || 'Cannot get project directory handle'}
        Object.assign(project, meta)

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

        const res2 = await this.writeAssetFile(project.path, obj, assetId, handle, assetPath, res)
        if(res2?.error){
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

        // get latest meta
        const {meta, handle, assets, ...rese} = await this.getProjectMeta(project)
        if (!handle || !meta || !assets) return {...rese, error: rese.error || 'Cannot get project directory handle'}
        Object.assign(project, meta)

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

        const res2 = await this.writeAssetFile(project.path, obj, assetId, handle, path, res)
        if(res2?.error){
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
                await this.fsHelper.writeFile(project.handle, previewPath, f, project.path).catch(e => {
                    console.error('Error writing texture preview: ', previewPath, e)
                    return false
                })
            }
        }
        previewRefresh() // not awaiting
    }

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
