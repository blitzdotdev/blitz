import {
    ImportResultExtras,
    ITexture,
    makeTextSvg,
    Texture,
    ThreeViewer,
    WebGLCubeRenderTarget,
    WebGLRenderTarget
} from "threepipe";
import {BPFileComponent, BPFileComponentState} from 'uiconfig-blueprint/lib/esm/lib'
import {Spinner} from "@blueprintjs/core";
import {CSSProperties} from "react";
import {assetUrlPrefix} from "../utils/project.ts";
import {refreshTexturePreview, TextureType} from "../utils/three/refreshTexturePreview.ts";

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
