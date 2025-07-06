import {
    AssetExporterPlugin,
    CameraViewPlugin,
    CanvasSnapshotPlugin,
    ChromaticAberrationPlugin,
    ClearcoatTintPlugin,
    ContactShadowGroundPlugin,
    CustomBumpMapPlugin,
    DepthBufferPlugin,
    DeviceOrientationControlsPlugin,
    EditorViewWidgetPlugin,
    Euler,
    FilmicGrainPlugin,
    FragmentClippingExtensionPlugin,
    FrameFadePlugin,
    FullScreenPlugin,
    GBufferPlugin,
    GLTFAnimationPlugin,
    GLTFKHRMaterialVariantsPlugin,
    GLTFMeshOptDecodePlugin,
    HalfFloatType,
    HDRiGroundPlugin,
    htmlDialogWrapper,
    KTX2LoadPlugin,
    KTXLoadPlugin,
    LoadingScreenPlugin,
    MeshOptSimplifyModifierPlugin,
    NoiseBumpMaterialPlugin,
    NormalBufferPlugin,
    Object3DGeneratorPlugin,
    Object3DWidgetsPlugin,
    ParallaxMappingPlugin,
    PickingPlugin,
    PLYLoadPlugin,
    PointerLockControlsPlugin,
    PopmotionPlugin,
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
    UnsignedByteType,
    USDZLoadPlugin,
    ViewerUiConfigPlugin,
    VignettePlugin,
    VirtualCamerasPlugin
} from 'threepipe'
import {BlueprintJsUiPlugin2} from '../UiConfigRendererBlueprint2.tsx'
import {GeometryGeneratorPlugin} from '@threepipe/plugin-geometry-generator'
import {createContext, createElement, useContext, useState} from 'react'
import {useSafeContext} from './useSafeContext.ts'
import {browserFileStore} from './BrowserFileStore.ts'
import {EditorFeatures} from './EditorFeatures.ts'
import {extraImportPlugins} from '@threepipe/plugins-extra-importers'
import {GLTFDracoExportPlugin, GLTFSpecGlossinessConverterPlugin} from '@threepipe/plugin-gltf-transform'
import {MaterialConfiguratorPlugin, SwitchNodePlugin} from '@threepipe/plugin-configurator'
import {
    AnisotropyPlugin,
    BloomPlugin,
    DepthOfFieldPlugin,
    OutlinePlugin,
    SSContactShadowsPlugin,
    SSGIPlugin,
    SSReflectionPlugin,
    TemporalAAPlugin,
    VelocityBufferPlugin,
} from '@threepipe/webgi-plugins'
import {
    B3DMLoadPlugin,
    CMPTLoadPlugin,
    DeepZoomImageLoadPlugin,
    EnvironmentControlsPlugin,
    GlobeControlsPlugin,
    I3DMLoadPlugin,
    PNTSLoadPlugin,
    TilesRendererPlugin,
} from '@threepipe/plugin-3d-tiles-renderer'
import {AssimpJsPlugin} from '@threepipe/plugin-assimpjs'
import {ThreeGpuPathTracerPlugin} from '@threepipe/plugin-path-tracing'

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

