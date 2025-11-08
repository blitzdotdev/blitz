import {
    generateUUID,
    imageBitmapToBase64,
    ImportResultExtras,
    ITexture,
    makeTextSvg,
    Texture,
    textureToDataUrl,
    ThreeViewer,
    WebGLCubeRenderTarget,
    WebGLRenderTarget
} from "threepipe";
import {BPFileComponent, BPFileComponentState} from 'uiconfig-blueprint/lib/esm/lib'
import {Spinner} from "@blueprintjs/core";
import {CSSProperties} from "react";
import {assetUrlPrefix} from "../utils/project.ts";

type TextureType = ITexture&ImportResultExtras

// @ts-expect-error required for BPValueComponent so that it doesn't clone it. todo check others as well like object3d etc
Texture.prototype._ui_isPrimitive = true
// @ts-expect-error
WebGLRenderTarget.prototype._ui_isPrimitive = true
// @ts-expect-error
WebGLCubeRenderTarget.prototype._ui_isPrimitive = true

type BPTextureFileComponentProps = {
    fileLoader: ThreeViewer
}

export class BPTextureFileComponent<T extends TextureType = TextureType, TP = {}> extends BPFileComponent<T, BPTextureFileComponentProps & TP, ITexture> {
    // todo types
    constructor(props: any, context: any) {
        super(props, context);
    }

    convertValueToState(val: T | null, state: BPFileComponentState<ITexture>): BPFileComponentState<ITexture> {
        let mode: BPFileComponentState['mode'] = state.mode
        let value = state.value
        let preview = state.preview
        const hasPicker = !!(this.context.AssetPicker || this.props.AssetPicker)
        if (val) {
            if(val.uuid && hasPicker){
                // value = 'texture://' + val.uuid
                value = val
                mode = 'asset'
            }
            else if (val.userData) {
                if (val.userData.__sourceBlob) {
                    value = val.userData.__sourceBlob as File
                    mode = 'file'
                } else if (val.userData.rootPath?.length) {
                    value = val.userData.rootPath
                    mode = 'url'
                }
            }
            // doing uiConfig refresh from here because its possible the component isn't mounted yet
            preview = refreshTexturePreview(val, this.context.fileLoader as ThreeViewer, ()=>this.props.config.uiRefresh?.(false, 'postFrame')) as any
        }else {
            // if(hasPicker) mode = 'asset'
            preview = undefined
        }
        return {...state, mode, value, preview}
    }

    async convertStateToValue(state: BPFileComponentState): Promise<T | null> {
        const value = state.value
        if(typeof value === 'string' && value?.startsWith('texture://')){
            const uuid = value.substring('texture://'.length)
            const viewer = this.context.fileLoader as ThreeViewer
            if(viewer){
                const tex = viewer.object3dManager.getTextures().find(t=>t.uuid === uuid)
                if(tex) return tex as any
                else {
                    console.error('BPTextureFileComponent: texture with uuid not found in scene:', uuid)
                    return null
                }
            }else {
                console.error('BPTextureFileComponent: Viewer not mounted yet')
                return null
            }
        }
        // this is not req anymore, since we are loading tex in RefSelectionObjectComponentTex
        if(typeof value === 'string' && value?.startsWith(assetUrlPrefix)){
            const path = value.substring(assetUrlPrefix.length)
            const viewer = this.context.fileLoader as ThreeViewer
            if(viewer){
                // todo load texture and clone it. also set asset id/file id
                // const tex = viewer.object3dManager.getTextures().find(t=>t.uuid === uuid)
                // const tex = viewer.object3dManager.getTextures().find(t=>t.uuid === uuid)
                // if(tex) return tex as any
                // else {
                //     console.error('BPTextureFileComponent: texture with uuid not found in scene:', uuid)
                //     return null
                // }
            }else {
                console.error('BPTextureFileComponent: Viewer not mounted yet')
                return null
            }
        }
        return super.convertStateToValue(state);
    }

    refreshPreview = (url?: string)=> {
        const preview = url || refreshTexturePreview(this.context.methods.getRawValue(this.props.config), this.context.fileLoader as ThreeViewer, this.refreshPreview)
        this.setState({...this.state, preview})
    }

    renderPreviewSlot() {
        return <TexturePreview
            preview={this.state.preview as string}
            refreshPreview={this.refreshPreview}
            height={"80px"} // todo make props
            width={"max-content"}
            objectFit={"contain"}
        />
    }

}

export function TexturePreview({
    preview,
    refreshPreview,
    height = "80px",
    width = "max-content",
    objectFit = "contain"
}: {
    preview: string,
    refreshPreview: ()=>void
    height?: CSSProperties['height']
    width?: CSSProperties['width']
    objectFit?: CSSProperties['objectFit']
}){
    const ret = preview
    // todo download button, refresh button etc.
    return ret === 'placeholder' ? <></> : ret === '...' ? <div
        onClick={()=>refreshPreview()}
        style={{ width: "60%", height: height, display: "flex", alignItems: "center", justifyContent: "center" }}
    >
        <Spinner size={24} />
    </div> : <img
        onClick={()=>refreshPreview()}
        src={(ret as any)?.src ? (ret as any).src : ret}
        style={{width: width, maxWidth: "100%", maxHeight: height, objectFit: objectFit}}
    />
}

