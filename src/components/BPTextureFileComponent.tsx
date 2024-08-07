import {
    generateUUID,
    imageBitmapToBase64,
    ImportResultExtras,
    ITexture,
    makeTextSvg,
    textureToDataUrl,
    ThreeViewer
} from "threepipe";
import {BPFileComponent, BPFileComponentState} from 'uiconfig-blueprint/lib/esm/lib'

type TextureType = ITexture&ImportResultExtras

export class BPTextureFileComponent<T extends TextureType = TextureType> extends BPFileComponent<T, {fileLoader: ThreeViewer}> {

    convertValueToState(val: T | null, state: BPFileComponentState): BPFileComponentState {
        let mode: BPFileComponentState['mode'] = state.mode
        let value = state.value
        let preview = state.preview
        if (val) {
            if (val.userData) {
                if (val.userData.__sourceBlob) {
                    value = val.userData.__sourceBlob as File
                    mode = 'file'
                } else if (val.userData.rootPath?.length) {
                    value = val.userData.rootPath
                    mode = 'url'
                }
            }
            preview = refreshTexturePreview(val, this.context.fileLoader as ThreeViewer) as any
        }
        return {...state, mode, value, preview}
    }

    renderPreviewSlot() {
        const ret = this.state.preview
        return ret === 'placeholder' ? <></> : <img src={(ret as any)?.src ? (ret as any).src : ret}
                    style={{width: "max-content", maxWidth: "100%", maxHeight: "80px", objectFit: "contain"}}/>
    }

}

// copied for now, todo refactor
// https://github.com/repalash/threepipe/blob/fd88dc852f39e8744ed51427b38dd84490d848de/plugins/tweakpane/src/tpImageInputGenerator.ts#L25
const staticData = {
    placeholderVal: 'placeholder',
    renderTarImage: makeTextSvg('Render Target'),
    dataTexImage: makeTextSvg('Data Texture'),
    lutCubeTexImage: makeTextSvg('CUBE Texture'),
    compressedTexImage: makeTextSvg('Compressed Texture'),
    textureMap: {} as any,
    imageMap: {} as any,
    tempMap: {} as any,
}

function refreshTexturePreview(cc: TextureType|null|undefined, viewer: ThreeViewer) {
    let ret: string | (HTMLImageElement&{id: string}) | undefined = undefined
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
        if (cc.image && !cc.image.tp_src) {
            if (cc.image instanceof ImageBitmap || cc.image instanceof HTMLImageElement || cc.image instanceof HTMLVideoElement) { // todo: support playback in video
                (cc.image as any).tp_src = imageBitmapToBase64(cc.image, 160)
            } else if (cc.isRenderTargetTexture) {
                if (cc._target) {
                    // here we are not doing cc.image.tp_src because cc.image can be shared across multiple textures in MRT
                    cc.tp_src = viewer.renderManager.renderTargetToDataUrl(cc._target as any, undefined, undefined, Array.isArray(cc._target.texture) ? cc._target.texture.indexOf(cc) : undefined)
                    // todo this will block the ui everytime
                    setTimeout(()=>cc.tp_src && delete cc.tp_src, 1000) // clear after 1 second so it refreshes on next render
                }
            } else {
                cc.image.tp_src = textureToDataUrl(cc, 160, false, 'image/png', 90) // this supports DataTexture also
            }

            if (!cc.image.tp_src && !cc.tp_src) {
                if (cc.isRenderTargetTexture) cc.image.tp_src = staticData.renderTarImage
                else if (cc.isDataTexture) cc.image.tp_src = staticData.dataTexImage
            }
        }
        if (cc.image) {
            ret = cc.image.tp_src_uuid
            ret = ret ? staticData.imageMap[ret as string] : undefined
            if (!ret) ret = cc.image.tp_src || cc.image.src
        }
        if (cc.tp_src) ret = cc.tp_src
    } else if (typeof cc === 'string') {
        ret = cc
    } else if (cc.domainMin) { // for lut CUBE files.
        ret = cc.texture
        if (cc.texture.image && !cc.texture.image.tp_src) {
            cc.texture.image.tp_src = staticData.lutCubeTexImage
        }
        if (cc.texture.image) {
            ret = cc.texture.image.tp_src_uuid
            ret = ret ? staticData.imageMap[ret as string] : undefined
            if (!ret) ret = cc.texture.image.tp_src || cc.texture.image.src
        }
    } else if (cc) {
        console.error('unknown value', cc)
    }
    if (!ret) ret = staticData.placeholderVal
    if (cc.image && !cc.image.tp_src_uuid && typeof ret === 'string') {
        const uuid = generateUUID()
        cc.image.tp_src_uuid = uuid
        staticData.tempMap[ret] = uuid
    }
    if (typeof ret === 'string')
        ret = staticData.imageMap[ret] ?? ret // Note: this will be a bottleneck if the length of src is too long.
    if (typeof ret !== 'string' && ret && !ret.id?.length) ret.id = generateUUID()
    const id = typeof ret === 'string' ? ret : ret!.id ?? ret
    if (!staticData.textureMap[id]) staticData.textureMap[id] = cc
    return ret
}