export class ViewerInstanceManager {
    private _viewers = new Map<string, ThreeViewer>()
    features = new EditorFeatures(this)

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
            ...props,
            rgbm: true,
            msaa: true,
            zPrepass: false,
            assetManager: {
                //todo
            },
            dropzone: {
                //todo
            },
            plugins: []
            // todo: add more options
        })
        viewer.canvas.style.width = '100%'
        viewer.canvas.style.height = '100%'
        viewer.addPluginSync(BlueprintJsUiPlugin2)

        viewer.addPluginsSync([
            LoadingScreenPlugin,
            AssetExporterPlugin,
            GLTFDracoExportPlugin,
            GLTFSpecGlossinessConverterPlugin,
            PopmotionPlugin,
            new ProgressivePlugin(),
            new SSAAPlugin(),
            GLTFAnimationPlugin,
            TransformAnimationPlugin,
            new GBufferPlugin(HalfFloatType, true, true, true),
            new DepthBufferPlugin(HalfFloatType, false, false),
            new NormalBufferPlugin(HalfFloatType, false),
            CameraViewPlugin,
            FullScreenPlugin,
            PickingPlugin,
            TransformControlsPlugin,
            OutlinePlugin,
            EditorViewWidgetPlugin,
            ViewerUiConfigPlugin,
            ClearcoatTintPlugin,
            FragmentClippingExtensionPlugin,
            NoiseBumpMaterialPlugin,
            CustomBumpMapPlugin,
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
            SSReflectionPlugin,
            new SSContactShadowsPlugin(false),
            new DepthOfFieldPlugin(false),
            BloomPlugin,
            AnisotropyPlugin,
            TemporalAAPlugin, new VelocityBufferPlugin(UnsignedByteType, false),
            new SSGIPlugin(undefined, 1, false),
            KTX2LoadPlugin, KTXLoadPlugin, PLYLoadPlugin, Rhino3dmLoadPlugin, STLLoadPlugin, USDZLoadPlugin,
            // BlendLoadPlugin, // todo
            Object3DGeneratorPlugin,
            GeometryGeneratorPlugin,
            Object3DWidgetsPlugin,
            // GaussianSplattingPlugin, // todo
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
            ...extraImportPlugins,
            MaterialConfiguratorPlugin,
            SwitchNodePlugin,
            // AWSClientPlugin, // todo
            // TransfrSharePlugin, // todo

            EnvironmentControlsPlugin, GlobeControlsPlugin,
            B3DMLoadPlugin, I3DMLoadPlugin, PNTSLoadPlugin, CMPTLoadPlugin,
            TilesRendererPlugin, DeepZoomImageLoadPlugin, /* SlippyMapTilesLoadPlugin,*/
            new AssimpJsPlugin(false),
            new ThreeGpuPathTracerPlugin(false),
        ])

        ThreeViewer.Dialog = htmlDialogWrapper

        KTX2LoadPlugin.SAVE_SOURCE_BLOBS = true // so that ktx files can be exported.

        // to show more details in the UI and allow to edit changes in title etc.
        const mat = viewer.getPlugin(MaterialConfiguratorPlugin)
        mat && (mat.enableEditContextMenus = true)
        const swi = viewer.getPlugin(SwitchNodePlugin)
        swi && (swi.enableEditContextMenus = true)

        // disable fading on update
        const fade = viewer.getPlugin(FrameFadePlugin)
        fade && (fade.isEditor = true)

        const taa = viewer.getPlugin(TemporalAAPlugin)
        taa && (taa.stableNoise = true)

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

        // todo remove later
        viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr')
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
            v.scene.disposeSceneModels()
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

    async saveFile(scene: SavedSceneFile, changeName: (n: string, e: string) => Promise<string | null>, props?: {
        isNewName?: boolean
        saveTempOnly?: boolean
    }): Promise<string | { error?: string, warn?: string }> {
        const meta = await this.getMeta(scene.path)
        let isNewHandle = false
        let handle = meta?.handle
        let name = scene.path.split('/').pop() || 'scene'
        let file = scene.file
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
                file = name + '.' + fileExt
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
            file: (typeof file === 'string' && file.length < 500) ?
                file :
                (ViewerInstanceManager.STORE_NAME + ':./' + fileKey),
            preview: (typeof preview === 'string' && preview.length < 500) ?
                preview :
                (ViewerInstanceManager.STORE_NAME + ':./' + previewKey),
            handle,
        }
        if (!meta1.path.endsWith('/')) meta1.path += '/'
        await this.browserStore.put(meta1, meta1.path + metaKey)
        if (file !== meta1.file) await this.browserStore.put(file, meta1.path + fileKey)
        if (preview !== meta1.preview) await this.browserStore.put(preview, meta1.path + previewKey)

        return name
    }

    async isTempFile(path: string) {
        const meta = await this.getMeta(path)
        if (!meta) return false
        return !meta.handle || typeof meta.file === 'string' && meta.file.startsWith(ViewerInstanceManager.STORE_NAME + ':')
    }

    async resolveFile(value: string | File, path = '', meta?: SavedSceneFileMetaStored | SavedSceneFileMeta) {
        if (!path.endsWith('/')) path += '/'

        let res: any = value
        if (typeof value === 'string' && value.startsWith(ViewerInstanceManager.STORE_NAME + ':')) {
            const previewPath = value.slice(ViewerInstanceManager.STORE_NAME.length + 1).replace(/^\.\//, path)
            res = await this.browserStore.get(previewPath)
        }
        if (res === value && typeof value === 'string' && meta?.handle) {
            let permission = await meta.handle.queryPermission({mode: 'readwrite'})
            if (permission !== 'granted') {
                permission = await meta.handle.requestPermission({mode: 'readwrite'})
            }
            if (permission !== 'granted') {
                console.error('no permission to access the file')
                alert('no permission to access the file' + value + path)
            } else {
                const fileHandle = await meta.handle.getFileHandle(value).catch(() => undefined)
                const file = await fileHandle?.getFile()
                if (file) res = file
            }
        }
        return res
    }

    async getMeta(path: string): Promise<SavedSceneFileMetaStored | undefined> {
        const metaKey = ViewerInstanceManager.FILE_META_KEY
        return await this.resolveFile(ViewerInstanceManager.STORE_NAME + ':./' + metaKey, path)
    }

    async getMetaWithPreview(path: string): Promise<SavedSceneFileMeta | undefined> {
        const meta = await this.getMeta(path)
        if (!meta) return
        if (meta.preview) meta.preview = await this.resolveFile(meta.preview, path, meta)
        return meta
    }

    async getFile(path: string): Promise<SavedSceneFile | undefined> {
        const meta = await this.getMetaWithPreview(path)
        if (!meta) return
        if (meta.file) meta.file = await this.resolveFile(meta.file, path, meta as any)
        return meta
    }

    async getFileFromMeta(meta: SavedSceneFileMetaStored | SavedSceneFileMeta): Promise<SavedSceneFile | undefined> {
        if (!meta) return
        if (meta.file) meta.file = await this.resolveFile(meta.file, meta.path, meta)
        if (meta.preview) meta.preview = await this.resolveFile(meta.preview, meta.path, meta)
        return meta
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

    async saveScene(name: string, changeName: (n: string, e: string) => Promise<string | null>, props: Parameters<ViewerInstanceManager['saveFile']>[2]) {
        const viewer = this.get()
        if (!viewer) {
            return {
                error: 'no viewer'
            }
        }
        const blob = await viewer?.exportScene({
            binary: true,
        })
        if (!blob) {
            return {
                error: 'failed to export scene'
            }
        }
        const file = new File([blob], 'scene.glb', {type: 'model/gltf-binary'})
        const preview = await viewer?.getScreenshotBlob({
            mimeType: 'image/jpeg',
            quality: 0.85,
        })
        const previewFile = !preview ? '' : new File([preview], 'preview.jpg', {type: 'image/jpeg'})
        return await this.saveFile({
            file, preview: previewFile,
            path: name,
            lastModified: Date.now()
        }, changeName, props)
    }

}

const ProjectContext = createContext({
    project: '', setProject: (_: string) => {
    },
    file: null as null | File, setFile: (_: null | File) => {
    }, // note this file is only for glb files saved with this editor, not any 3d file.
    path: null as null | string, setPath: (_: string | null) => {
    }
})
export const useProject = () => useContext(ProjectContext)

function useSetupProject() {
    const [project, setProject] = useState('')
    const [file, setFile] = useState<null | File>(null)
    const [path, setPath] = useState<null | string>(null)
    return {
        project, setProject,
        file, setFile,
        path, setPath
    }
}

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
    file: File | string
    lastModified: number
    preview?: File | string
    handle?: FileSystemDirectoryHandle
    // viewerConfig?: File | string | any // todo
}

export interface SavedSceneFileMetaStored {
    path: string,
    file: string
    lastModified: number
    preview?: string
    handle?: FileSystemDirectoryHandle
    // viewerConfig?: File | string | any // todo
}

export interface SavedSceneFileMeta {
    path: string,
    file: string
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

