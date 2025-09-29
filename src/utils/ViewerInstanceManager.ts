import {
    AnimationObjectPlugin,
    AssetExporterPlugin,
    BoxGeometry,
    CameraViewPlugin,
    CanvasSnapshotPlugin,
    CascadedShadowsPlugin,
    ChromaticAberrationPlugin,
    ClearcoatTintPlugin,
    ContactShadowGroundPlugin,
    CustomBumpMapPlugin,
    DepthBufferPlugin,
    DeviceOrientationControlsPlugin,
    DirectionalLight2,
    EditorViewWidgetPlugin,
    Euler, EventDispatcher,
    FilmicGrainPlugin,
    FragmentClippingExtensionPlugin,
    FrameFadePlugin,
    FullScreenPlugin,
    GBufferPlugin,
    generateUUID,
    GLTFAnimationPlugin,
    GLTFKHRMaterialVariantsPlugin,
    GLTFMeshOptDecodePlugin,
    HalfFloatType,
    HDRiGroundPlugin,
    HemisphereLight2,
    htmlDialogWrapper,
    IMaterial,
    iMaterialCommons,
    ImportResult,
    IObject3D,
    iObjectCommons,
    ITexture,
    JSONMaterialLoader,
    KTX2LoadPlugin,
    KTXLoadPlugin,
    LoadingScreenPlugin,
    Mesh2,
    MeshOptSimplifyModifierPlugin,
    NoiseBumpMaterialPlugin,
    NormalBufferPlugin,
    Object3DGeneratorPlugin,
    Object3DWidgetsPlugin,
    ObjectConstraintsPlugin, onChangeDispatchEvent,
    ParallaxMappingPlugin,
    PickingPlugin,
    PlaneGeometry,
    PLYLoadPlugin,
    PointerLockControlsPlugin,
    PopmotionPlugin,
    populateTpAssetIds,
    populateTpAssetIdsMat,
    populateTpAssetIdsTex,
    ProgressivePlugin,
    RenderTargetPreviewPlugin,
    Rhino3dmLoadPlugin,
    Scene,
    SSAAPlugin,
    SSAOPlugin,
    STLLoadPlugin,
    ThreeFirstPersonControlsPlugin,
    ThreeViewer,
    TransformAnimationPlugin,
    TransformControlsPlugin,
    UnlitMaterial,
    UnsignedByteType,
    USDZLoadPlugin,
    ViewerUiConfigPlugin,
    VignettePlugin,
    VirtualCamerasPlugin
} from 'threepipe'
import {BlueprintJsUiPlugin2} from '../UiConfigRendererBlueprint2.tsx'
import {GeometryGeneratorPlugin} from '@threepipe/plugin-geometry-generator'
import {createContext, createElement, useState} from 'react'
import {useSafeContext} from './useSafeContext.ts'
import {browserFileStore} from './BrowserFileStore.ts'
import {EditorFeatures} from './EditorFeatures.ts'
// import {extraImportPlugins} from '@threepipe/plugins-extra-importers'
import {GLTFDracoExportPlugin, GLTFSpecGlossinessConverterPlugin} from '@threepipe/plugin-gltf-transform'
// import {MaterialConfiguratorPlugin, SwitchNodePlugin} from '@threepipe/plugin-configurator'
// import {
//     AnisotropyPlugin,
//     BloomPlugin,
//     DepthOfFieldPlugin,
//     OutlinePlugin,
//     SSContactShadowsPlugin,
//     SSGIPlugin,
//     SSReflectionPlugin,
//     TemporalAAPlugin,
//     VelocityBufferPlugin,
// } from '@threepipe/webgi-plugins'
// import {
//     B3DMLoadPlugin,
//     CMPTLoadPlugin,
//     DeepZoomImageLoadPlugin,
//     EnvironmentControlsPlugin,
//     GlobeControlsPlugin,
//     I3DMLoadPlugin,
//     PNTSLoadPlugin,
//     TilesRendererPlugin,
// } from '@threepipe/plugin-3d-tiles-renderer'
// import {AssimpJsPlugin} from '@threepipe/plugin-assimpjs'
// import {ThreeGpuPathTracerPlugin} from '@threepipe/plugin-path-tracing'
// import {BlendLoadPlugin} from "@threepipe/plugin-blend-importer";
// import {TransfrSharePlugin} from '@threepipe/plugin-network'
// import {TroikaTextPlugin} from "@threepipe/plugin-troika-text";
import {EditModePlugin} from "./EditModePlugin.ts";
import {ImportMapsManager, PackageDependency} from "./importMaps.ts";
import {SandboxPlugin, SupPluginModule} from "./SandboxPlugin.ts";
import {checkInitProject, isPackageProject, LoadedProject} from "./projectActions.tsx";
import {showSuccessErrorToast} from "./Toaster.tsx";

export interface ViewerProps {
    msaa: boolean,
    rgbm: boolean,
    zPrepass: boolean
    renderScale: number
    debug: boolean
    tonemap: boolean
}
// @ts-expect-error polyfill for new threejs
Scene.prototype.backgroundRotation = new Euler(0, 0, 0, 'XYZ')
// @ts-expect-error polyfill
Scene.prototype.environmentRotation = new Euler(0, 0, 0, 'XYZ')

declare global{
    interface Window {
        _tpFetchAsset: (url: string)=>Promise<string>
        _tpOriginalFetch: typeof fetch
        _tpFetchAssetPatch: boolean
    }
}
if(!window._tpFetchAssetPatch){
    window._tpOriginalFetch = window.fetch
    window._tpFetchAssetPatch = true
    window.fetch = async (input: RequestInfo | URL, ...rest) => {
        let url = typeof input === 'string' ? input : (input as Request).url
        // console.log(url)
        if(url && url.startsWith('asset://')){
            if(!window._tpFetchAsset){
                console.error('window._tpFetchAsset not found')
                window._tpFetchAsset = async (f)=>f
            }
            url = await window._tpFetchAsset(url)
            // console.log(url)
            if(typeof url === 'string'){
                input = url
            }
        }
        return window._tpOriginalFetch(input, ...rest)
    }
}