// copied for now, todo refactor
// https://github.com/repalash/threepipe/blob/fd88dc852f39e8744ed51427b38dd84490d848de/plugins/tweakpane/src/tpImageInputGenerator.ts#L25
export const staticData = {
    placeholderVal: 'placeholder',
    renderTarImage: makeTextSvg('Render Target'),
    loadingImage: '...',
    dataTexImage: makeTextSvg('Data Texture'),
    lutCubeTexImage: makeTextSvg('CUBE Texture'),
    compressedTexImage: makeTextSvg('Compressed Texture'),
    textureMap: {} as any,
    imageMap: {} as any,
    tempMap: {} as any,
}

export function refreshTexturePreview(cc: TextureType|null|undefined, viewer: ThreeViewer, refresh?: (preview: string)=>void) {
    let ret: string = staticData.placeholderVal
    if (!cc) return staticData.placeholderVal
    if (cc.isCompressedTexture && !cc.image.tp_src) {
        cc.image.tp_src = staticData.compressedTexImage
    }
    // todo: video is not playing
    // if (cc.isVideoTexture && !cc.image.tp_src) {
    //     cc.image.tp_src = dataTexImage
    // }
    if (cc.isTexture) {
        // console.warn('here')
        // todo: use textureToCanvas for data texture
        if (cc.image && !cc.image.tp_src && !cc.tp_src) {
            if (cc.isRenderTargetTexture) {
                if (cc._target) {
                    // doing in the timeout so it doesnt hang when opening a folder which does deep refresh
                    // if (!config._lastRtRefresh || Date.now() - config._lastRtRefresh > 5000) { // 5000 should be significantly more than 500 + 100 below
                    setTimeout(() => {
                        if(!cc._target) return
                        // here we are not doing cc.image.tp_src because cc.image can be shared across multiple textures in MRT
                        const dataUrl = viewer.renderManager.renderTargetToDataUrl(cc._target, undefined, undefined, cc._target.textures.indexOf(cc))
                        cc.tp_src = dataUrl
                        setTimeout(()=>cc.tp_src && delete cc.tp_src, 1000) // clear after 1 second so it refreshes on next render

                        refresh && refresh(dataUrl)
                    }, 100)
                    cc.tp_src = staticData.loadingImage
                    // }
                    // config._lastRtRefresh = Date.now()
                }
            } else if (cc.image instanceof ImageBitmap || cc.image instanceof HTMLImageElement /* || cc.image instanceof HTMLVideoElement*/) { // todo: try video with bitmap after ts-browser-helpers update
                (cc.image as any).tp_src = imageBitmapToBase64(cc.image, 160)
                if (cc.image instanceof HTMLVideoElement) {
                    setTimeout(()=>cc.image.tp_src && delete cc.image.tp_src, 1000) // clear after 1 second so it refreshes on next render
                }
            } else {
                cc.image.tp_src = textureToDataUrl(cc, 160, false, 'image/png', 90) // this supports DataTexture also
                if (cc.image instanceof HTMLVideoElement) {
                    setTimeout(()=>cc.image.tp_src && delete cc.image.tp_src, 1000) // clear after 1 second so it refreshes on next render
                }
            }

            if (!cc.image.tp_src && !cc.tp_src) {
                if (cc.isRenderTargetTexture) cc.image.tp_src = staticData.renderTarImage
                else if (cc.isDataTexture) cc.image.tp_src = staticData.dataTexImage
            }
        }
        if (cc.image) {
            const uid = cc.image.tp_src_uuid as string
            ret = uid ? staticData.imageMap[uid] : undefined
            if (!ret) ret = cc.image.tp_src || cc.image.src
        }
        if (cc.tp_src) ret = cc.tp_src
    } else if (typeof cc === 'string') {
        ret = cc
    } else if (cc.domainMin) { // for lut CUBE files.
        // ret = cc.texture
        const image = cc.texture.image
        if (image) {
            // todo this will always show placeholder, we need to snapshot data texture
            if (!image.tp_src) {
                image.tp_src = staticData.lutCubeTexImage
            }
            const uid = image.tp_src_uuid as string
            ret = uid ? staticData.imageMap[uid] : undefined
            if (!ret) ret = image.tp_src || image.src
        }
    } else if (cc) {
        console.error('unknown value', cc)
    }
    if (cc.image && !cc.image.tp_src_uuid) {
        const uuid = generateUUID()
        cc.image.tp_src_uuid = uuid
        staticData.tempMap[ret] = uuid
    }
    ret = staticData.imageMap[ret] ?? ret // Note: this will be a bottleneck if the length of src is too long.
    // if (typeof ret !== 'string' && ret && !ret.id?.length) ret.id = generateUUID()
    const id = ret!
    if (!staticData.textureMap[id]) staticData.textureMap[id] = cc
    return ret
}
