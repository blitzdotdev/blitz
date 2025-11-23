import {
    BoxGeometry,
    CanvasSnapshotPlugin,
    Class,
    DepthBufferPlugin,
    DirectionalLight2,
    DropzonePlugin,
    EditorViewWidgetPlugin,
    EntityComponentPlugin,
    Euler,
    EventDispatcher,
    FrameFadePlugin,
    GBufferPlugin,
    generateUUID,
    getEmptyMeta,
    GLTFMeshOptDecodePlugin,
    HalfFloatType,
    HemisphereLight,
    HemisphereLight2,
    htmlDialogWrapper,
    IGeometry,
    IMaterial,
    iMaterialCommons,
    ImportResult,
    ImportResultExtras,
    IObject3D,
    iObjectCommons,
    ISerializedViewerConfig,
    ITexture,
    IViewerPlugin,
    JSONMaterialLoader,
    KTX2LoadPlugin,
    KTXLoadPlugin,
    LoadingScreenPlugin,
    MaterialPreviewGenerator,
    mergeResources,
    Mesh2,
    metaToResources,
    NormalBufferPlugin,
    Object3DComponent,
    Object3DGeneratorPlugin,
    Object3DWidgetsPlugin,
    OrbitControls3,
    PickingPlugin,
    PlaneGeometry,
    PLYLoadPlugin,
    PopmotionPlugin,
    RenderTargetPreviewPlugin,
    Rhino3dmLoadPlugin,
    Scene,
    STLLoadPlugin,
    ThreeViewer,
    TObject3DComponent,
    TransformControlsPlugin,
    UnlitMaterial,
    USDZLoadPlugin,
    GLTFLoader2,
    ILight,
    RootScene,
    IScene,
    PhysicalMaterial,
    UndoManagerPlugin,
    TypedClass,
    GLTFAnimationPlugin,
    onChangeDispatchEvent
} from 'threepipe'
import {BlueprintJsUiPlugin2} from '../UiConfigRendererBlueprint2.tsx'
import {GeometryGeneratorPlugin} from '@threepipe/plugin-geometry-generator'
import {createContext, createElement, useState} from 'react'
import {useSafeContext} from './useSafeContext.ts'
import {browserFileStore} from './BrowserFileStore.ts'
import {EditorFeatures} from './EditorFeatures.ts'
import {EditModePlugin} from "./EditModePlugin.ts";
import {ImportMapsManager} from "./importMaps.ts";
import {SupPluginModule} from "./SandboxPlugin.ts";
import {showSuccessErrorToast} from "./Toaster.tsx";
import {getFileChanged, loadModule, loadModules} from './modules.ts'
import {FileManifestEntry, manifestEntryToFile, SelectedInspectorItem} from "./AssetsProvider.ts";
import {parse} from 'jsonc-parser';
import {
    AssetsJSONManifest,
    assetUrlPrefix,
    buildProjectBundleCode,
    createMeta,
    ExternalPlugin,
    ExternalScript,
    FILE_META_KEY,
    getMeta,
    getMetaWithPreview,
    initProjectHandles,
    LoadedProject, parseAssetsJSONManifest,
    parsePackageJsonSettings,
    ProjectConfigSettings, ProjectConfigSettingsJSON,
    resolveFile,
    SavedSceneFile,
    SavedSceneFileMeta,
    SavedSceneFileMetaStored,
    settingsKey,
    STORE_NAME
} from "./project.ts";
import {
    defaultIconTemplatePng,
    defaultIconTemplateSvg,
    mainJsTemplate,
    packageJsonTemplate
} from './projectTemplates.ts'
import {getDirHandle, getFileHandle} from "./fsApi.ts";
import {FetchProxy} from "./FetchProxy.ts";
import {refreshTexturePreview, staticData} from "../components/BPTextureFileComponent.tsx";
import {refreshQueryState} from "./projectActions.tsx";
import {AssetTracker, cloneAssetItem, defSPropsMat, defSPropsObj} from "./AssetTracker.ts";
import {CannonPhysicsPlugin} from "../plugins/cannon/CannonPhysicsPlugin.ts";
import {CanvasFileDropHandler} from "./CanvasFileDropHandler.ts";
import {FileTracker} from "./FileTracker.ts";
import {HtmlUiComponent} from "../plugins/HtmlUiComponent.ts";

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

export const assetableFileTypes = ['.glb', '.mat', '.json'] // we can write asset ids into these files.
export const notAssetableFileTypes = ['.scene.glb']

export async function queryHandlePerm(handle: FileSystemDirectoryHandle) {
    let perm = await handle.queryPermission({mode: 'readwrite'})
    if (perm !== 'granted') {
        perm = await handle.requestPermission({mode: 'readwrite'})
    }
    if (perm !== 'granted') {
        // return {
        //     error: 'no permission to write to the file system, cannot save file'
        // }
        throw new Error('No permission to access the project files')
    }
    return true
}

export function isLoadableFile(file: string) {
    let loadable = true
    // const loadableFiles = ['.mat', '.glb']
    const loadableFiles = [...assetableFileTypes]
    loadableFiles.push(...['.png', '.jpeg', '.jpg', '.gif', '.webp', '.bmp', '.tga', '.tiff', '.hdr', '.ktx', '.dds'])
    if (!loadableFiles.some(ext => file.endsWith(ext))) loadable = false

    // const notLoadableFiles = ['.scene.glb']
    if (notAssetableFileTypes.some(ext => file.endsWith(ext))) loadable = false
    return loadable;
}

