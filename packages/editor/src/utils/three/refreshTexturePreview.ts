import {
    generateUUID,
    imageBitmapToBase64,
    ImportResultExtras,
    ITexture,
    makeTextSvg,
    textureToDataUrl,
    ThreeViewer
} from "threepipe";

export type TextureType = ITexture&ImportResultExtras

// copied for now, todo refactor
// https://github.com/repalash/threepipe/blob/fd88dc852f39e8744ed51427b38dd84490d848de/plugins/tweakpane/src/tpImageInputGenerator.ts#L25
export const staticData = {
    placeholderVal: 'placeholder',
    renderTarImage: makeTextSvg('Render Target'),
    loadingImage: '...',
    dataTexImage: makeTextSvg('Data Texture'),
    lutCubeTexImage: makeTextSvg('CUBE Texture'),
    compressedTexImage: makeTextSvg('Compressed Texture'),
    textureMap: {} as Record<string, TextureType>,
    imageMap: {} as Record<string, string>,
    tempMap: {} as Record<string, string>,
}

export function refreshTexturePreview(cc: TextureType | null | undefined, viewer: ThreeViewer, refresh?: (preview: string) => void) {
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
                        if (!cc._target) return
                        // here we are not doing cc.image.tp_src because cc.image can be shared across multiple textures in MRT
                        const dataUrl = viewer.renderManager.renderTargetToDataUrl(cc._target, undefined, undefined, cc._target.textures.indexOf(cc))
                        cc.tp_src = dataUrl
                        setTimeout(() => cc.tp_src && delete cc.tp_src, 1000) // clear after 1 second so it refreshes on next render

                        refresh && refresh(dataUrl)
                    }, 100)
                    cc.tp_src = staticData.loadingImage
                    // }
                    // config._lastRtRefresh = Date.now()
                }
            } else if (cc.image instanceof ImageBitmap || cc.image instanceof HTMLImageElement /* || cc.image instanceof HTMLVideoElement*/) { // todo: try video with bitmap after ts-browser-helpers update
                const image = cc.image as typeof cc.image & {tp_src?: string}
                image.tp_src = imageBitmapToBase64(cc.image, 160)
                if (cc.image instanceof HTMLVideoElement) {
                    setTimeout(() => cc.image.tp_src && delete cc.image.tp_src, 1000) // clear after 1 second so it refreshes on next render
                }
            } else {
                cc.image.tp_src = textureToDataUrl(cc, 160, false, 'image/png', 90) // this supports DataTexture also
                if (cc.image instanceof HTMLVideoElement) {
                    setTimeout(() => cc.image.tp_src && delete cc.image.tp_src, 1000) // clear after 1 second so it refreshes on next render
                }
            }

            if (!cc.image.tp_src && !cc.tp_src) {
                if (cc.isRenderTargetTexture) cc.image.tp_src = staticData.renderTarImage
                else if (cc.isDataTexture) cc.image.tp_src = staticData.dataTexImage
            }
        }
        if (cc.image) {
            const uid = cc.image.tp_src_uuid as string
            const cachedPreview = uid ? staticData.imageMap[uid] : undefined
            ret = cachedPreview || cc.image.tp_src || cc.image.src
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
            const cachedPreview = uid ? staticData.imageMap[uid] : undefined
            ret = cachedPreview || image.tp_src || image.src
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
