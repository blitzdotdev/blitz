import {Class, getOrCall, IViewerPlugin, ThreeViewer, UiObjectConfig} from "threepipe";
import {Button, ButtonGroup, IconName, Intent, Position, Tooltip} from "@blueprintjs/core";
import {FC} from 'react'
import {editorFeatures} from '../utils/EditorFeatures.ts'
// import {MaterialConfiguratorPlugin, SwitchNodePlugin} from '@threepipe/plugin-configurator'
// import {
//     AdvancedGroundPlugin,
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
// import {TransfrSharePlugin} from "@threepipe/plugin-network";
// import {TroikaTextPlugin} from "@threepipe/plugin-troika-text";

// todo rename to settings mode
export type EditorModes = /*'edit' | 'viewer'*/ | 'buffers' | 'postProcess' | 'animation' | 'extras' | 'import' | 'export' | 'configurators'
// todo rename to settings mode
export type EditorModesConfig = {
    label: string,
    icon: IconName,
    tag: string,
    uiConfig?: (viewer: ThreeViewer) => UiObjectConfig|undefined,
    plugins?: Array<Class<IViewerPlugin>|string>,
    features: (keyof typeof editorFeatures)[]
}
// todo rename to settings mode
export const editorModesList: Record<EditorModes, EditorModesConfig & {
}> = {
    // viewer: {
    //     label: 'Viewer',
    //     icon: 'eye-open',
    //     uiConfig: (viewer?: ThreeViewer)=>viewer?.uiConfig,
    //     features: ['post-processing', 'configurators', 'picking', 'damping', 'path-tracing','edit-mode']
    // },
    // edit: {
    //     label: 'Edit Scene',
    //     icon: 'edit',
    //     plugins: EditModePlugin,
    //     features: ['widgets', 'post-processing', 'transform-controls', 'picking', 'configurators', 'edit-mode']
    // },
    postProcess: {
        label: 'Post processing',
        tag: 'PostProcessing',
        icon: 'clean',
        plugins: [
            'Tonemap', 'ProgressivePlugin',
            'SSAAPlugin',
            'SSAOPlugin',
            'Vignette',
            'ChromaticAberration', 'FilmicGrain',
            'FrameFadePlugin',
            'TemporalAAPlugin',
            'SSReflectionPlugin',
            'DepthOfFieldPlugin',
            'BloomPlugin',
            'SSGIPlugin',
            'SSContactShadowsPlugin',
            'OutlinePlugin',
        ],
        features: ['post-processing','picking',  'damping','edit-mode']
    },
    animation: {
        label: 'Animation',
        tag: 'Animation',
        icon: 'play',
        plugins: ['GLTFAnimation', 'CameraViews', 'AnimationObjectPlugin', 'ObjectConstraintsPlugin'],
        features: ['post-processing', 'picking', 'damping','edit-mode']
    },
    configurators: {
        label: 'Configurator',
        tag: 'Configurator',
        icon: 'select',
        plugins: [
            'MaterialConfiguratorPlugin',
            'SwitchNodePlugin',
            'GLTFKHRMaterialVariantsPlugin',
            'TestPlugin',
        ],
        features: ['post-processing', 'configurators', 'picking', 'damping','edit-mode']
    },
    import: {
        label: 'Import',
        tag: 'Import',
        icon: 'export',
        plugins: [
            'Dropzone', 'Rhino3dmLoadPlugin',
            // TilesRendererPlugin, BlendLoadPlugin, B3DMLoadPlugin, CMPTLoadPlugin, DeepZoomImageLoadPlugin, I3DMLoadPlugin, PNTSLoadPlugin,
        ],
        features: ['post-processing', 'configurators', 'picking', 'damping','edit-mode']
    },
    export: {
        label: 'Export',
        icon: 'import',
        tag: 'Export',
        plugins: [
            'AssetExporterPlugin', 'CanvasSnapshotPlugin',
            'LoadingScreenPlugin',
            'AssimpJsPlugin',
            'ThreeGpuPathTracerPlugin',
            'TransfrSharePlugin'
        ],
        features: ['post-processing', 'configurators', 'damping', 'picking', 'path-tracing','edit-mode']
    },
    extras: {
        label: 'Extras',
        tag: 'Extras',
        icon: 'settings',
        plugins: [
            'ContactShadowGroundPlugin',
            'AdvancedGroundPlugin',
            'InteractionPromptPlugin',
            'FullScreenPlugin',
            'VirtualCamerasPlugin', 'HDRiGroundPlugin', 'ClearcoatTintPlugin',
            // 'AnisotropyPlugin',
            'ParallaxMappingPlugin', 'FragmentClippingExtensionPlugin', 'NoiseBumpMaterialPlugin',
            'CustomBumpMapPlugin', 'RenderTargetPreviewPlugin',
            'MeshOptSimplifyModifierPlugin',
            'TransformControlsPlugin',
            // 'EnvironmentControlsPlugin', 'GlobeControlsPlugin',
            // 'TroikaTextPlugin',
            'CascadedShadowsPlugin',
            'PickingPlugin',
            'CannonPhysicsPlugin',
        ],
        features: ['widgets', 'post-processing', 'transform-controls', 'picking', 'configurators', 'prompts', 'damping','edit-mode']
    },
    buffers: {
        label: 'Buffers',
        tag: 'Buffers',
        icon: 'grid-view',
        plugins: [
            'GBuffer', 'DepthBufferPlugin', 'NormalBufferPlugin',
            'VelocityBufferPlugin'
        ],
        features: ['post-processing', 'picking', 'damping','edit-mode']
    },
}