const settingsKey = "kite"

export interface BroadcastDataTypes{
    'file-change': {path: string, project: string, file: File}
}

export class ViewerInstanceManager extends EventDispatcher<{
    loadedNeedsSaveChange: {}
}>{
    private _viewers = new Map<string, ThreeViewer>()
    features = new EditorFeatures(this)

    static {
    }
    constructor() {
        super()
        window._tpFetchAsset = this.fetchProjectAsset
        this.broadcastChannel.onmessage = (e)=>{
            console.log('Broadcast message received', e)
            if(e.data.type === 'file-change'){
                const data = e.data as BroadcastDataTypes['file-change']
                // todo
                //  file could be
                //     package.json
                //     asset manifest
                //     current loaded scene/asset/file
                //     any loaded embedded assets
                //     what else?
            }
        }
        this.broadcastChannel.onmessageerror = (e)=>{
            console.error('Broadcast message error', e)
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
            rgbm: true,
            msaa: true,
            zPrepass: false,
            renderScale: "auto",
            ...props,
            assetManager: {
                //todo
            },
            dropzone: {
                //todo
            },
            plugins: []
            // todo: add more options
        })

        // todo remove event listener on dispose
        viewer.assetManager.importer.addEventListener('processRaw', (event) => {
            const f = async(obj: IObject3D|IMaterial)=>{
                if(!obj._isTpAsset || !this.loadedProject) return
                // asset is imported
                const assetId = obj._tpAssetId || obj.userData?.tpAssetId
                if(!assetId) {
                    console.error('Asset without an id imported', obj)
                    return
                }
                const path = (obj as ImportResult).__rootPath || obj.userData?.rootPath
                if(!path){
                    console.error('Asset without a path imported', assetId, obj)
                    return
                }
                const p1 = path.startsWith('asset://') ? path.slice('asset://'.length) : path
                const existing = this.assetManifest.files[assetId]
                if(existing){
                    const p2 = existing.startsWith('asset://') ? existing.slice('asset://'.length) : existing
                    if(p1 !== p2){
                        console.warn('Asset with same id but different path imported', assetId, p1, p2, obj)
                        //  get lastest asset id for the existing
                        //  if it doesnt exist, change path in manifest
                        //  if it exists with same id, generate new id for new asset
                        //  if it exists with diff id, change path in manifest
                        const existingId = await this.getAssetIdFromPath(p2)
                        if(!existingId){ // file doesnt exist
                            this.assetManifest.files[assetId] = p1
                            await this.saveAssetManifest()
                        }else {
                            if(existingId !== assetId){ // id changed inside the existing asset
                                this.assetManifest.files[assetId] = p1
                                await this.saveAssetManifest()
                            }else { // file duplicated or copied, change id and save new asset
                                console.warn('Duplicated asset imported, generating new asset id')
                                const newId = generateUUID()
                                obj._tpAssetId = newId
                                if(obj.userData) obj.userData.tpAssetId = newId
                                await this.saveProjectAsset(this.loadedProject, null, obj, p1)
                                // this.assetManifest.files[newId] = p1
                                // await this.saveAssetManifest()
                            }
                        }
                    }else {
                        // all good, same asset reimported
                    }
                }else {
                    this.assetManifest.files[assetId] = p1
                }
            }
            if(event.data.__loadingPromise) event.data.__loadingPromise.then(()=>f(event.data as any))
            else f(event.data as any)
        })
        viewer.canvas.style.width = '100%'
        viewer.canvas.style.height = '100%'
        viewer.addPluginSync(BlueprintJsUiPlugin2)

        viewer.addPluginsSync([
            SandboxPlugin,
             LoadingScreenPlugin,
            AssetExporterPlugin,
            GLTFDracoExportPlugin,
            GLTFSpecGlossinessConverterPlugin,
            PopmotionPlugin,
            AnimationObjectPlugin,
            new ProgressivePlugin(),
            new SSAAPlugin(),
            GLTFAnimationPlugin,
            TransformAnimationPlugin,
            new GBufferPlugin(HalfFloatType, true, true, true),
            new DepthBufferPlugin(HalfFloatType, false, false),
            new NormalBufferPlugin(HalfFloatType, false),
            CameraViewPlugin,
            FullScreenPlugin,
            new PickingPlugin(undefined, false), // false to disable built in picking ui
            ObjectConstraintsPlugin,
            new TransformControlsPlugin(true),
            // OutlinePlugin,
            new EditorViewWidgetPlugin('bottom-right', 100),
            ViewerUiConfigPlugin,
            ClearcoatTintPlugin,
            FragmentClippingExtensionPlugin,
            NoiseBumpMaterialPlugin,
            CustomBumpMapPlugin,
            // AnisotropyPlugin,
            new ParallaxMappingPlugin(false),
            GLTFKHRMaterialVariantsPlugin,
            VirtualCamerasPlugin,
            // new SceneUiConfigPlugin(), // this is already in ViewerUiPlugin
            new RenderTargetPreviewPlugin(false),
            new FrameFadePlugin(),
            new HDRiGroundPlugin(false, true),
            new VignettePlugin(false),
            new ChromaticAberrationPlugin(false),
            new FilmicGrainPlugin(false),
            new SSAOPlugin(UnsignedByteType, 1),
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
            ContactShadowGroundPlugin,
            // AdvancedGroundPlugin,
            CanvasSnapshotPlugin,
            DeviceOrientationControlsPlugin,
            PointerLockControlsPlugin,
            ThreeFirstPersonControlsPlugin,
            // InteractionPromptPlugin, // todo disable when not in Viewer tab, like in webgi
            new MeshOptSimplifyModifierPlugin(false, document.head), // will auto-initialize on first use.
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
            new CascadedShadowsPlugin(false),

            EditModePlugin,
        ])

        window._tpFetchAsset = this.fetchProjectAsset // just in case

        ThreeViewer.Dialog = htmlDialogWrapper

        JSONMaterialLoader.FindExistingMaterial = true // this is required for material asset loading same instance
        KTX2LoadPlugin.SAVE_SOURCE_BLOBS = true // so that embedded ktx files can be exported after import

        // for runtime player
        // viewer.assetManager.importer.addURLModifier((url)=>{
        //     if(url.startsWith('asset://')){
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

        // disable fading on update
        const fade = viewer.getPlugin(FrameFadePlugin)
        fade && (fade.isEditor = true)

        // const taa = viewer.getPlugin(TemporalAAPlugin)
        // taa && (taa.stableNoise = true)

        const rt = viewer.getOrAddPluginSync(RenderTargetPreviewPlugin)
        rt.addTarget(viewer.getPlugin(DepthBufferPlugin)?.target, 'depth', false, false, false)
        rt.addTarget(viewer.getPlugin(NormalBufferPlugin)?.target, 'normal', false, true, false)

        const loadingPlugin = viewer.getPlugin(LoadingScreenPlugin)
        if (loadingPlugin) {
            loadingPlugin.isEditor = true
            loadingPlugin.hide()
        }

        // const hemiLight = viewer.scene.addObject(new HemisphereLight(0xffffff, 0x444444, 5), {addToRoot: true})
        // hemiLight.name = 'Hemisphere Light'

        // viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr')
        console.log(viewer)

        this._viewers.set(id, viewer)
        ;(viewer as any)._props = {...props}
        return viewer
    }

    remove(id = 'default') {
        const viewer = this._viewers.get(id)
        if (viewer) {
            this._disposeViewer(viewer)
            this._viewers.delete(id)
        }
    }

    private _disposeViewer(viewer: ThreeViewer) {
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


    static readonly STORE_NAME = 'file_data_store'
    static readonly FILE_META_KEY = 'meta'
    static readonly SAVE_DIR_PICKER_ID = 'threepipe-editor-dir-1'

    // used for testing
    static readonly ENABLE_FS_WRITE_API = true

    async saveFileAdHoc(scene: SavedSceneFile, changeName: (n: string, e: string) => Promise<string | null>, props?: {
        isNewName?: boolean
        saveTempOnly?: boolean
    }): Promise<SavedSceneFile | { error?: string, warn?: string }> {
        const meta = await this.getMeta(scene.path)
        let isNewHandle = false
        let handle = meta?.handle
        let name = scene.path.split('/').pop() || 'scene'
        let file: File/* | string*/ = scene.file
        let filePath: string|null = typeof file === 'string' ? file : null
        const preview = scene.preview

        props = {...props ?? {}}

        if (!props.saveTempOnly && ViewerInstanceManager.ENABLE_FS_WRITE_API) {

            if ((!meta?.handle || props.isNewName) && 'showDirectoryPicker' in window) {
                const handle1 = await window.showDirectoryPicker({
                    id: ViewerInstanceManager.SAVE_DIR_PICKER_ID,
                    mode: "readwrite",
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
                let perm = await handle.queryPermission({mode: 'readwrite'})
                if (perm !== 'granted') {
                    perm = await handle.requestPermission({mode: 'readwrite'})
                }
                if (perm !== 'granted') {
                    return {
                        error: 'no permission to write to the file system, cannot save file'
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
                    const fileExists = async (f: string) => !!(await handle!.getFileHandle(f).catch(() => false))

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
        const metaKey = ViewerInstanceManager.FILE_META_KEY
        const meta1 = {
            path: name,
            lastModified: scene.lastModified,
            file: (typeof filePath === 'string' && filePath.length < 500) ?
                filePath :
                (ViewerInstanceManager.STORE_NAME + ':./' + fileKey),
            preview: (typeof preview === 'string' && preview.length < 500) ?
                preview :
                (ViewerInstanceManager.STORE_NAME + ':./' + previewKey),
            handle,
        } as SavedSceneFileMetaStored
        if (!meta1.path.endsWith('/')) meta1.path += '/'
        await this.browserStore.put(meta1, meta1.path + metaKey)
        if (filePath !== meta1.file) await this.browserStore.put(file, meta1.path + fileKey)
        if (preview !== meta1.preview) await this.browserStore.put(preview, meta1.path + previewKey)

        return (await this.getFileFromMeta(meta1)) ?? {error: 'Failed to get saved file'}
    }

    async isTempFile(path: string) {
        const meta = await this.getMeta(path)
        if (!meta) return false
        return !meta.handle || typeof meta.file === 'string' && meta.file.startsWith(ViewerInstanceManager.STORE_NAME + ':')
    }

    async resolveFile(value: string | File, path = '', handle?: SavedSceneFileMetaStored['handle']) {
        if (!path.endsWith('/')) path += '/'

        let res: any = value
        if (typeof value === 'string' && value.startsWith(ViewerInstanceManager.STORE_NAME + ':')) {
            const previewPath = value.slice(ViewerInstanceManager.STORE_NAME.length + 1).replace(/^\.\//, path)
            res = await this.browserStore.get(previewPath)
        }
        if (res === value && typeof value === 'string' && handle) {
            let permission = await handle.queryPermission({mode: 'readwrite'})
            if (permission !== 'granted') {
                permission = await handle.requestPermission({mode: 'readwrite'})
            }
            if (permission !== 'granted') {
                console.error('no permission to access the file')
                alert('no permission to access the file' + value + path)
            } else {
                const handles = await this.getFileHandle(handle, value, false)
                const file = await handles?.fileHandle?.getFile()
                if (file) res = file
            }
        }
        return res as File | any
    }

    async getMeta(path: string): Promise<SavedSceneFileMetaStored | undefined> {
        const metaKey = ViewerInstanceManager.FILE_META_KEY
        return await this.resolveFile(ViewerInstanceManager.STORE_NAME + ':./' + metaKey, path)
    }

    async getMetaWithPreview(path: string): Promise<SavedSceneFileMeta | undefined> {
        const meta = await this.getMeta(path)
        if (!meta) return
        if (meta.preview) meta.preview = await this.resolveFile(meta.preview, path, meta.handle)
        return meta
    }

    // async refreshFile(meta: SavedSceneFile): Promise<SavedSceneFile | undefined> {
    //     if (!meta) return
    //     if (meta.file) meta.file = await this.resolveFile(meta.file, meta.path, meta.handle)
    //     return meta
    // }

    async getFileFromMeta(meta: SavedSceneFileMetaStored | SavedSceneFileMeta): Promise<SavedSceneFile | undefined> {
        if (!meta) return
        const meta2: SavedSceneFile = {
            ...meta,
            file: await this.resolveFile(meta.file, meta.path, meta.handle),
            preview: typeof meta.preview === 'string' ? await this.resolveFile(meta.preview, meta.path, meta.handle) : null,
        }
        return meta2
    }
    async getLoadedProject(meta: SavedSceneFileMetaStored | SavedSceneFileMeta | null): Promise<LoadedProject | null> {
        if (!meta) return null
        return isPackageProject(meta) ?
            await checkInitProject(meta) :
            await this.getFileFromMeta(meta) || null
    }
    async getLoadedFile(project: LoadedProject, path: string, file?: File): Promise<SavedSceneFile | null> {
        if (!project || !path) return null
        file = file ?? await this.resolveFile(path, project.path, project.handle)
        if(!file) return null
        return {
            path,
            file,
            lastModified: file.lastModified,
            // preview: null,
            handle: project.handle,
        }
    }


    async listFiles(prefix = '') {
        const keys = await this.browserStore.getKeys()
        return keys
            .filter(k => k.startsWith(prefix) && k.endsWith('/' + ViewerInstanceManager.FILE_META_KEY))
            .map(k => k.slice(0, -ViewerInstanceManager.FILE_META_KEY.length - 1))
    }

    async listFilesMeta(prefix = '', preview = false): Promise<SavedSceneFileMeta[]> {
        const keys = await this.listFiles(prefix)
        const meta = await Promise.all(keys.map(k => preview ? this.getMetaWithPreview(k) : this.getMeta(k)))
        return meta.filter(m => m) as SavedSceneFileMeta[]
    }

    async exportScene(name = 'scene') {
        const viewer = this.get()
        if (!viewer) {
            return {
                error: 'no viewer'
            }
        }
        viewer.getPlugin(EditModePlugin)?.disable('exportScene')
        // todo any other plugin/editor features to disable?

        const blob = await viewer?.exportScene({
            binary: true,
            exportExt: 'glb',
            preserveUUIDs: true,
            viewerConfig: true,
        })
        if (!blob) {
            return {
                error: 'failed to export scene'
            }
        }
        const file = new File([blob], name + '.glb', {type: 'model/gltf-binary'})
        const snapshotPlugin = viewer.getPlugin(CanvasSnapshotPlugin)!
        const preview = await snapshotPlugin.getFile('snapshot.jpeg', {
            mimeType: 'image/jpeg',
            quality: 0.85,
            waitForProgressive: true,
            progressiveFrames: Math.min(64, viewer.getPlugin(ProgressivePlugin)?.maxFrameCount??64),
        })

        const previewFile = !preview ? '' : new File([preview], 'preview.jpg', {type: 'image/jpeg'})

        viewer.getPlugin(EditModePlugin)?.enable('exportScene')

        return {file, preview: previewFile}
    }

    async exportObject(obj: IObject3D|IMaterial, name = 'asset') {
        const viewer = this.get()
        if (!viewer) {
            return {
                error: 'no viewer'
            }
        }
        viewer.getPlugin(EditModePlugin)?.disable('exportObject')
        // todo any other plugin/editor features to disable?

        const ext = (obj as IMaterial).isMaterial ? 'mat' : 'glb'
        const blob = await viewer?.export(obj, {
            exportExt: ext,
            binary: true,
            // do not save uuid when saving glb asset object
            preserveUUIDs: !(obj as IObject3D).isObject3D, // only for objects
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

        viewer.getPlugin(EditModePlugin)?.enable('exportObject')

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

    // todo channel is never closed
    broadcastChannel = new BroadcastChannel(settingsKey + '-threepipe-editor')
    broadcastMessage<T extends keyof BroadcastDataTypes = keyof BroadcastDataTypes>(type: T, data: BroadcastDataTypes[T]){
        this.broadcastChannel.postMessage({type, ...data})
    }

    async writeFile(base: FileSystemDirectoryHandle, path: string, file: File, project: string){
        const handle = (await this.getFileHandle(base, path))?.fileHandle
        if(!handle){
            return false
        }
        await this._writeFileHandle(handle, file)
        // notify to other tabs
        try {
            this.broadcastMessage('file-change', {
                project,
                path,
                file,
                // lastModified: file.lastModified,
            })
        }catch (e) {
            console.warn('Failed to postMessage notification', e)
        }
        return true
    }
    private async _writeFileHandle(fileHandle: FileSystemFileHandle, file: File){
        const writer = await fileHandle.createWritable()
        await writer.write(file)
        await writer.close()
    }

    async getFileHandle(base: FileSystemDirectoryHandle, path: string, create = true) {
        const parts = path.split('/')
        const dirHandle = await this.getDirHandle(base, parts.slice(0, -1), create);
        const fileHandle = await dirHandle.getFileHandle(parts[parts.length - 1], {create}).catch(e=>{
            console.error(e)
            return undefined
        })
        return {fileHandle, dirHandle};
    }

    async getDirHandle(base: FileSystemDirectoryHandle, parts: string[]|string, create = true) {
        if(typeof parts === 'string') parts = parts.split('/').filter(Boolean)
        let dirHandle = base
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i]
            // if(i === parts.length - 1){
            //     fileHandle = await dirHandle.getFileHandle(part, {create: true})
            // } else {
            dirHandle = await dirHandle.getDirectoryHandle(part, {create})
            // }
        }
        return dirHandle
    }

    async writeAssetFile(project: string, obj: IObject3D|IMaterial, assetId: string, handle: FileSystemDirectoryHandle, assetPath: string, res: {file: File, preview?: string | File}, overrideId = false) {
        const res1 = await this.writeFile(handle, assetPath, res.file, project).catch(e => {
            console.error('Failed to save asset file.', e)
            return false
        })
        if(!res1){
            delete obj.userData.tpAssetId
            return {error: 'Failed to save asset file.'}
        }
        // todo
        //  save preview thumbnail

        obj.userData.rootPath = 'asset://' + assetPath // todo what if file is moved outside the editor while its open.
        obj.userData.rootPathOptions = {}
        obj.userData.sProperties = []
        if((obj as IObject3D).isObject3D) {
            (obj as IObject3D)._sChildren = []
        }

        try {
            if ((obj as IObject3D).isObject3D) {
                const objects: IObject3D[] = []
                    // todo traverse only sChildren like in GLTFExporter as children could have extra objects
                ;(obj as IObject3D).traverse(o => {
                    o.isObject3D && objects.push(o)
                })
                populateTpAssetIds(objects, assetId, overrideId)
            }

            if ((obj as IMaterial).isMaterial) {
                const {textures} = populateTpAssetIdsMat([obj as IMaterial], assetId)
                populateTpAssetIdsTex(textures, assetId)
            }
        }catch (e) {
            console.error('Unknown error populating asset ids, but asset was still created.', e)
            // ignore
        }

    }

    async getProjectMeta(project: string){
        const meta = await this.getMeta(project)
        if(!meta?.handle) {
            return {error: 'No handle found for project, cannot save.'}
        }
        if(!meta.assets) {
            return {error: 'Project does not have an assets folder configured.'}
        }
        return {meta, error: null, handle: meta.handle, assets: meta.assets}
    }

    async getProjectFile(project: string, file: string){
        const {meta, ...res} = await this.getProjectMeta(project)
        if(res.error || !meta) throw new Error(res.error || 'Unknown error getting project meta')
        return this.resolveFile(file, meta.path, meta.handle)
    }

    fetchProjectAsset = async (url: string, project?: LoadedProject|null) => {
        if(!url.startsWith('asset://')) return url
        const url1 = url.slice('asset://'.length)
        project = project ?? this.loadedProject
        if(!project){
            console.error('No project loaded, cannot import asset')
            return url
        }
        // const meta = await this.getMeta(project)
        const sceneFile = project ? await this.resolveFile(url1, project.path, project.handle) : undefined
        return URL.createObjectURL(sceneFile as Blob) + '#' + url1
    }

    loadedProject: LoadedProject|null = null
    loadProject(meta: LoadedProject|null, props: Partial<ViewerProps>){
        if(this.loadedProject === meta) return this.get() // already loaded
        this.loadedProject = meta
        let v
        if(meta && isPackageProject(meta)) {
            // todo
            // read package.json
            // load deps in import maps
            // listen to file change?
            const json = meta.settings?.json ?? {}
            const deps: Record<string, string> = {
                ...json['dependencies'] ?? {},
                // ...json['peerDependencies'] ?? {},
                // ...json['optionalDependencies'] ?? {},
            }
            const dependencies: PackageDependency[] = Object.entries(deps).map(([k, v])=>({
                key: k,
                version: v,
            }))
            const settings = json[settingsKey] ?? {} // todo validate value types etc
            const imports: Record<string, string> = settings.imports ?? {}
            const plugins: Record<string, ExternalPlugin>|(ExternalPlugin[]) = settings.plugins ?? {}

            v = this.reset({...props, ...settings.viewer})

            dependencies.push(...Object.entries(imports).map(([k, url])=>({
                key: k,
                url: url,
                version: ''
            })))
            ImportMapsManager.addDependency(...dependencies)

            this.loadProjectPlugins(Array.isArray(plugins) ? plugins : Object.values(plugins))
        }else {
            v = this.reset(props)
        }
        return v
    }

    pluginsLoading = false

    // for this.loadedProject
    async loadProjectPlugin(plugin: ExternalPlugin){
        this.pluginsLoading = true
        const path = plugin.import
        if(this.scriptModules.has(path)) {
            if(!plugin.active){
                // remove plugin
                const viewer = this.get()
                const res = await viewer.getPlugin(SandboxPlugin)!.unloadPlugin(path).catch(e=>{
                    console.error('Error unloading module for plugin: ', path, e)
                    return false
                })
                if(res) this.scriptModules.delete(path)
            }else {
                // Plugin already loaded
            }
            this.pluginsLoading = false
            return
        }
        if(!plugin.active) {
            this.pluginsLoading = false
            return
        }
        try {
            this.scriptModules.set(path, null)
            // todo test
            const path1 = path.match(/^[a-z]+:\/\//) ? path : await this.fetchProjectAsset('asset://'+path)
            const module: SupPluginModule = await import(/* @vite-ignore */ path1)
            // const module = await ImportMapsManager.dynamicImport(path)
            if(!module) {
                throw new Error('Failed to import plugin: ' + path)
            }
            module.__tpPluginPath = path // todo clone?
            const viewer = this.get()
            const res = await viewer.getPlugin(SandboxPlugin)!.loadPlugin(module, plugin.className, plugin.params).catch(e=>{
                console.error('Error loading module for plugin: ', path, e)
                return null
            })
            if(res) {
                // todo setup ui config
                this.scriptModules.set(path, module)
            }else {
                this.scriptModules.delete(path)
            }
        }catch (e) {
            console.error('Error loading plugin: ', path, e)
        }
        this.pluginsLoading = false
    }

    // for this.loadedProject
    async loadProjectPlugins(plugins: ExternalPlugin[]){
        if(!plugins || plugins.length === 0) return
        for (const id of plugins) {
            await this.loadProjectPlugin(id)
        }
    }

    // for this.loadedProject
    scriptModules: Map<string, SupPluginModule|null> = new Map()

    assetManifest = {
        files: {} as Record<string, string>,
        version: 1,
    }

    // for this.loadedProject
    loadedScene: string|null = null
    loadedAssetId: string|null = null
    loadedAssetObj: IObject3D|IMaterial|ITexture|null = null
    // loadedAssetType: 'object'|'material'|'texture'|null = null
    loadedProjectFile: SavedSceneFile | null = null

    // @onChangeDispatchEvent('loadedNeedsSaveChange')
    // loadedNeedsSave = false
    _loadedNeedsSave = false
    get loadedNeedsSave() {
        return this._loadedNeedsSave
    }
    set loadedNeedsSave(v) {
        if(this._loadedNeedsSave === v) return
        this._loadedNeedsSave = v
        this.dispatchEvent({type: 'loadedNeedsSaveChange'})
    }

    async loadImport(file: SavedSceneFile, project: LoadedProject, isMain = false) {
        const sceneFile = file.file ?? await this.resolveFile(file.path, project.path, project.handle)
        if (sceneFile && (sceneFile as File).name && (sceneFile as File).name !== 'dummy' && (sceneFile as File).name.includes('.')) {
            const v = this.get()
            let res
            if (isMain) {
                res = await v.load(sceneFile, {processRaw: true, cacheAsset: false, pathOverride: 'asset://'+file.path})
            } else {
                res = await v.assetManager.importer.importSingle(sceneFile, {
                    processRaw: true,
                    cacheAsset: false,
                    pathOverride: file.path
                })
            }
            if(!res) throw new Error('Failed to load file ' + file.path)
            return res
        }
        return null
    }

    async loadProjectFile(project: SavedSceneFile, file: SavedSceneFile){
        if(project !== this.loadedProject){
            console.error('Project does not match the loaded project, cannot load scene/asset.', file)
            return {error: 'Unknown Error loading scene/asset.'}
        }
        if(!file || !file.path){
            console.error('No file path provided, cannot load scene/asset.', file)
            return {error: 'No file path provided, cannot load scene/asset.'}
        }
        if(this.loadedProjectFile){
            if(this.loadedProjectFile === file){
                // todo check if file has updated hash and ask to reload?
                // already loaded
                return
            }
            if(this.loadedNeedsSave) return {error: 'Current scene/asset has unsaved changes, please save before loading another file.'}
            await this.unloadProjectFile(project, this.loadedProjectFile)
        }
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
            const isAsset = !!obj.userData.tpAssetId
            this.loadedScene = isScene ? file.path : null
            this.loadedAssetId = isAsset ? obj.userData.tpAssetId : null
            this.loadedAssetObj = isAsset ? obj : null
            this.loadedProjectFile = file
            this.loadedNeedsSave = obj._tpAssetNeedsSave ?? false

            // todo remove event listeners on file unload

            if(obj.isObject3D){
                if(this.loadedAssetObj) {
                    (obj as IObject3D).addEventListener('objectUpdate', () => {
                        if (this.loadedAssetObj !== obj) return
                        this.loadedNeedsSave = true
                        // todo update _tpAssetNeedsSave in threepipe and use that
                    })
                }else if(this.loadedScene){
                    v.scene.addEventListener('objectUpdate', ()=>{
                        if(this.loadedScene !== file.path) return
                        this.loadedNeedsSave = true
                        // todo update _tpAssetNeedsSave in threepipe and use that
                    })
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
                    // todo update _tpAssetNeedsSave in threepipe and use that
                })
            }
            if(obj.isTexture){
                const plane = new PlaneGeometry(1, 1)
                const mat = new UnlitMaterial({map: obj as ITexture})
                const planeObj = new Mesh2(plane as any, mat)
                // todo size, camera controls
                v.scene.addObject(planeObj)

                ;(obj as ITexture).addEventListener('textureUpdate', ()=>{
                    if(this.loadedAssetObj !== obj) return
                    this.loadedNeedsSave = true
                    // todo update _tpAssetNeedsSave in threepipe and use that
                })
            }

            return obj
        }else {
            // 404 no file
            if(file.path.endsWith('.scene.glb') || file.path.endsWith('.scene.json')) {
                // new project maybe
                this.loadedScene = file.path
                this.loadedAssetId = null
                this.loadedAssetObj = null
                this.loadedProjectFile = file
                this.loadedNeedsSave = true
            } else {
                if(file.file.name === 'dummy'){
                    return {error: null}
                }
                return {error: 'File not found: ' +  file.path}
            }
        }
    }

    // for this.loadedProject
    async unloadProjectFile(project: SavedSceneFile, file: SavedSceneFile, v?: ThreeViewer){
        if(project !== this.loadedProject){
            console.error('Project does not match the loaded project, cannot load file.', file)
            return
        }
        if(this.loadedProjectFile){
            if(this.loadedProjectFile !== file){
                console.error('File to unload does not match the loaded file, cannot unload.', file, this.loadedProjectFile)
                return
            }
            // todo unload current scene/asset
            const v = this.get()
            v.scene.disposeSceneModels(true, true)
            v.scene.disposeTextures(true)
            this.loadedScene = null
            this.loadedAssetId = null
            this.loadedAssetObj = null
            this.loadedProjectFile = null
            this.loadedNeedsSave = false
            // this.loadedAssetType = null
        }
    }

    // todo
    //  reloadScene

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
        const asset = this.loadedAssetId ? this.loadedAssetId : null
        if(!scene && !asset){
            console.error('Loaded path is neither a scene nor an asset, cannot save.', file)
            return {error: 'Unknown Error saving scene/asset.'}
        }
        if(scene && asset){
            throw new Error('Loaded path cannot be both a scene and an asset.')
        }
        // get latest meta
        const {meta, handle, ...rese} = await this.getProjectMeta(project.path)
        if (!handle || !meta) return {...rese, error: rese.error || 'Cannot get project directory handle'}
        Object.assign(project, meta)

        if(scene) {
            const res = await this.exportScene()
            if (!res.file) return res
            const filePath = scene
            const backupFilePath = `.${settingsKey}/backups/${scene}`
            const previewFilePath = `.${settingsKey}/thumbs/${scene}.png`

            // const parts = filePath.split('/')
            // const fileName = parts[parts.length - 1]
            // const dirHandle = await this.getDirHandle(handle, parts.slice(0, -1));
            // let fileHandle = await dirHandle.getFileHandle(fileName).catch(() => undefined)
            let handles = await this.getFileHandle(handle, filePath, false)
            if (handles.fileHandle) {
                // file exists, create a backup
                const originalFile = await handles.fileHandle.getFile()
                this.writeFile(handle, backupFilePath, originalFile, project.path).catch(e => {
                    console.error('Failed to create backup of scene file.', e)
                })
            }
            const saved = await this.writeFile(handle, filePath, res.file, project.path).catch(e => {
                console.error(e)
                return false
            })
            if (!saved) {
                return {error: 'Failed to save scene file.'}
            }

            if (res.preview) {
                if ((res.preview as File).name) {
                    await this.writeFile(handle, previewFilePath, res.preview as File, project.path).catch(e => {
                        console.error('Unable to save scene thumbnail')
                        console.error(e)
                        return false
                    })
                } else {
                    console.error('Invalid preview file, cannot save scene thumbnail.')
                }
            }

            project.lastModified = Date.now()
            project.lastScene = scene || undefined // todo use this when loading project
            await this.browserStore.put(project, project.path + ViewerInstanceManager.FILE_META_KEY)

            this.loadedNeedsSave = false
            return {error: null}
        }
        if(asset && this.loadedAssetObj){
            if((this.loadedAssetObj as ITexture).isTexture){
                return {error: "Texture Save not implemented yet."}
            }
            return this.saveProjectAsset(project, null, this.loadedAssetObj as IObject3D|IMaterial, file.path)
        }
        return {error: 'Unknown error saving scene/asset.'}
    }

    async saveNewProjectAsset(project: LoadedProject, scene: SavedSceneFile|null, obj: IObject3D|IMaterial, ext2 = 'asset') {
        if(!canMakeAsset(obj)) return {error: 'Object cannot be saved as asset. Make sure it has geometry and a material.'}

        // get latest meta
        const {meta, handle, assets, ...rese} = await this.getProjectMeta(project.path)
        if (!handle || !meta || !assets) return {...rese, error: rese.error || 'Cannot get project directory handle'}
        Object.assign(project, meta)

        const dirHandle = await this.getDirHandle(handle, assets).catch(e=>{
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
        //  preserve uuid should be false(for objects) - done
        //  for materials and textures, uuid should be saved
        //  loop through all children, materials, textures, etc and set asset id on them. (not in userdata). - done
        //  when exporting(the scene, other objects) check if any object/mat/tex has asset id, and only export its uuid. - done
        //  when loading assets, set asset id on object and other used objects, also set proper rootPath - done
        // save gltf in assets folder
        // set the rootPath, rootPathOptions in userdata
        // set sChildren to []
        // set userData.sProperties to []

        const assetId = generateUUID()
        obj.userData.tpAssetId = assetId

        const res = await this.exportObject(obj).catch(e=>{
            console.error(e)
            return {error: e?.message || e?.toString() || 'Unknown error exporting asset', file: null}
        })
        if (!res.file) {
            delete obj.userData.tpAssetId
            return res
        }

        let assetName = obj.name // todo clean for file name
            .replace(new RegExp(`\.${ext2}\.${res.ext}$`), '')
            .replace(new RegExp(`\.${res.ext}$`), '') || ((obj as IObject3D).isObject3D ? 'object' : 'material')

        const ext = `.${ext2}.${res.ext}`
        while (true) {
            const exists = !!(await dirHandle.getFileHandle(assetName + ext).catch(() => {
                return null
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
            delete obj.userData.tpAssetId
            return res2
        }

        if(scene){
            const res3 = await this.saveProjectSceneOrAsset(project, scene)
            if(res3?.error){
                // todo rollback asset creation, setting asset id reference, setting rootPath userData
                return res3
            }
        }

        if(this.assetManifest.files[assetId] !== assetPath) {
            this.assetManifest.files[assetId] = assetPath
            await this.saveAssetManifest().catch(e => {
                //ignore?
            })
        }

        return {error: null, path: assetPath}
    }

    async saveAssetManifest(){
        // todo write file
    }

    async saveProjectAsset(project: LoadedProject, scene: SavedSceneFile|null, obj: IObject3D|IMaterial, path: string) {
        if(!canSaveAsset(obj) || !path) return {error: 'Asset cannot be saved, make sure it is a valid asset'}

        // get latest meta
        const {meta, handle, assets, ...rese} = await this.getProjectMeta(project.path)
        if (!handle || !meta || !assets) return {...rese, error: rese.error || 'Cannot get project directory handle'}
        Object.assign(project, meta)

        const assetId = obj.userData.tpAssetId

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
        if(this.assetManifest.files[assetId] !== path) {
            this.assetManifest.files[assetId] = path
            await this.saveAssetManifest().catch(e => {
                //ignore?
            })
        }

        if(obj === this.loadedAssetObj){
            this.loadedNeedsSave = false
        }

        return scene && saveScene ? this.saveProjectSceneOrAsset(project, scene) : {error: null}
    }

    async getAssetIdFromPath(path: string): Promise<string|null> {
        // todo
        //  import asset from path
        //  get asset id from object
        //  if 404, return null
        return null
    }

}

interface ExternalPlugin{
    import: string,
    /**
     * @default `default`
     */
    className?: string,
    /**
     * @default true
     */
    active?: boolean,
    /**
     * Constructor parameters
     */
    params?: any[]

    // /**
    //  * to be able to disable running the plugin at runtime
    //  * not implemented
    //  * @default true
    //  */
    // runtime?: boolean,
    // /**
    //  * to be able to disable the plugin in the editor
    //  * @default true
    //  */
    // editor?: boolean
}

function useSetupProject(needsSave = false) {
    const [project, setProject] = useState<SavedSceneFile|null>(null)
    const [file, setFile] = useState<SavedSceneFile|null>(null)
    // const [scene, setScene] = useState<null | string>(null)
    const [path, setPath] = useState<null | string>(null)
    const [welcomeOpen, setWelcomeOpen] = useState(true)

    const [fileNeedsSave, setFileNeedsSave] = useState(needsSave)

    // Custom setProject that also updates URL immediately
    // const setProject = useCallback((newProject: string) => {
    //     // if (newProject) {
    //     //     console.log('Project changed:', newProject)
    //     // }
    //     // const params = new URLSearchParams(location.search)
    //     // const current = params.get('project') || params.get('p') || ''
    //     // if(current !== newProject) {
    //     //     if (params.has('project')) params.delete('project')
    //     //     if (params.has('p')) params.delete('p')
    //     //     params.set('p', newProject)
    //     //     window.history.replaceState({}, '', '?' + params.toString())
    //     // }
    //     _setProject(newProject)
    // }, [_setProject])

    // log file whenever it changes
    // useEffect(() => {
    //     if (file) {
    //         console.log('File changed:', file.name)
    //     }
    // }, [file])
    // // log path whenever it changes
    // useEffect(() => {
    //     if (path) {
    //         console.log('Path changed:', path)
    //     }
    // }, [path])
    return {
        project, setProject,
        projectFile: file, setPFile: setFile,
        path, setPath,
        // scene, setScene,
        welcomeOpen, setWelcomeOpen,
        fileNeedsSave, setFileNeedsSave,
    }
}

const ProjectContext = createContext<ReturnType<typeof useSetupProject>|undefined>(undefined)
export const useProject = () => useSafeContext(ProjectContext)

export function ProjectProvider({children}: { children: any }) {
    const value = useSetupProject()
    return createElement(ProjectContext.Provider, {value}, children)
}

export const ManagerContext = createContext<ViewerInstanceManager | undefined>(undefined)
export const useManager = () => useSafeContext(ManagerContext)

export function ManagerProvider({children}: { children: any }) {
    const [value] = useState(new ViewerInstanceManager())
    return createElement(ManagerContext.Provider, {value}, children)
}

export interface SavedSceneFile {
    path: string,
    file: File /*| string*/
    assets?: string,
    lastModified: number
    preview?: File | string
    scene?: File
    handle?: FileSystemDirectoryHandle
    // viewerConfig?: File | string | any // todo
}

export interface SavedSceneFileMetaStored {
    path: string,
    file: string
    assets?: string,
    lastModified: number
    preview?: string
    handle?: FileSystemDirectoryHandle
    // viewerConfig?: File | string | any // todo
}

export interface SavedSceneFileMeta {
    path: string,
    file: string
    assets?: string,
    lastModified: number
    preview?: File | string
    handle?: FileSystemDirectoryHandle
    // viewerConfig?: File | string | any // todo
}

const mimeToExt: any = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/svg+xml': 'svg',
    'image/webp': 'webp',
    'image/x-exr': 'exr',
    'image/x-hdr': 'hdr',
    'model/gltf+binary': 'glb',
    'model/gltf+json': 'gltf',
    'model/gltf': 'gltf',
}

async function fileFromDataUrl(dataUrl: string, name: string = 'file') {
    const type = dataUrl.slice(5, dataUrl.indexOf(';'))
    const ext = mimeToExt[type] ?? type.split('/')[1]
    const blob = await (await fetch(dataUrl)).blob()
    return new File([blob], name + '.' + ext, {type: blob.type})
}

export const canMakeAsset = (obj: IObject3D|IMaterial)=>{
    return ((obj as IObject3D).isObject3D || (obj as IMaterial).isMaterial)
        && obj.userData
        && !obj.userData.rootPath
        && !obj._tpAssetId  && !obj.userData.tpAssetId
        && !(obj as IObject3D).isScene
        && !(obj as IObject3D)._sChildren
        // todo
        && !(obj as IObject3D).material && !(obj as IObject3D).geometry &&
        !((obj as IObject3D).isObject3D ?
            iObjectCommons.getMapsForObject3D.call(obj as IObject3D) :
            iMaterialCommons.getMapsForMaterial.call(obj as IMaterial)
        ).size
}

export const canSaveAsset = (obj: IObject3D|IMaterial)=>{
    return ((obj as IObject3D).isObject3D || (obj as IMaterial).isMaterial)
        && obj._isTpAsset
        && obj.userData.tpAssetId
        && obj._tpAssetId
}

export function useMakeAsset(){
    const {project, projectFile} = useProject()
    const manager = useManager()
    const [isMaking, setIsMaking] = useState(false)

    const makeAsset = async (data: { obj: IObject3D|IMaterial })=>{
        if(!project || !projectFile) return false
        if(isMaking) return
        setIsMaking(true)

        const res = await manager.saveNewProjectAsset(project, projectFile, data.obj)
        setIsMaking(false)
        // @ts-ignore
        const r = showSuccessErrorToast(res.path ? `Created ${project.path}/${res.path} successfully` : 'Unknown Error', 'Unable to create asset', res)
        return r

    }
    return {makeAsset}
}
