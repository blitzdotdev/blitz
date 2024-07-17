import {
    CameraViewPlugin,
    ChromaticAberrationPlugin,
    Class,
    ClearcoatTintPlugin,
    CustomBumpMapPlugin,
    DepthBufferPlugin,
    DropzonePlugin,
    FilmicGrainPlugin,
    FragmentClippingExtensionPlugin,
    FrameFadePlugin,
    FullScreenPlugin, getOrCall,
    GLTFAnimationPlugin,
    HDRiGroundPlugin,
    IViewerPlugin,
    NoiseBumpMaterialPlugin,
    NormalBufferPlugin,
    PickingPlugin,
    ProgressivePlugin,
    RenderTargetPreviewPlugin,
    Rhino3dmLoadPlugin,
    ThreeViewer,
    TonemapPlugin,
    UiObjectConfig, ValOrArr,
    VignettePlugin,
    VirtualCamerasPlugin
} from "threepipe";
import {Button, ButtonGroup, IconName, Intent, Position, Tooltip} from "@blueprintjs/core";
import {FC} from 'react'
import {editorFeatures} from '../utils/EditorFeatures.ts'

export type EditorModes = 'interaction' | 'viewer' | 'buffers' | 'postProcess' | 'animation' | 'extras'
const pui = (v: ThreeViewer | null, c: Class<IViewerPlugin>) => {
    return () => v?.getPlugin(c)?.uiConfig || {}
}
export type EditorModesConfig = {
    label: string,
    icon: IconName,
    uiConfig?: (viewer: ThreeViewer) => UiObjectConfig|undefined,
    plugins?: ValOrArr<Class<IViewerPlugin>>,
    features: (keyof typeof editorFeatures)[]
}

export const editorModesList: Record<EditorModes, EditorModesConfig & {
}> = {
    viewer: {
        label: 'Viewer',
        icon: 'eye-open',
        uiConfig: (viewer?: ThreeViewer)=>{
            if(!viewer) return undefined
            const c = viewer.uiConfig
            c.type = 'panel' // todo not needed in latest threepipe
            return c
        },
        features: ['post-processing']
    },
    interaction: {
        label: 'Interaction',
        icon: 'hand',
        plugins: PickingPlugin,
        features: ['widgets', 'post-processing', 'transform-controls', 'picking']
    },
    postProcess: {
        label: 'Post processing',
        icon: 'style',
        plugins: [TonemapPlugin, ProgressivePlugin, FrameFadePlugin, VignettePlugin, ChromaticAberrationPlugin, FilmicGrainPlugin],
        features: ['post-processing']
    },
    animation: {
        label: 'Animation',
        icon: 'play',
        plugins: [GLTFAnimationPlugin, CameraViewPlugin],
        features: ['post-processing']
    },
    buffers: {
        label: 'Buffers',
        icon: 'grid-view',
        plugins: [DepthBufferPlugin, NormalBufferPlugin],
        features: ['post-processing']
    },
    extras: {
        label: 'Extras',
        icon: 'more',
        plugins: [VirtualCamerasPlugin, HDRiGroundPlugin, ClearcoatTintPlugin, FragmentClippingExtensionPlugin, NoiseBumpMaterialPlugin, CustomBumpMapPlugin, RenderTargetPreviewPlugin, DropzonePlugin, Rhino3dmLoadPlugin, FullScreenPlugin],
        features: ['widgets', 'post-processing', 'transform-controls', 'picking']
    },
}

// export const editorModesInspectorConfig: Record<EditorModes, (v: ThreeViewer | null) => UiObjectConfig<any, 'panel'>> = {
//     viewer: (v: ThreeViewer | null) => ({
//         type: 'panel',
//         label: 'Viewer',
//         children: [ViewerUiConfigPlugin, DropzonePlugin, FullScreenPlugin].map(p => pui(v, p))
//     }),
//     interaction: (v: ThreeViewer | null) => ({
//         type: 'panel',
//         label: 'Interaction',
//         children: [PickingPlugin, GeometryGeneratorPlugin].map(p => pui(v, p))
//     }),
//     buffers: (v: ThreeViewer | null) => ({
//         type: 'panel',
//         label: 'Buffers',
//         // children: [pui(v, DepthBufferPlugin), pui(v, NormalBufferPlugin)],
//         children: [DepthBufferPlugin, NormalBufferPlugin].map(p => pui(v, p))
//     }),
//     postProcess: (v: ThreeViewer | null) => ({
//         type: 'panel',
//         label: 'Post processing',
//         children: [TonemapPlugin, ProgressivePlugin, FrameFadePlugin, VignettePlugin, ChromaticAberrationPlugin, FilmicGrainPlugin].map(p => pui(v, p))
//     }),
//     animation: (v: ThreeViewer | null) => ({
//         type: 'panel',
//         label: 'Post processing',
//         children: [GLTFAnimationPlugin, CameraViewPlugin].map(p => pui(v, p))
//     }),
//     extras: (v: ThreeViewer | null) => ({
//         type: 'panel',
//         label: 'Extras',
//         children: [VirtualCamerasPlugin, HDRiGroundPlugin, Rhino3dmLoadPlugin, ClearcoatTintPlugin, FragmentClippingExtensionPlugin, NoiseBumpMaterialPlugin, CustomBumpMapPlugin, RenderTargetPreviewPlugin].map(p => pui(v, p))
//     }),
// }

export const editorModesInspectorConfig =
    Object.fromEntries(Object.entries(editorModesList).map(([k, v]) => [k, (viewer: ThreeViewer | null) => (
        getOrCall(v.uiConfig, viewer) ??
        (!Array.isArray(v.plugins) ? pui(viewer, v.plugins!) : {
        type: 'panel',
        label: v.label,
        children: v.plugins.map(p => pui(viewer, p))
    }))])) as Record<EditorModes, (v: ThreeViewer | null) => UiObjectConfig<any, 'panel'>>


export const EditorModesButtonGroup: FC<{ editorMode: EditorModes, setEditorMode: (mode: EditorModes) => void }> = (
    {
        editorMode,
        setEditorMode
    }) => {
    return (
        <div className="editorModesContainer">
            <ButtonGroup vertical={true} style={{height: "max-content"}}>
                {(Object.entries(editorModesList) as [EditorModes, EditorModesConfig][]).map(([k, v]) => (
                    <Tooltip
                        content={v.label}
                        key={k}
                        intent={Intent.PRIMARY}
                        position={Position.LEFT}
                        usePortal={false}
                        // disabled={isPopoverOpen}
                        // openOnTargetFocus={false}
                    >
                        <Button
                            className="bpIconButton" large={true}
                            intent={editorMode === k ? Intent.PRIMARY : Intent.NONE}
                            minimal={true} style={{transition: "background-color 0.25s ease-in-out"}}
                            rightIcon={v.icon} active={editorMode === k} onClick={() => setEditorMode(k)}/>

                    </Tooltip>

                ))}
            </ButtonGroup>
        </div>
    )
}