// export const editorModesInspectorConfig: Record<EditorModes, (v: ThreeViewer | null) => UiObjectConfig<any, 'panel'>> = {
//     viewer: (v: ThreeViewer | null) => ({
//         type: 'panel',
//         label: 'Viewer',
//         children: [ViewerUiConfigPlugin, DropzonePlugin, FullScreenPlugin].map(p => pui(v, p))
//     }),
//     edit: (v: ThreeViewer | null) => ({
//         type: 'panel',
//         label: 'edit',
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

export function getPluginsByTag(viewer: ThreeViewer, tag: string, prefix: string): IViewerPlugin[]{
    return Object.values(viewer.plugins).filter(p=>p.constructor.PluginTags?.includes(prefix + tag))
}

// todo rename to settings
export const editorModesInspectorConfig =
    Object.fromEntries(Object.entries(editorModesList).map(([k, v]) => [k, (viewer: ThreeViewer | null) => (
        getOrCall(v.uiConfig, viewer) ?? {
        type: 'panel',
        label: v.label,
        children: [()=>{
            // if(v.label === 'Configurator') debugger
            const plugins = [...v.plugins?.map((p)=>viewer?.getPlugin(p))||[], ...(v.tag&&viewer ? getPluginsByTag(viewer, v.tag, 'EditorMode-') : [])].filter(Boolean)
            const uniquePlugins = Array.from(new Set(plugins))
            // console.warn('refresh panel', v.label, uniquePlugins)
            return uniquePlugins.map(p => p?.uiConfig||{})
        }]
    })])) as Record<EditorModes, (v: ThreeViewer | null) => UiObjectConfig<any, 'panel'>>


// todo rename to settings button group
export const EditorModesButtonGroup: FC<{ editorMode: EditorModes, setEditorMode: (mode: EditorModes) => void }> = (
    {
        editorMode,
        setEditorMode
    }) => {
    return (
        <div className="editorModesContainer">
            <ButtonGroup vertical={false} className={"icon-only-tab-button-group"} style={{
            }}>
                {(Object.entries(editorModesList) as [EditorModes, EditorModesConfig][]).map(([k, v]) => (
                    <Tooltip
                        content={v.label}
                        key={k}
                        intent={Intent.PRIMARY}
                        position={Position.BOTTOM}
                        usePortal={false}
                        // disabled={isPopoverOpen}
                        // openOnTargetFocus={false}
                    >
                        <Button
                            className="bpIconButton icon-only-tab-button settings-tab-button" size={'medium'}
                            intent={Intent.NONE}
                            variant={"minimal"} style={{
                                transition: "background-color 0.25s ease-in-out",
                                borderRadius: "calc(var(--pt-grid-size) * 0.5)",
                        }}
                            endIcon={v.icon} active={editorMode === k} onClick={() => setEditorMode(k)}/>

                    </Tooltip>

                ))}
            </ButtonGroup>
        </div>
    )
}

export const PlayModeButtonGroup: FC<{ isPlaying: boolean, setIsPlaying: (mode: boolean) => void }> = (
    {
        isPlaying,
        setIsPlaying
    }) => {
    return (
        <div className="isPlayingContainer">
            {/*<SegmentedControl*/}
            {/*    size={"large"}*/}
            {/*    intent={"primary"}*/}
            {/*    options={[*/}
            {/*        {*/}
            {/*            label: "Edit",*/}
            {/*            value: "edit",*/}
            {/*            icon: "edit",*/}
            {/*        },*/}
            {/*        {*/}
            {/*            label: "Play",*/}
            {/*            value: "play",*/}
            {/*            icon: "play",*/}
            {/*        },*/}
            {/*    ]}*/}
            {/*    defaultValue="edit"*/}
            {/*    onValueChange={(value) => setIsPlaying(value === 'play')}*/}
            {/*    value={isPlaying ? 'play' : 'edit'}*/}
            {/*/>*/}

            <ButtonGroup vertical={false} style={{width: "max-content"}}>
                {([{
                    key: 'edit',
                    label: 'Edit',
                    icon: 'edit' as IconName,
                    value: false,
                }, {
                    key: 'play',
                    label: 'Play',
                    icon: 'play' as IconName,
                    value: true,
                }]).map((v) => (
                    <Tooltip
                        content={v.label}
                        key={v.key}
                        intent={Intent.PRIMARY}
                        position={Position.BOTTOM}
                        usePortal={false}
                        // disabled={isPopoverOpen}
                        // openOnTargetFocus={false}
                    >
                        <Button
                            className="bpIconButton icon-only-tab-button" size={'medium'}
                            intent={v.value === isPlaying ? Intent.PRIMARY : Intent.NONE}
                            variant={"minimal"} style={{transition: "background-color 0.25s ease-in-out"}}
                            endIcon={v.icon} active={isPlaying === v.value} onClick={() => setIsPlaying(v.value)}/>
                    </Tooltip>

                ))}
            </ButtonGroup>
        </div>
    )
}