export class ViewerInstanceManager extends EventDispatcher<{
    loadedNeedsSaveChange: {},
    extPluginsChange: {},
    extScriptsChange: {},
    extraPluginsChange: {},
    loadedProjectFileChange: {},
    editPreviewChange: {},
    runModePauseChange: {},
    // assetRegistryChange: {},
}>{
    private _viewers = new Map<string, ThreeViewer>()
    features = new EditorFeatures(this)
    fileTracker = new FileTracker()

    static {
    }
    constructor() {
        super()
        FetchProxy.Setup(assetUrlPrefix)
        FetchProxy.Set(this.fetchProjectAsset)
        // todo only use broadcast channel if fsobserver is not available
        this.broadcastChannel.onmessage = this.receiveBroadcastMessage
        this.broadcastChannel.onmessageerror = (e)=>{
            console.error('Broadcast message error', e)
        }
        this.initFsObserver()
    }

    private receiveBroadcastMessage = (e: { data: BroadcastDataTypes[keyof BroadcastDataTypes] & {type: keyof BroadcastDataTypes, editorId: string} })=>{
        if(!this.loadedProject) return
        console.log('Broadcast message received', e)
        if(e.data.type === 'file-change'){
            const data = e.data as BroadcastDataTypes['file-change'] & {editorId: string, type: 'file-change'}
            if(data.project === this.loadedProject.path){
                const url = data.project + data.path
                this.fileTracker.updateFile(url, data.file)
                const ex = this.fileTracker.getFile(url)

                if(this.editorId !== data.editorId){
                    // todo use the File object from data instead of reading again from disk
                    this._changedFilesQ.push(data.path)
                }
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
            msaa: false,
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

        const tracker = new AssetTracker(viewer)
        tracker.isEditor = true
        viewer.assetManager.tracker = tracker
        tracker.addEventListener('replaceItem', this._trackerReplaceItem)

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

        ])
        viewer.getPlugin(PickingPlugin)!.widgetEnabled = false
        viewer.getPlugin(EditorViewWidgetPlugin)!.enabled = false

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
            const w = await this.writeFile(init.base, filename, file, meta.path, true).catch(e=>{
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
                    await this._writeFileHandle(iconFileHandle, d).catch(e=>{
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
            const w = await this.writeFile(init.base, 'main.js', file, meta.path, true).catch(e=>{
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
            const w = await this.writeFile(init.base, 'assets.json', file, meta.path, true).catch(e=>{
                console.error('ThreeEditor - cannot write default assets.json file', e)
                return false
            })
            // if(!w) throw new Error('No assets.json file in project and cannot create one')
            if(w) init.assetsJson.file = file
        }
        if(!init.assetsJson.file) {
            // throw new Error('No assets.json file in project and cannot create one')
            console.error('No assets.json file in project and cannot create one')
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

    private async setSettingsConfig(settings: ProjectConfigSettings, project: LoadedProject){
        if(!project.handle) throw new Error('No handle to update project config')
        const handle = project.handle
        let packageFileHandle = await handle.getFileHandle(project.file.name).catch((e) => {
            // todo handle if there is dir with same name
            // if(e.name === "NotFoundError") return null
            // if(e.name === "TypeMismatchError") return true
            // console.error(e)
            return undefined
        })
        if(!packageFileHandle) throw new Error('No packageFileHandle to update project config')
        let packageJsonFile = await packageFileHandle.getFile()
        const text = await packageJsonFile.text()

        // let errors = []
        // const json = parse(text, errors, { allowTrailingComma: true })
        //
        // if (errors.length) {
        //     console.error('ThreeEditor - cannot parse JSONC', errors)
        //     throw new Error(`Cannot read ${project.file.name} file`)
        // }
        //
        // // Prepare edits — jsonc-parser gives minimal text edits preserving comments
        // const edits = jsonc.modify(
        //     text,                  // original JSONC text
        //     [settingsKey],         // JSON path (can be nested like ['compilerOptions', 'target'])
        //     settings,              // new value
        //     { formattingOptions: { insertSpaces: true, tabSize: 2 } }
        // )

        let json: Record<string, any> = {}
        try {
            json = parse(text) as any
        }catch (e){
            console.error(`ThreeEditor - cannot read ${project.file.name} file`, e)
            throw new Error(`Cannot read ${project.file.name} file`)
        }
        const settings2 = {...settings} as ProjectConfigSettingsJSON
        // @ts-ignore todo make this proper config->json
        if(settings2.dependencies) delete settings2.dependencies
        settings2.imports = json[settingsKey]?.imports || {}
        json = {
            ...json,
            [settingsKey]: settings2
        }
        const newFile = new File(
            [JSON.stringify(json, null, 2)],
            project.file.name,
            {type: 'application/json', lastModified: Date.now()}
        )
        return newFile
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
        const saved = await this.writeFile(project.handle, fileName, newFile, project.path).catch(e => {
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

        if(this.isRunningMode){
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

        if(this.isRunningMode){
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

    // todo channel is never closed
    broadcastChannel = new BroadcastChannel(settingsKey + '-threepipe-editor')
    broadcastMessage<T extends keyof BroadcastDataTypes = keyof BroadcastDataTypes>(type: T, data: BroadcastDataTypes[T]){
        const b = {...data, type, editorId: this.editorId}
        this.receiveBroadcastMessage({data: b})
        this.broadcastChannel.postMessage(b)
    }

    async writeFile(base: FileSystemDirectoryHandle, path: string, file: File, project: string, create = true, handle?: FileSystemFileHandle){
        handle = handle || (await getFileHandle(base, path, create))?.fileHandle
        if(!handle){
            return false
        }
        await this._writeFileHandle(handle, file)
        if(path.startsWith('.')) return true
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
    private async _writeFileHandle(fileHandle: FileSystemFileHandle, file: FileSystemWriteChunkType){
        const writer = await fileHandle.createWritable()
        await writer.write(file)
        await writer.close()
    }


    async writeAssetFile(project: string, obj: IObject3D|IMaterial, assetId: string, handle: FileSystemDirectoryHandle, assetPath: string, res: {file: File, preview?: string | File}) {
        const res1 = await this.writeFile(handle, assetPath, res.file, project).catch(e => {
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

    fetchProjectAsset = async (url: string, project?: LoadedProject|null) => {
        if(!url.startsWith(assetUrlPrefix)) return url
        const url1 = url.slice(assetUrlPrefix.length)
        project = project ?? this.loadedProject
        if(!project){
            console.error('No project loaded, cannot import asset')
            return url
        }

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

            // const imports: Record<string, string> = config.imports ?? {}
            // dependencies.push(...Object.entries(imports).map(([k, url])=>({
            //     key: k,
            //     url: url,
            //     version: ''
            // })))
            // ImportMapsManager.addDependency(...dependencies)
            this.loadedProject = meta

            await this.loadProjectExtScript({import: "threepipe"})
            // todo promise?
            await this.onProjectSettingsChange(config, null)
        }else {
            v = this.reset(props)
            this.loadedProject = meta
            // console.time('settings load')
            await this.loadProjectExtScript({import: "threepipe"})
            // todo promise?
            await this.onProjectSettingsChange(emptyProjectSettings, null)
            // console.timeEnd('settings load')
        }
        return v
    }

    async setSettings(settings: ProjectConfigSettings, save = true){
        const project = this.loadedProject
        if(!project?.settings || !project.handle) throw new Error('No project loaded, cannot set settings')
        if(!isPackageProject(project)) throw new Error('Not a package project, cannot set settings')
        const current = project.settings.config
        if(JSON.stringify(current) === JSON.stringify(settings)) return // no change

        project.settings.config = settings

        if(save) {
            // patches the latest file from disk
            const file = await this.setSettingsConfig(settings, project)
            const saved = await this.writeFile(project.handle, project.file.name, file, project.path).catch(e => {
                console.error(e)
                return false
            })
            if (!saved) {
                throw new Error('Failed to save project settings file')
            }
        }

        await this.onProjectSettingsChange(settings, current)
    }
    async onProjectSettingsChange(settings: ProjectConfigSettings, lastSettings: ProjectConfigSettings|null){
        const vprops1 = lastSettings?.viewer || {}
        const vprops2 = settings.viewer || {}
        const sortedJsonStringify = (key: any)=>JSON.stringify(key, (_, v) =>
            v.constructor === Object ? Object.entries(v).sort() : v
        )
        if(sortedJsonStringify(vprops1) !== vprops2){
            // todo change props/show toast to reload viewer
            // this.reset({...this.getProps(), ...vprops2})
        }

        const deps1 = lastSettings?.dependencies || []
        const deps2 = settings.dependencies || []
        const addedDeps = []
        const removedDeps = []
        const changedDeps = []

        for (const d of deps2) {
            const d1 = deps1.find(d1=>d1.key === d.key)
            if(!d1){
                addedDeps.push(d)
            }else if(d1.version !== d.version || d1.url !== d.url){
                changedDeps.push(d)
            }
        }
        for (const d of deps1) {
            if(!deps2.find(d2=>d2.key === d.key)){
                removedDeps.push(d)
            }
        }
        if(addedDeps.length > 0 || removedDeps.length > 0 || changedDeps.length > 0) {
            if(removedDeps.length > 0) {
                // ImportMapsManager.removeDependency(...removedDeps.map(d=>d.key))
                // cant remove, add it back
                deps2.push(...removedDeps)
            }
            if(addedDeps.length > 0 || changedDeps.length > 0) {
                const imports = [...addedDeps, ...changedDeps]
                console.log('Registering Imports:', imports)
                ImportMapsManager.addDependency(...imports)
            }
            if(removedDeps.length || changedDeps.length){
                // todo show toast to reload page/project
            }
            // notify import maps change
            // this.dispatchEvent({type: 'importMapsChange'})
        }

        // todo if imports change, prompt to reload
        const plugins1 = lastSettings?.plugins || []
        const plugins2  = settings.plugins || []
        // const addedPlugins = []
        const removedPlugins = []

        // for (const p of plugins2) {
        //     if(!plugins1.find(p1=>comparePlugins(p1, p))){
        //         addedPlugins.push(p)
        //     }
        // }
        for (const p of plugins1) {
            if(!plugins2.find(p2=>comparePlugins(p2, p))){
                removedPlugins.push(p)
            }
        }

        const scripts1 = lastSettings?.scripts || []
        const scripts2  = settings.scripts || []
        // const addedScripts = []
        const removedScripts = []

        // for (const s of scripts2) {
        //     if(!scripts1.find(s1=>comparePlugins(s1, s))){
        //         addedScripts.push(s)
        //     }
        // }
        for (const s of scripts1) {
            if(!scripts2.find(s2=>s2.import === s.import)){
                removedScripts.push(s)
            }
        }

        // reloading all plugins, components (they wont be reloaded if not changed)
        const plugins = [...plugins2, ...removedPlugins.map(p=>({...p, active: false}))]
        const scripts = [...scripts2, ...removedScripts.map(p=>({...p, active: false}))]
        if(plugins.length > 0 || scripts.length > 0) {
            this._pluginsRefreshing = new Promise<void>(async (res)=>{
                const mods = await this.loadProjectPlugins(plugins, false)
                const mods2 = await this.loadProjectExtScripts(scripts, false)
                const modules = new Set([...mods, ...mods2])
                for (const module of modules) {
                    await this.refLoadModule(module)
                }
                res()
            })
            await this._pluginsRefreshing
            this._pluginsRefreshing = undefined
        }
    }

    private _pluginsRefreshing: Promise<any>|undefined

    async addProjectPlugin(plugin: ExternalPlugin){
        const settings = this.loadedProject?.settings?.config
        if(!settings) throw new Error('No project loaded, cannot add plugin')
        const existing = settings.plugins?.find(p=>comparePlugins(p, plugin))
        if(existing) throw new Error('Plugin already exists in project settings')
        await this.setSettings({
            ...settings,
            plugins: [...settings.plugins||[], plugin]
        })
    }
    async removeProjectPlugin(plugin: ExternalPlugin){
        const settings = this.loadedProject?.settings?.config
        if(!settings) throw new Error('No project loaded, cannot remove plugin')
        const existing = settings.plugins?.find(p=>comparePlugins(p, plugin))
        if(!existing) return
        await this.setSettings({
            ...settings,
            plugins: settings.plugins?.filter(p=>p!==existing)
        })
    }

    async addProjectScript(script: ExternalScript, ignoreIfExists = false){
        const settings = this.loadedProject?.settings?.config
        if(!settings) throw new Error('No project loaded, cannot add script')
        const existing = settings.scripts?.find(p=>p.import === script.import)
        if(existing) {
            if(!ignoreIfExists) throw new Error('Script already exists in project settings')
            return
        }
        await this.setSettings({
            ...settings,
            scripts: [...settings.scripts||[], script]
        })
    }
    async removeProjectScript(script: ExternalScript){
        const settings = this.loadedProject?.settings?.config
        if(!settings) throw new Error('No project loaded, cannot remove script')
        const existing = settings.scripts?.find(p=>p.import === script.import)
        if(!existing) return
        await this.setSettings({
            ...settings,
            scripts: settings.scripts?.filter(p=>p!==existing)
        })
    }

    // pluginsLoading = false
    extPlugins: ExternalPlugin[] = [] // todo make public readonly
    extScripts: ExternalScript[] = [] // todo make public readonly
    _extPluginsAdd(p: ExternalPlugin){
        if(!this.extPlugins.includes(p)){
            this.extPlugins.push(p)
            this.dispatchEvent({type: 'extPluginsChange'})
        }
    }
    _extPluginsRemove(p: ExternalPlugin|number){
        const i = typeof p === 'number' ? p : this.extPlugins.indexOf(p)
        if(i >= 0 && i < this.extPlugins.length){
            this.extPlugins.splice(i, 1)
            this.dispatchEvent({type: 'extPluginsChange'})
        }
    }

    _extScriptsAdd(p: ExternalScript){
        if(!this.extScripts.includes(p)){
            this.extScripts.push(p)
            this.dispatchEvent({type: 'extScriptsChange'})
        }
    }
    _extScriptsRemove(p: ExternalScript|number){
        const i = typeof p === 'number' ? p : this.extScripts.indexOf(p)
        if(i >= 0 && i < this.extScripts.length){
            this.extScripts.splice(i, 1)
            this.dispatchEvent({type: 'extScriptsChange'})
        }
    }

    findExtPlugin(className: string|undefined, importPath: string){
        const ps = this.extPlugins.filter(p=>p.import === importPath)
        if(ps.length === 1){
            const p = ps[0]
            if(!p.className || p.className === className || className === 'default') return p
        }else if(ps.length > 1){
            const p = ps.find(p=>p.className === className || (!p.className && className === 'default'))
            if(p) return p
        }
        return null
    }

    findExtScript(importPath: string){
        const ps = this.extScripts.filter(p=>p.import === importPath)
        if(ps.length === 1){
            return ps[0]
        }
        if(ps.length > 1) {
            console.error('Multiple scripts with same import path found', ps)
        }else {
            console.warn('Script not found', importPath)
        }
        return null
    }

    addedViewerPlugins: IViewerPlugin[] = []
    async addPlugin(p: PluginRef){
        const v = this.get()
        const pt = p.exp.PluginType
        if(!pt){
            console.error('Plugin does not have a PluginType static property', p.exp)
            return false
        }
        if(v.getPlugin(pt)){
            // plugin already added
            return false
        }
        // console.log('Adding plugin', pt, p.def.params || [])
        const plugin = await v.addPlugin(p.exp, ...p.def.params || [])
        this.addedViewerPlugins.push(plugin)
        // v.getPlugin(BlueprintJsUiPlugin2)?.setupPluginUi(plugin)
        return true
    }
    async removePlugin(p: PluginRef){
        const v = this.get()
        const plugin = v.getPlugin(p.exp)
        if(plugin) {
            const i = this.addedViewerPlugins.indexOf(plugin)
            if(i >= 0) {
                this.addedViewerPlugins.splice(i, 1)
                // console.log('Removing plugin', p.exp)
                // v.getPlugin(BlueprintJsUiPlugin2)?.removePluginUi(plugin)
                await v.removePlugin(plugin)
            }else {
                // it could be a default plugin added by editor
            }
            return true
        }
        return false
    }

    addedComponents: ComponentRef['exp'][] = []
    async addComponent(p: ComponentRef){
        const v = this.get()
        const pt = p.exp.ComponentType
        if(!pt){
            console.error('Component does not have a ComponentType static property', p.exp)
            return false
        }
        const plugin = v.getPlugin(EntityComponentPlugin)!
        if(plugin.hasComponentType(pt)){
            // plugin already added
            return false
        }
        console.log('Adding Component', pt)
        const res = await plugin.addComponentType(p.exp)
        if(res) this.addedComponents.push(p.exp)
        return true
    }
    async removeComponent(p: ComponentRef){
        const v = this.get()
        const plugin = v.getPlugin(EntityComponentPlugin)!
        const exists = plugin.hasComponentType(p.exp.ComponentType)
        if(exists) {
            const i = this.addedComponents.indexOf(p.exp)
            if(i >= 0) {
                this.addedComponents.splice(i, 1)
                console.log('Removing component', p.exp.ComponentType)
                // v.getComponent(BlueprintJsUiComponent2)?.removeComponentUi(plugin)
                // await v.removeComponent(plugin)
                await plugin.removeComponentType(p.exp)
            }else {
                // it could be a default plugin added by editor
            }
            return true
        }
        return false
    }

    // for this.loadedProject
    // async loadProjectPlugin2(plugin: ExternalPlugin){
    //     const path = plugin.import
    //
    //     const scriptModules = [...this.scriptModules.values()]
    //     const module0 = scriptModules.find(m=>m.plugins.find(p=>comparePlugins(p, plugin)))
    //     if(module0) {
    //         if(plugin.active === false){
    //             const lastPluginI = module0.plugins.findIndex(p=>comparePlugins(p, plugin))
    //             const lastPlugin = module0.plugins[lastPluginI]
    //             this.pluginsLoading = true
    //             // remove plugin
    //             const res = await this.removePlugin(lastPlugin).catch(e=>{
    //                 console.error('Error unloading module for plugin: ', path, e)
    //                 return false
    //             })
    //             if(res) {
    //                 if(module0.plugins.length === 1 || lastPluginI < 0)
    //                     this.scriptModules.delete(path)
    //                 else {
    //                     module0.plugins.splice(lastPluginI, 1)
    //                 }
    //             }
    //             this.pluginsLoading = false
    //         }else {
    //             // Plugin already loaded
    //         }
    //         return
    //     }
    //     if(plugin.active === false) {
    //         return
    //     }
    //     this.pluginsLoading = true
    //     try {
    //         const module1 = this.scriptModules.get(path)
    //         if(module1) {
    //             let mod
    //             if(typeof (module1.module as Promise<SupPluginModule>).then === 'function'){
    //                 mod = await module1.module
    //             }else mod = module1.module as SupPluginModule
    //             const res = await this.addPlugin(plugin, mod).catch(e=>{
    //                 console.error('Error loading module for plugin: ', path, e)
    //                 return null
    //             })
    //             if(res) {
    //                 // todo setup ui config
    //                 module1.plugins.push(plugin)
    //             }else {
    //                 // todo failed to load
    //             }
    //         }else {
    //             const pms = loadModule(path)
    //             const mod = {plugins: [plugin], module: pms as SupPluginModule|Promise<SupPluginModule>}
    //             this.scriptModules.set(path, mod)
    //             // todo test
    //             // const path1 = path.match(/^[a-z]+:\/\//) ? path : await this.fetchProjectAsset('asset://'+path)
    //             // const module: SupPluginModule = await import(/* @vite-ignore */ path1)
    //             // const module = await ImportMapsManager.dynamicImport(path)
    //             const module = await pms
    //             if (!module) {
    //                 throw new Error('Failed to import plugin: ' + path)
    //             }
    //             mod.module = module
    //             const res = await this.addPlugin(plugin, module).catch(e => {
    //                 console.error('Error loading module for plugin: ', path, e)
    //                 return null
    //             })
    //             if (res) {
    //                 // this.scriptModules.set(path, {module, plugins: [plugin]})
    //             } else {
    //                 // todo failed to load
    //                 if(mod.plugins.length === 1 && mod.plugins[0] === plugin)
    //                    this.scriptModules.delete(path)
    //                 else {
    //                     const i = mod.plugins.indexOf(plugin)
    //                     if(i >= 0) mod.plugins.splice(i, 1)
    //                 }
    //             }
    //         }
    //     }catch (e) {
    //         console.error('Error loading plugin: ', path, e)
    //     }
    //     this.pluginsLoading = false
    // }

    async loadProjectPlugin(plugin: ExternalPlugin, refLoad = true){
        const path = plugin.import
        const existing = this.extPlugins.findIndex(e=>comparePlugins(e, plugin))
        const lastPlugin = existing >=0 ? this.extPlugins[existing] : null

        const mod = lastPlugin ? [...this.scriptModules.values()].find(m=>m.plugins.find(p=>p.def===lastPlugin)) : null
        if(mod && lastPlugin) {
            if(plugin.active === false){
                // this.pluginsLoading = true
                const ref = mod.plugins.find(p=>p.def === lastPlugin)
                if(ref) await this.refRemovePlugin(mod.plugins, ref, path);
                this._extPluginsRemove(existing)
                // this.pluginsLoading = false
            }
            return
        }
        if(plugin.active === false) {
            if(existing >= 0) {
                this._extPluginsRemove(existing)
            }
            return
        }
        if(existing >= 0) {
            // already loaded, cant update
        }else {
            this._extPluginsAdd(plugin)
            const module = await this.loadProjectScript(path, refLoad)
            if(refLoad && !this.scriptModules.get(path)?.plugins.some(r=>r.def===plugin)){
                console.warn('Unable to find/add plugin, probably a plugin with the same type already exists or the plugin belongs to a different file or package.', plugin)
            }
            return module
        }
    }

    // right now external scripts can only have components, anything else, add it here
    async loadProjectExtScript(component: ExternalScript, refLoad = true){
        const path = component.import
        const existing = this.extScripts.findIndex(e=>e.import === component.import)
        const lastScript = existing >=0 ? this.extScripts[existing] : null

        const mod = lastScript ? [...this.scriptModules.values()].find(m=>m.path === path) : null
        if(mod && lastScript) {
            if(component.active === false){
                // this.componentsLoading = true
                const refs = mod.components.filter(p=>p.def === lastScript)
                // if(ref) await this.refRemoveComponent(mod.components, ref, path);
                for (const ref of refs) {
                    await this.refRemoveComponent(mod.components, ref, path);
                }
                this._extScriptsRemove(existing)
                // this.componentsLoading = false
            }
            return
        }
        if(component.active === false) {
            if(existing >= 0) {
                this._extScriptsRemove(existing)
            }
            return
        }
        if(existing >= 0) {
            // already loaded, cant update
        }else {
            this._extScriptsAdd(component)
            const module = await this.loadProjectScript(path, refLoad)
            // if(refLoad && !this.scriptModules.get(path)?.components.some(r=>r.def===component)){
            //     console.warn('Unable to find/add component, probably a plugin with the same type already exists or the plugin belongs to a different file or package.', plugin)
            // }
            return module
        }
    }

    private async refRemovePlugin(refs: PluginRef[], plugin: PluginRef, path: string) {
        // remove plugin
        if (plugin) {
            const res = await this.removePlugin(plugin).catch(e => {
                console.error('Error unloading plugin: ', plugin, path, e)
                return false
            })
            if (res) {
                // if(refs.length === 1 && refs[0].def === lastPlugin)
                //     this.scriptModules.delete(path)
                // else {
                const i = refs.indexOf(plugin)
                if (i >= 0) refs.splice(i, 1)
                // }
            }else {
                console.error('Failed to unload plugin: ', path)
            }
        }
    }
    private async refRemoveComponent(refs: ComponentRef[], component: ComponentRef, path: string) {
        // remove component
        if (component) {
            const res = await this.removeComponent(component).catch(e => {
                console.error('Error unloading component: ', component, path)
                console.error(e)
                return false
            })
            if (res) {
                // if(refs.length === 1 && refs[0].def === lastComponent)
                //     this.scriptModules.delete(path)
                // else {
                const i = refs.indexOf(component)
                if (i >= 0) refs.splice(i, 1)
                // }
            }else {
                console.error('Failed to unload component: ', path)
            }
        }
    }

    extraViewerPlugins: Record<string, PluginRef> = {}
    async refLoadModule(mod: ScriptModule){
        // this.pluginsLoading = true
        const {module, plugins, path, components} = mod
        const newRefs: PluginRef[] = []
        const newComp: ComponentRef[] = []
        Object.entries(module).forEach(([key, exp])=>{
            if((exp as PluginRef['exp']).PluginType){
                const pluginCons = exp as PluginRef['exp']
                const e = this.findExtPlugin(key, path)
                if (e && !plugins.find(r => r.def === e) && !newRefs.find(r => r.def === e)) {
                    // if(this.extraViewerPlugins.includes(pluginCons)){
                    //     this.extraViewerPlugins = this.extraViewerPlugins.filter(p=>p!==pluginCons)
                    //     this.dispatchEvent({type: 'extraPluginsChange'})
                    // }
                    if(this.extraViewerPlugins[pluginCons.PluginType]?.def !== e) {
                        this.extraViewerPlugins[pluginCons.PluginType] = {
                            exp: pluginCons,
                            def: e,
                        }
                        this.dispatchEvent({type: 'extraPluginsChange'})
                    }
                    newRefs.push({
                        exp: pluginCons,
                        def: e,
                    })
                }else {
                    const ignored = ['AssetManager', 'AViewerPlugin']
                    // if(!ignored.includes(pluginCons.PluginType) && !this.extraViewerPlugins.includes(pluginCons)){
                    //     this.extraViewerPlugins.push(pluginCons)
                    //     this.dispatchEvent({type: 'extraPluginsChange'})
                    // }
                    if(!ignored.includes(pluginCons.PluginType) && this.extraViewerPlugins[pluginCons.PluginType]?.def !== e) {
                        this.extraViewerPlugins[pluginCons.PluginType] = {
                            exp: pluginCons,
                            def: {
                                import: path,
                                className: key,
                                params: [],
                            },
                        }
                        this.dispatchEvent({type: 'extraPluginsChange'})
                    }
                }
            }
            if((exp as ComponentRef['exp']).ComponentType){
                const componentCons = exp as ComponentRef['exp']
                const e = this.findExtScript(path)
                if(e && !components.find(r=>r.def === e) && !newComp.find(r=>r.def === e)) {
                    newComp.push({
                        exp: componentCons,
                        def: e,
                    })
                }
            }
        })
        plugins.push(...newRefs)
        components.push(...newComp)

        const pluginsPms = newRefs.map(async (p)=>{
            const res = await this.addPlugin(p).catch(e => {
                console.error('Error adding plugin to the viewer: ', p, path, e)
                return null
            })
            if (res) {
                // refs.push(p)
                // this.scriptModules.set(path, {module, plugins: [plugin]})
            } else {
                // todo failed to load
                // if(refs.length === 1 && refs[0] === p)
                //     this.scriptModules.delete(path)
                // else {
                const i = plugins.indexOf(p)
                if(i >= 0) plugins.splice(i, 1)
                // }
            }
            return res || false
        })

        const componentsPms = newComp.map(async (c)=>{
            const res = await this.addComponent(c).catch(e => {
                console.error('Error adding component to the viewer: ', c, path, e)
                return null
            })
            if (res) {
                // refs.push(p)
                // this.scriptModules.set(path, {module, plugins: [plugin]})
            } else {
                // todo failed to load
                // if(refs.length === 1 && refs[0] === p)
                //     this.scriptModules.delete(path)
                // else {
                const i = components.indexOf(c)
                if(i >= 0) components.splice(i, 1)
                // }
            }
            return res || false
        })

        const r = await Promise.allSettled([...pluginsPms, ...componentsPms])
        // this.pluginsLoading = false
        return r
    }

    _readScript = async (path: string)=>{
        if(!this.loadedProject) throw new Error('No project loaded, cannot load script')
        const file = await resolveFile(path, this.loadedProject.path, this.loadedProject.handle)
        if(!file || typeof file === 'string') throw new Error('Failed to load script: ' + path)
        const text = await (file as File).text()
        return text
    }

    fsObserver: any | undefined

    // @ts-ignore
    fsObserverCallback = (records, observer, ...rest)=>{
        // console.log('fs observer', records, observer, rest)

        for (const record of records) {
            console.log("Change detected:", record);
            // const reportContent = `Change observed to ${record.changedHandle.kind} ${record.changedHandle.name}. Type: ${record.type}.`;
            // sendReport(reportContent); // Some kind of user-defined reporting function
            this._changedFilesQ.push(record.changedHandle)
        }
        // if(paths.length > 0){
        // this.scriptFilesChanged(paths).catch(e=>{
        //     console.error('Error handling changed plugin scripts: ', paths, e)
        // })
        // }
        // this._changedFilesQ.push(...paths)

    }
    async initFsObserver(){
        // @ts-ignore
        this.fsObserver = window.FileSystemObserver ? new window.FileSystemObserver(this.fsObserverCallback) : undefined;
        while (this.fsObserver){
            await new Promise(res=>setTimeout(res, 2000))
            await this.refreshChangedFilesQ()
        }
    }

    private _changedFilesQ: (FileSystemDirectoryHandle|FileSystemFileHandle|string)[] = []
    private _refreshingChangedFiles: Promise<void>|null = null
    async refreshChangedFilesQ(){
        if(this._changedFilesQ.length === 0) return
        if(!this.loadedProject?.handle || !this.loadedProject?.settings) return
        const project = this.loadedProject

        if(this._refreshingChangedFiles){
            await this._refreshingChangedFiles
        }

        const hh = this._changedFilesQ
        this._changedFilesQ = []
        const processed = new Set<FileSystemDirectoryHandle|FileSystemFileHandle|string>()
        const paths = new Set<string>()
        let handles = [...this.observedFiles.keys()]
        for (const changedHandle of hh) {
            if(processed.has(changedHandle)) continue
            processed.add(changedHandle)
            if(typeof changedHandle === 'string') {
                paths.add(changedHandle)
                continue
            }
            let handle
            for (const handle1 of handles) {
                if(await handle1.isSameEntry(changedHandle)){
                    handle = handle1
                    break
                }
            }
            const path = handle ? this.observedFiles.get(handle) : null
            if(path) paths.add(path)
        }

        const pms = (async ()=>{
            // todo
            //  file could be
            //     package.json - done
            //     asset manifest
            //     current loaded scene/asset/file
            //     any loaded embedded assets
            //     loaded script file - done
            //     what else?

            for (const path of paths) {
                if(path === 'package.json'){
                    const file: File = await resolveFile(path, project.path, project.handle)
                    const project2 = await parsePackageJsonSettings(file, project)
                    project.file = project2.file
                    project.lastModified = project2.lastModified
                    project.handle = project2.handle
                    if(project.settings && project2.settings) {
                        project.settings.json = project2.settings.json
                        project.settings.mainScene = project2.settings.mainScene
                        if (JSON.stringify(project2.settings.config) !== JSON.stringify(project.settings.config)) {
                            await this.setSettings(project2.settings.config, false)
                        }
                    }
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

            await this.scriptFilesChanged(paths)
        })().catch(e=>{
            console.error('Error handling changed plugin scripts: ', paths, e)
        })
        this._refreshingChangedFiles = pms
        await this._refreshingChangedFiles
        if(this._refreshingChangedFiles === pms) this._refreshingChangedFiles = null
    }

    // todo clear on close project
    observedFiles = new Map<FileSystemFileHandle|FileSystemDirectoryHandle, string>() // map to path
    async observeProjectFile(path: string){
        if(!this.loadedProject?.handle){
            // throw new Error('No project loaded, cannot observe plugin script')
            console.error('No project loaded, cannot observe plugin script: ', path)
            return
        }
        if([...this.observedFiles.values()].includes(path)) return // already observed
        const handles = await getFileHandle(this.loadedProject.handle, path, false)
        if(!handles.fileHandle || !handles.dirHandle){
            // throw new Error('No such plugin script file: ' + path)
            console.error('No such plugin script file: ' + path)
            return
        }
        try {
            // const perm = await handles.fileHandle.queryPermission({ mode: 'readwrite' });
            // if (perm !== 'granted') {
            //     const newPerm = await handles.fileHandle.requestPermission({ mode: 'readwrite' });
            //     if (newPerm !== 'granted') {
            //         console.warn('User denied permission.');
            //         return;
            //     }
            // }
            this.fsObserver?.observe(handles.fileHandle, {recursive: false})
        }catch (e) {
            console.warn(e)
        }
        this.observedFiles.set(handles.fileHandle, path)
    }

    async loadProjectScript(path: string, refLoad = true): Promise<ScriptModule>{
        // todo
        //  path can be local project path - ./src/file.js, src/file.js
        //  path can be package name - threepipe, @threepipe/plugin-xyz
        //  or an absolute url to a js file
        //  or an absolute url to a tgz file
        // this.pluginsLoading = true
        let mod: ScriptModule | undefined
        try {
            mod = this.scriptModules.get(path)
            if(mod) {
                // let module
                // if(typeof (mod.module as Promise<SupPluginModule>).then === 'function'){
                //     module = await mod.module
                // }else module = mod.module as SupPluginModule
                await mod.module

                // already loaded

            }else {
                console.log('Loading project script: ', path)
                if(path.startsWith('./') || path.startsWith('.././'))
                    await this.observeProjectFile(path).catch(e=>{
                        console.error('Error observing project script file: ', path, e)

                    })
                mod = {
                    plugins: [],
                    components: [],
                    module: null as any,
                    path,
                }
                this.scriptModules.set(path, mod)
                mod.module = loadModule(path, this._readScript).then(async module => {
                    if (!module) {
                        throw new Error('Failed to import module: ' + path)
                    }
                    if (mod) {
                        mod.module = module
                    }
                    return module
                })

                const module = await mod.module

                // const path1 = path.match(/^[a-z]+:\/\//) ? path : await this.fetchProjectAsset('asset://'+path)
                // const module: SupPluginModule = await import(/* @vite-ignore */ path1)
                // const module = await ImportMapsManager.dynamicImport(path)
            }
        }catch (e) {
            console.error('Error loading module: ', path, e)
            // this.pluginsLoading = false
            throw e
        }
        // this.pluginsLoading = false

        if(refLoad) await this.refLoadModule(mod)

        return mod
    }

    async scriptFilesChanged(paths: string[]|Set<string>){
        console.log('[Files Changed]', paths)
        const ps: string[] = getFileChanged(paths)
        if(ps.length === 0) return
        // this.pluginsLoading = true
        // unload modules
        const ps2 = []
        const mods = []
        // const modulePlugins = new Map<string, PluginRef[]>()
        for (const p of ps) {
            const mod = this.scriptModules.get(p)
            if(mod?.module) {
                // let module3
                // if(typeof (mod.module as Promise<SupPluginModule>).then === 'function'){
                //     module3 = await mod.module
                // }else module3 = mod.module as SupPluginModule
                await mod.module

                // await viewer.getPlugin(SandboxPlugin)!.unloadPlugin(p).catch(e=>{
                //     console.error('Error unloading module for plugin: ', p, e)
                // })
                // const p2: PluginRef[] = []
                // todo what if plugins/components are being added, need another promise for refLoad...
                for (const plugin of [...mod.plugins]) {
                    await this.refRemovePlugin(mod.plugins, plugin, p);
                }
                for (const component of [...mod.components]) {
                    await this.refRemoveComponent(mod.components, component, p);
                }
                // modulePlugins.set(p, p2)
            }
            if(mod) {
                ps2.push(p)
                mods.push(mod)
            }
        }
        try {
            // load modules again
            const pms = loadModules(ps2, this._readScript)
            // modules1 = await loadModules(ps2)
            const pp = []
            for (let i = 0; i < ps2.length; i++){
                const path = ps2[i];
                const mod = mods[i]
                const pms2 = pms.then(p=>p[i])
                // const plugins = modulePlugins.get(path) || []
                mod.module = pms2.then(async (module)=>{
                    if(!module.__tpModuleError) {
                        mod.module = module
                    }else {
                        // error in module, keep the last loaded module and show error to user
                    }
                    return mod.module
                })

                // mod.plugins.push(...plugins)
                pp.push(mod.module.then(async ()=>{
                    await this.refLoadModule(mod)
                }))
            }
            await Promise.allSettled(pp)
        }catch (e) {
            console.error('Error reloading changed script modules: ', ps2, e)
            // this.pluginsLoading = false
            return
        }
        // this.pluginsLoading = false
    }

    // for this.loadedProject
    async loadProjectPlugins(plugins: ExternalPlugin[], refLoad = true){
        if(!plugins || plugins.length === 0) return []
        let modules = new Set<ScriptModule>()
        // todo parallel?
        for (const id of plugins) {
            const module = await this.loadProjectPlugin(id, false)
            if(module) modules.add(module)
        }
        if(refLoad){
            for (const module of modules) {
                await this.refLoadModule(module)
            }
        }
        return modules
    }
    async loadProjectExtScripts(components: ExternalScript[], refLoad = true){
        if(!components || components.length === 0) return []
        let modules = new Set<ScriptModule>()
        // todo parallel?
        for (const id of components) {
            const module = await this.loadProjectExtScript(id, false)
            if(module) modules.add(module)
        }
        if(refLoad){
            for (const module of modules) {
                await this.refLoadModule(module)
            }
        }
        return modules
    }

    // for this.loadedProject
    scriptModules: Map<string, ScriptModule> = new Map()

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

    // todo make public readonly
    isRunningMode = false

    _loadedNeedsSave = false
    get loadedNeedsSave() {
        if(this.isRunningMode) return false
        return this._loadedNeedsSave
    }
    set loadedNeedsSave(v) {
        if(this.isRunningMode) return
        if(this._loadedNeedsSave === v) return
        this._loadedNeedsSave = v
        this.dispatchEvent({type: 'loadedNeedsSaveChange'})
    }

    // this will refresh file in the asset registry, i.e load it again.
    private async loadImport(file: SavedSceneFile | {path: string, file?: File}, project: LoadedProject, isMain = false) {
        const sceneFile: File | undefined = file.file ??
            (file === project ?
            await resolveFile(project.file, project.path, project.handle) :
            await resolveFile(file.path, project.path, project.handle))
        await this._pluginsRefreshing
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

        const previewRefresh = async ()=>{
            if(!project.handle) return
            const previewPath = thumbPath(file.path)
            // check if file exists
            // const exists = !!(await getFileHandle(project.handle, previewPath, false)).fileHandle
            // if(exists) return

            let prev
            const viewer = this.get()
            if(res.isTexture) {
                prev = await new Promise<string>(async (resolve) => {
                    const preview = refreshTexturePreview(res as ITexture, viewer, (p) => {
                        if (preview === staticData.loadingImage) resolve(p)
                    })
                    if (preview !== staticData.loadingImage) resolve(preview)
                })
            }else if(res.isMaterial){
                const gen = new MaterialPreviewGenerator()
                await viewer.doOnce('preFrame')
                viewer.setDirty()
                prev = gen.generate(res as IMaterial, viewer.renderManager.renderer)
                gen.dispose()
            }else if(res.isObject3D){
                let root
                const channel = 7
                // console.log(res, res.parent)
                if(res.parent){ // todo this should not be the case actually
                    // check if in scene
                    // root = viewer.scene
                    // viewer.scene.children.push(res)
                }else{
                    root = new Scene()
                    // todo why is so big intensity req?
                    const hemisphericLight = new HemisphereLight(0xffffff, 0x444444, 4)
                    hemisphericLight.layers.set(channel)
                    hemisphericLight.position.set(0, 10, 0)
                    root.add(hemisphericLight)
                    root.add(res as IObject3D)
                    console.log(root)
                }
                // viewer.setDirty()
                // await viewer.doOnce('preFrame')
                // todo use a render target in snapObject
                // prev = snapObject(viewer.renderManager.renderer, res as IObject3D, root, channel, new Vector3(1,1,1).multiplyScalar(1.25))

                if(root && root !== viewer.scene){
                    root.remove(res as IObject3D)
                    root.children.forEach((c: any)=>c.dispose && c.dispose())
                    ;(root as any).dispose && (root as any).dispose()
                }

            }

            if(prev) {
                const blob = await (await fetch(prev)).blob()
                const f = new File([blob], previewPath, {type: blob.type, lastModified: Date.now()})
                await this.writeFile(project.handle, previewPath, f, project.path).catch(e => {
                    console.error('Error writing texture preview: ', previewPath, e)
                    return false
                })
            }
        }
        previewRefresh() // not awaiting

        if(res.isTexture){
            const t = res as ITexture
            // todo srgb?
        }

        // todo if asset id/hash is not set in res, create it and set needs save

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

    async changeMaterialForObject(object: IObject3D, material: IMaterial, _selected: SelectedInspectorItem|SelectFileRef|null, project?: LoadedProject|null){
        const isSingle = !Array.isArray(object.material)
        const materialI = isSingle ? -1 : Array.isArray(object.material) ? object.material.indexOf(material) : -1
        const isMultiple = !isSingle && materialI >= 0
        if(!isSingle && !isMultiple){
            console.warn('Material changed but material not found on object?', {material, object, materialI})
            return {
                error: 'Unknown Error changing material on object.'
            }
        }
        let selected = null
        // todo set material
        if(!_selected){
            const picking = this.get().getPlugin(PickingPlugin)!
            // set null
            if(isMultiple){
                // remove this material
                const mats = [...(object.material as IMaterial[])]
                mats.splice(materialI, 1)
                if(mats.length === 0) {
                    selected = picking.getPlaceholderMaterial(object)
                }
                else selected = mats
            }else {
                selected = picking.getPlaceholderMaterial(object)
            }
        }
        else if((_selected as IMaterial).isMaterial){
            // set material directly?
            selected = _selected as IMaterial
        }
        else if((_selected as SelectFileRef).entry?.isFSEntry){
            if(!project){
                // console.error('No project loaded, cannot import material from file', _selected)
                return {
                    error: 'No project loaded, cannot import material from file.'
                }
            }
            // load and set material
            const clone = await this.loadAssetMaterialClone((_selected as SelectFileRef).entry, project)
            if(!clone) return {
                error: 'Failed to load material from file.'
            }
            // not that not setting _tpAssetId to the asset here
            selected = clone
        }

        if(selected){
            // if(object._tpRootPath) selected._tpRootPath = object._tpRootPath // not really required here

            // if(object._tpAssetId) selected._tpAssetId = object._tpAssetId
            const action = ()=>{
                let mats = object.material
                if(isSingle || Array.isArray(selected)){
                    mats = selected
                } else if(isMultiple && Array.isArray(mats)){
                    mats = [...mats]
                    mats[materialI] = selected
                }
                object.material = mats
            }


            const undoMan = this.get().getPlugin(UndoManagerPlugin)
            if(!undoMan){
                console.error('UndoManagerPlugin not found.')
                action()
            }
            else{
                undoMan.performAction(undefined, ()=>{
                    let current = object.material
                    action()
                    return ()=>{
                        object.material = current
                    }
                }, [], 'Change Material on Object',)
            }
        }
    }

    // for unique run mode
    editorId = generateUUID()
    _runningSceneFile: File|null = null

    isEditorPreviewing = false

    async startEditPreview(){
        this.features.disable('widgets', 'EditPreview')
        this.features.disable('transform-controls', 'EditPreview')
        // this.features.disable('picking', 'EditPreview')
        this.features.disable('edit-mode', 'EditPreview')
        this.isEditorPreviewing = true
        this.dispatchEvent({type: 'editPreviewChange'})
    }
    async stopEditPreview(){
        this.features.enable('widgets', 'EditPreview')
        this.features.enable('transform-controls', 'EditPreview')
        // this.features.enable('picking', 'EditPreview')
        this.features.enable('edit-mode', 'EditPreview')
        this.isEditorPreviewing = false
        this.dispatchEvent({type: 'editPreviewChange'})
    }

    async startRunMode(){
        // check if scene is loaded
        // save current scene to running.glb
        // load running.glb in play mode
        // set loadedNeedsSave = false
        if(!this.loadedScene) return false
        if(!this.loadedProjectFile) return false

        if(this.isRunningMode){
            if(this.isPausedRunning){
                this.unpauseRunMode(true)
                return true
            }
            return true
        }

        const project = this.loadedProject
        const isPackage = isPackageProject(project)
        if(!project || (isPackage && !project.handle)) return false

        await this.startEditPreview()

        let load

        if(isPackage) {
            const filePath = `.${settingsKey}/running/${this.editorId}.scene.glb` // todo delete file after run mode closed?

            try {
                const v = this.get()
                const gltfMeta = v.scene.modelRoot.userData.gltfExtras?.resourcePath
                if (gltfMeta) delete v.scene.modelRoot.userData.gltfExtras.resourcePath

                const picking = v.getPlugin(PickingPlugin)
                const selected = picking?.getSelectedObject()?.uuid

                const res = await this.exportScene('running', false, 'gltf')
                if (!res.file) {
                    // todo
                    throw new Error('Failed to export scene for run mode: ' + (res.error || 'Unknown error'))
                }

                const text = await (res.file as File).text()
                const gltfJson = JSON.parse(text)
                console.log('[Running Scene GLTF]', gltfJson)

                if(v.scene.modelRoot.userData.gltfExtras)
                    v.scene.modelRoot.userData.gltfExtras.resourcePath = gltfMeta

                this._runningSceneFile = res.file

                // todo async write file and delete on stop (handle user stopping before write complete)
                // const saved = await this.writeFile(project.handle, filePath, this._runningSceneFile, project.path).catch(e => {
                //     console.error(e)
                //     return false
                // })
                // if (!saved) {
                //     // return {error: 'Failed to save scene file.'}
                //     throw new Error('Failed to save scene file for run mode')
                // }

                this.unloadScene() // todo why do we need to unload and load the same thing again?
                load = async ()=>{
                    await this.loadImport({
                        file: res.file, path: filePath,
                    }, project, true).catch(e => {
                        return {error: e.message}
                    })
                    if(picking && selected){
                        const obj = v.object3dManager.getObject(selected)
                        if(obj) picking.setSelectedObject(obj)
                    }
                }
            } catch (e) {
                await this.stopEditPreview()
                throw e
            }
        }

        console.clear && console.clear()
        this.isRunningMode = true
        this.features.enable('physics', 'PlayingMode')
        this.get().timeline.reset()

        if(load) await load()

        this.get().timeline.start()
        this.get().getPlugin(EntityComponentPlugin)!.start()
        return true
    }

    isPausedRunning = false

    async pauseRunMode(){
        if(this.isPausedRunning) return
        this.isPausedRunning = true
        this.get().timeline.stop()
        this.dispatchEvent({type: 'runModePauseChange'})
    }
    async unpauseRunMode(startTime = true){
        if(!this.isPausedRunning) return
        this.isPausedRunning = false
        if(startTime) this.get().timeline.start()
        this.dispatchEvent({type: 'runModePauseChange'})
    }

    async stopRunMode(){
        if(!this.isRunningMode) return false
        this.isRunningMode = false

        await this.unpauseRunMode(false)

        const project = this.loadedProject
        const isPackage = isPackageProject(project)
        if(!project || (isPackage && !project.handle)) return false

        if(!this.loadedProjectFile || !this.loadedScene) return

        const v = this.get()
        const picking = v.getPlugin(PickingPlugin)
        const selected = picking?.getSelectedObject()?.uuid

        v.getPlugin(EntityComponentPlugin)!.stop()

        if(isPackage) {
            this.unloadScene()
        }

        this.features.disable('physics', 'PlayingMode')

        await this.stopEditPreview()

        v.timeline.stop()
        v.timeline.reset()

        if(isPackage) {
            const filePath = `.${settingsKey}/running/${this.editorId}.scene.glb` // todo delete file after run mode closed?

            let tempFile = this._runningSceneFile
            if (!tempFile) {
                // try to load from disk
                const file = await resolveFile(filePath, project.path, project.handle)
                if (file) tempFile = file as File
            }
            if (!tempFile) {
                console.error('No running scene file found, cannot reload scene.')
                return
            }
            // todo delete tempFile

            const res2 = await this.loadImport({
                file: tempFile, path: filePath,
            }, project, true).catch(e => {
                return {error: e.message}
            })

            if (picking && selected) {
                const obj = v.object3dManager.getObject(selected)
                if (obj) picking.setSelectedObject(obj)
            }
        }

    }

    // todo expose for scripts
    async loadRunningScene(path: string){
        if(!this.isRunningMode || !this.loadedProject || !isPackageProject(this.loadedProject)) return

        this.get().timeline.stop()
        this.get().timeline.reset()
        this.get().getPlugin(EntityComponentPlugin)!.stop()
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

        this.get().timeline.start()
        this.get().getPlugin(EntityComponentPlugin)!.start()
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

        refreshQueryState({project: unloadingProject ? null : project?.path||null, file: file?.path??null})

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

        if(scene) {
            const res = await this.exportScene(scene ? 'scene' : 'asset', true)
            if (!res.file) return res
            const filePath = scene
            const backupFilePath = backupPath(scene)
            const previewFilePath = thumbPath(scene)

            let handles = await getFileHandle(handle, filePath, false)
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
            // @ts-ignore
            project.lastScene = scene || undefined // todo use this when loading project
            await this.browserStore.put(project, project.path + FILE_META_KEY)

            this.loadedNeedsSave = false
            return {error: null}
        }
        if(this.loadedAssetObj){
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

    async getAssetFromPath(path: string): Promise<((IObject3D | IMaterial) & ImportResultExtras) | null>{
        // path = path.replace(assetUrlPrefix, '')
        const reg = this.get()?.assetManager.tracker.getFromRegistry(path, {
            // processRaw: true,
            // cacheAsset: false,
        })
        if(reg?.object) return reg.object as any
        return (reg?.pms || null) as any
    }

    async getAssetFromEntry(entry: FileManifestEntry|{path: string, isFSEntry: false}): Promise<((IObject3D | IMaterial) & ImportResultExtras) | null>{
        if(!entry.isFSEntry) return this.getAssetFromPath(entry.path)
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

    async getAssetIdFromPath(path: string): Promise<string|null> {
        // todo
        //  import asset from path
        //  get asset id from object
        //  if 404, return null
        console.error('getAssetIdFromPath not implemented yet')
        return null
    }

}
export interface PluginRef{
    exp: (Class<IViewerPlugin> & IViewerPlugin['constructor'])
    def: ExternalPlugin
}

export interface ComponentRef{
    exp: /*(Class<Object3DComponent> & Object3DComponent['constructor'])*/ TObject3DComponent
    def: ExternalScript
}

export function comparePlugins(a: ExternalPlugin, b: ExternalPlugin){
    if(a === b) return true
    if(a.import === b.import){
        if(a.className === b.className) return true
        if(!a.className || !b.className) return true
        return false
    }
    return false
}
export type SelObjectType = 'object' | 'material' | 'texture' | 'geometry' | 'unknown' | 'none' | 'plugin'

export interface SelectFileRef{
    uuid: string
    name: string
    // path: string
    type: SelObjectType|'image'|'script'|[TypedClass]
    entry: FileManifestEntry
    userData?: Record<string, any>

    // _isViewerPlugin: true

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

function useSetupProject() {
    const [project, setProject] = useState<SavedSceneFile|null>(null)
    // const [file, setFile] = useState<SavedSceneFile|null>(null)
    // const [scene, setScene] = useState<null | string>(null)
    const [path, setPath] = useState<null | string>(null)
    const [welcomeOpen, setWelcomeOpen] = useState(true)

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
        // projectFile: file, setPFile: setFile,
        path, setPath,
        // scene, setScene,
        welcomeOpen, setWelcomeOpen: (v: any)=>{
            // console.warn('welcome open', v)
            setWelcomeOpen(v)
        },
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
        && !obj.userData.sProperties // already an instance of an asset
        && !obj.userData.rootPath
        // && !obj._tpAssetId
        && !obj._tpRootPath
        // && !obj.userData.tpAssetId
        && !(obj as IObject3D).isScene
        && !(obj as IObject3D)._sChildren
        // todo
        && !(obj as IObject3D).material && !(obj as IObject3D).geometry
        // && !((obj as IObject3D).isObject3D ?
        //         iObjectCommons.getMapsForObject3D.call(obj as IObject3D) :
        //         iMaterialCommons.getMapsForMaterial.call(obj as IMaterial)
        // ).size
}

export const canSaveAsset = (obj: IObject3D|IMaterial)=>{
    return ((obj as IObject3D).isObject3D || (obj as IMaterial).isMaterial)
        // && obj._isTpAsset
        // && obj.userData.tpAssetId
        && obj.userData.rootPath && obj.userData.rootPath.startsWith(assetUrlPrefix+'@')
        // && obj._tpAssetId
}

export function useMakeAsset(){
    const {project} = useProject()
    const manager = useManager()
    const [isMaking, setIsMaking] = useState(false)

    const makeAsset = async (data: { obj: IObject3D|IMaterial })=>{
        if(!project || !manager.loadedProjectFile) return false
        if(isMaking) return
        setIsMaking(true)

        const res = await manager.saveNewProjectAsset(project, manager.loadedProjectFile, data.obj)
        setIsMaking(false)
        // @ts-ignore
        const r = showSuccessErrorToast(res.path ? `Created ${project.path}${res.path} successfully` : 'Unknown Error', 'Unable to create asset', res)
        return (res as any).result ?? null

    }
    return {makeAsset}
}

export function logAsset(data: any, obj: IObject3D|IMaterial|ITexture|IGeometry){
    console.log(obj, data)
}

export function isPackageProject(meta?: SavedSceneFile|SavedSceneFileMeta|SavedSceneFileMetaStored|null){
    return meta && (meta.file as string === 'package.json' || (meta.file as any as File)?.name === 'package.json')
}

export function isExternalObject(obj: IObject3D){
    let external = false
    let obj1 = obj
    while(obj1 && !external){
        if(obj1.parent){
            if(obj1.parent.isScene) break
            if(obj1.parent._sChildren){
                if(!obj1.parent._sChildren.includes(obj1)){
                    external = true
                    break
                }
            }
            obj1 = obj1.parent
        } else {
            // not external but not part of the scene
            // external = true
            break
        }
    }
    return external
}

export function isExternalMaterial(mat: IMaterial){
    const meshes = Array.from(mat.appliedMeshes)
    for (const mesh of meshes) {
        // todo check sproperties
        if(!isExternalObject(mesh)) return false
    }
    return true
}

export function isExternalGeometry(mat: IGeometry){
    const meshes = Array.from(mat.appliedMeshes)
    for (const mesh of meshes) {
        // todo check sproperties
        if(isExternalObject(mesh)) return true
    }
    return false
}

export function isExternalTexture(tex: ITexture){
    const mats = Array.from(tex.appliedObjects||[])
    for (const mat of mats) {
        if((mat as IMaterial).isMaterial ? isExternalMaterial(mat as IMaterial) : isExternalObject(mat as IObject3D)) return true
    }
}

export function isMatEditable(obj: IMaterial, manager: ViewerInstanceManager){
    return obj
        // && !obj.userData.tpAssetId  // not an asset itself
        && (!obj.userData.rootPath || !obj.userData.rootPath.startsWith(assetUrlPrefix))  // not an asset itself
        // && (!obj._tpAssetId || obj._tpAssetId === manager.loadedAssetId) // part of an asset, but not the current loaded asset
        // && (!obj._tpRootPath /*|| !obj._tpRootUid*/) // part of an asset, but not the current loaded asset
        && !obj.userData.isPlaceholder
}
export function isGeomEditable(obj: IGeometry, manager: ViewerInstanceManager){
    return obj
        // && !obj.userData.tpAssetId  // not an asset itself
        && (!obj.userData.rootPath || !obj.userData.rootPath.startsWith(assetUrlPrefix))  // not an asset itself
        // && (!obj._tpAssetId || obj._tpAssetId === manager.loadedAssetId) // part of an asset, but not the current loaded asset
        // && (!obj._tpRootPath /*|| !obj._tpRootUid*/) // part of an asset, but not the current loaded asset
        && !obj.userData.isPlaceholder
}
export function isTexEditable(obj: ITexture, manager: ViewerInstanceManager){
    return obj
        // && !obj.userData.tpAssetId  // not an asset itself
        && (!obj.userData.rootPath || !obj.userData.rootPath.startsWith(assetUrlPrefix))  // not an asset itself
        && (!obj._tpRootPath /*|| !obj._tpRootUid*/) // part of an asset, but not the current loaded asset
        && !obj.userData.isPlaceholder
}


type ScriptModule ={
    plugins: PluginRef[],
    module: SupPluginModule|Promise<SupPluginModule>,
    path: string,
    components: ComponentRef[],
}

export function thumbPath(path: string){
    return `.${settingsKey}/thumbs/${path}.png`
}
export function backupPath(path: string){
    return `.${settingsKey}/backups/${path}`
}

declare module 'threepipe'{
    interface AssetManager{
        tracker: AssetTracker
    }
}

const emptyProjectSettings = {
    plugins: [
        {
            "import": "threepipe",
            "className": "SSAAPlugin"
        },
        {
            "import": "threepipe",
            "className": "AssetExporterPlugin"
        },
        {
            "import": "threepipe",
            "className": "TransformAnimationPlugin"
        },
        {
            "import": "threepipe",
            "className": "DepthBufferPlugin"
        },
        {
            "import": "threepipe",
            "className": "NormalBufferPlugin"
        },
        {
            "import": "threepipe",
            "className": "FullScreenPlugin"
        },
        {
            "import": "threepipe",
            "className": "ObjectConstraintsPlugin"
        },
        {
            "import": "threepipe",
            "className": "TransformControlsPlugin"
        },
        {
            "import": "threepipe",
            "className": "AssetExporterPlugin"
        },
        {
            "import": "threepipe",
            "className": "ClearcoatTintPlugin"
        },
        {
            "import": "threepipe",
            "className": "FragmentClippingExtensionPlugin"
        },
        {
            "import": "threepipe",
            "className": "NoiseBumpMaterialPlugin"
        },
        {
            "import": "threepipe",
            "className": "CustomBumpMapPlugin"
        },
        {
            "import": "threepipe",
            "className": "ParallaxMappingPlugin",
            "params": [
                false
            ]
        },
        {
            "import": "threepipe",
            "className": "GLTFKHRMaterialVariantsPlugin"
        },
        {
            "import": "threepipe",
            "className": "VirtualCamerasPlugin"
        },
        {
            "import": "threepipe",
            "className": "RenderTargetPreviewPlugin",
            "params": [
                false
            ]
        },
        {
            "import": "threepipe",
            "className": "HDRiGroundPlugin",
            "params": [
                false,
                true
            ]
        },
        {
            "import": "threepipe",
            "className": "VignettePlugin",
            "params": [
                false
            ]
        },
        {
            "import": "threepipe",
            "className": "ChromaticAberrationPlugin",
            "params": [
                false
            ]
        },
        {
            "import": "threepipe",
            "className": "FilmicGrainPlugin",
            "params": [
                false
            ]
        },
        {
            "import": "threepipe",
            "className": "SSAOPlugin",
            "params": [
                1009,
                1
            ]
        },
        {
            "import": "threepipe",
            "className": "ContactShadowGroundPlugin"
        },
        {
            "import": "threepipe",
            "className": "DeviceOrientationControlsPlugin"
        },
        {
            "import": "threepipe",
            "className": "PointerLockControlsPlugin"
        },
        {
            "import": "threepipe",
            "className": "ThreeFirstPersonControlsPlugin"
        },
        {
            "import": "threepipe",
            "className": "MeshOptSimplifyModifierPlugin",
            "params": [
                false
            ]
        },
        {
            "import": "@threepipe/webgi-plugins",
            "className": "AnisotropyPlugin",
        },
        {
            "import": "@threepipe/webgi-plugins",
            "className": "BloomPlugin",
        },
        {
            "import": "@threepipe/webgi-plugins",
            "className": "SSReflectionPlugin",
        },
        {
            "import": "@threepipe/webgi-plugins",
            "className": "TemporalAAPlugin",
        },
        {
            "import": "@threepipe/webgi-plugins",
            "className": "VelocityBufferPlugin",
            params: [1009, false],
        },
        {
            "import": "@threepipe/webgi-plugins",
            "className": "DepthOfFieldPlugin",
            params: [false],
        },
        {
            "import": "@threepipe/webgi-plugins",
            "className": "SSContactShadowsPlugin",
            params: [false],
        },
        {
            "import": "@threepipe/webgi-plugins",
            "className": "OutlinePlugin",
            params: [false],
        },
        {
            "import": "@threepipe/webgi-plugins",
            "className": "SSGIPlugin",
            params: [undefined, 1, false],
        },
        // GLTFDracoExportPlugin, GLTFSpecGlossinessConverterPlugin
        {
            "import": "@threepipe/plugin-gltf-transform",
            "className": "GLTFDracoExportPlugin",
        },
        {
            "import": "@threepipe/plugin-gltf-transform",
            "className": "GLTFSpecGlossinessConverterPlugin",
        },
        // MaterialConfiguratorPlugin, SwitchNodePlugin
        {
            "import": "@threepipe/plugin-configurator",
            "className": "MaterialConfiguratorPlugin",
        },
        {
            "import": "@threepipe/plugin-configurator",
            "className": "SwitchNodePlugin",
        },
        ...['B3DMLoadPlugin', 'CMPTLoadPlugin', 'DeepZoomImageLoadPlugin', 'EnvironmentControlsPlugin', 'GlobeControlsPlugin', 'I3DMLoadPlugin', 'PNTSLoadPlugin', 'TilesRendererPlugin'].map(className=>({
            import: '@threepipe/plugin-3d-tiles-renderer',
            className,
        })),
        {
            import: '@threepipe/plugin-assimpjs',
            className: 'AssimpJsPlugin',
            params: [false],
        },
        {
            import: '@threepipe/plugin-path-tracing',
            className: 'ThreeGpuPathTracerPlugin',
            params: [false],
        },
        {
            import: '@threepipe/plugin-blend-importer',
            className: 'BlendLoadPlugin',
        },
        {
            import: '@threepipe/plugin-network',
            className: 'TransfrSharePlugin',
        },
        {
            import: '@threepipe/plugin-troika-text',
            className: 'TroikaTextPlugin',
        },
        ...[
            'TDSLoadPlugin',
            'ThreeMFLoadPlugin',
            'ColladaLoadPlugin',
            'AMFLoadPlugin',
            'GCodeLoadPlugin',
            'BVHLoadPlugin',
            'VOXLoadPlugin',
            'MDDLoadPlugin',
            'PCDLoadPlugin',
            'TiltLoadPlugin',
            'VRMLLoadPlugin',
            'LDrawLoadPlugin',
            'VTKLoadPlugin',
            'XYZLoadPlugin',
        ].map(className=>({
            import: '@threepipe/plugins-extra-importers',
            className,
        })),
    ],
    dependencies: [{
        key: '@threepipe/webgi-plugins',
        version: '0.6.1',
    }, {
        key: '@threepipe/plugin-gltf-transform',
        version: 'latest',
    },{
        key: '@threepipe/plugin-configurator',
        version: 'latest',
    },{
        key: '@threepipe/plugin-3d-tiles-renderer',
        version: 'latest',
    },{
        key: '@threepipe/plugin-assimpjs',
        version: 'latest',
    },{
        key: '@threepipe/plugin-path-tracing',
        version: 'latest',
    },{
        key: '@threepipe/plugin-blend-importer',
        version: 'latest',
    },{
        key: '@threepipe/plugin-network',
        version: 'latest',
    },{
        key: '@threepipe/plugin-troika-text',
        version: 'latest',
    },{
        key: '@threepipe/plugins-extra-importers',
        version: 'latest',
    }],
    scripts: [],
    viewer: {},
} as ProjectConfigSettings
