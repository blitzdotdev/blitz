import {
    AssetExporterPlugin,
    CameraViewPlugin, CanvasSnapshotPlugin,
    ChromaticAberrationPlugin,
    Class,
    ClearcoatTintPlugin, ContactShadowGroundPlugin,
    CustomBumpMapPlugin,
    DepthBufferPlugin,
    DropzonePlugin,
    FilmicGrainPlugin,
    FragmentClippingExtensionPlugin,
    FrameFadePlugin,
    FullScreenPlugin, GBufferPlugin, getOrCall,
    GLTFAnimationPlugin, GLTFKHRMaterialVariantsPlugin,
    HDRiGroundPlugin, InteractionPromptPlugin,
    IViewerPlugin, LoadingScreenPlugin, MeshOptSimplifyModifierPlugin,
    NoiseBumpMaterialPlugin,
    NormalBufferPlugin, ParallaxMappingPlugin,
    PickingPlugin,
    ProgressivePlugin,
    RenderTargetPreviewPlugin,
    Rhino3dmLoadPlugin, SSAAPlugin, SSAOPlugin,
    ThreeViewer,
    TonemapPlugin, TransformControlsPlugin,
    UiObjectConfig, ValOrArr,
    VignettePlugin,
    VirtualCamerasPlugin
} from "threepipe";
import {Button, ButtonGroup, IconName, Intent, Position, Tooltip} from "@blueprintjs/core";
import {FC} from 'react'
import {editorFeatures} from '../utils/EditorFeatures.ts'
import {MaterialConfiguratorPlugin, SwitchNodePlugin} from '@threepipe/plugin-configurator'
import {
    AdvancedGroundPlugin,
    AnisotropyPlugin,
    BloomPlugin,
    DepthOfFieldPlugin, OutlinePlugin,
    SSContactShadowsPlugin,
    SSReflectionPlugin, TemporalAAPlugin,
    VelocityBufferPlugin, SSGIPlugin,
} from '@threepipe/webgi-plugins'
import {
    B3DMLoadPlugin,
    CMPTLoadPlugin,
    DeepZoomImageLoadPlugin,
    I3DMLoadPlugin,
    PNTSLoadPlugin,
    TilesRendererPlugin,
    EnvironmentControlsPlugin,
    GlobeControlsPlugin,
} from '@threepipe/plugin-3d-tiles-renderer'
import {AssimpJsPlugin} from '@threepipe/plugin-assimpjs'
import {ThreeGpuPathTracerPlugin} from '@threepipe/plugin-path-tracing'
import {BlendLoadPlugin} from "@threepipe/plugin-blend-importer";
import {TransfrSharePlugin} from "@threepipe/plugin-network";

export type EditorModes = 'interaction' | 'viewer' | 'buffers' | 'postProcess' | 'animation' | 'extras' | 'import' | 'export' | 'configurators'
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
        uiConfig: (viewer?: ThreeViewer)=>viewer?.uiConfig,
        features: ['post-processing', 'configurators', 'damping', 'path-tracing']
    },
    interaction: {
        label: 'Interaction',
        icon: 'hand',
        plugins: PickingPlugin,
        features: ['widgets', 'post-processing', 'transform-controls', 'picking', 'configurators']
    },
    postProcess: {
        label: 'Post processing',
        icon: 'clean',
        plugins: [TonemapPlugin, ProgressivePlugin,
            SSAAPlugin, TemporalAAPlugin, SSAOPlugin, SSReflectionPlugin,
            DepthOfFieldPlugin,
            BloomPlugin,
            VignettePlugin,
            ChromaticAberrationPlugin, FilmicGrainPlugin, SSGIPlugin,
            SSContactShadowsPlugin, OutlinePlugin,
            FrameFadePlugin],
        features: ['post-processing', 'damping']
    },
    animation: {
        label: 'Animation',
        icon: 'play',
        plugins: [GLTFAnimationPlugin, CameraViewPlugin],
        features: ['post-processing', 'damping']
    },
    configurators: {
        label: 'Configurator',
        icon: 'select',
        plugins: [MaterialConfiguratorPlugin, SwitchNodePlugin, GLTFKHRMaterialVariantsPlugin],
        features: ['post-processing', 'configurators', 'picking', 'damping']
    },
    import: {
        label: 'Import',
        icon: 'export',
        plugins: [DropzonePlugin, Rhino3dmLoadPlugin, TilesRendererPlugin, BlendLoadPlugin, B3DMLoadPlugin, CMPTLoadPlugin, DeepZoomImageLoadPlugin, I3DMLoadPlugin, PNTSLoadPlugin, ],
        features: ['post-processing', 'configurators', 'damping']
    },
    export: {
        label: 'Export',
        icon: 'import',
        plugins: [AssetExporterPlugin, CanvasSnapshotPlugin, AssimpJsPlugin, LoadingScreenPlugin, ThreeGpuPathTracerPlugin, TransfrSharePlugin],
        features: ['post-processing', 'configurators', 'damping', 'path-tracing']
    },
    extras: {
        label: 'Extras',
        icon: 'settings',
        plugins: [
            ContactShadowGroundPlugin, AdvancedGroundPlugin, InteractionPromptPlugin,
            FullScreenPlugin,
            VirtualCamerasPlugin, HDRiGroundPlugin, ClearcoatTintPlugin, AnisotropyPlugin,
            ParallaxMappingPlugin, FragmentClippingExtensionPlugin, NoiseBumpMaterialPlugin,
            CustomBumpMapPlugin, RenderTargetPreviewPlugin,
            MeshOptSimplifyModifierPlugin,
            TransformControlsPlugin,
            EnvironmentControlsPlugin, GlobeControlsPlugin,
        ],
        features: ['widgets', 'post-processing', 'transform-controls', 'picking', 'configurators', 'prompts', 'damping']
    },
    buffers: {
        label: 'Buffers',
        icon: 'grid-view',
        plugins: [GBufferPlugin, DepthBufferPlugin, NormalBufferPlugin, VelocityBufferPlugin],
        features: ['post-processing', 'damping']
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
