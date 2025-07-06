import {
    ChromaticAberrationPlugin,
    DepthBufferPlugin,
    FilmicGrainPlugin,
    FrameFadePlugin,
    GBufferPlugin,
    GLTFKHRMaterialVariantsPlugin,
    InteractionPromptPlugin,
    NormalBufferPlugin,
    Object3DWidgetsPlugin,
    PickingPlugin,
    SSAAPlugin,
    SSAOPlugin,
    ThreeViewer,
    TonemapPlugin,
    TransformControlsPlugin,
    VignettePlugin
} from 'threepipe'
import {ViewerInstanceManager} from './ViewerInstanceManager.ts'
import {EditorModes, editorModesList} from '../components/EditorModes.tsx'
import {MaterialConfiguratorPlugin, SwitchNodePlugin} from '@threepipe/plugin-configurator'
import {
    BloomPlugin,
    DepthOfFieldPlugin,
    OutlinePlugin,
    SSContactShadowsPlugin, SSGIPlugin,
    SSReflectionPlugin,
    TemporalAAPlugin,
    VelocityBufferPlugin
} from '@threepipe/webgi-plugins'
import {ThreeGpuPathTracerPlugin} from "@threepipe/plugin-path-tracing";

export const editorFeatures = {
    'transform-controls': {
        enable: (viewer: ThreeViewer, key?: any) => {
            viewer.getPlugin(TransformControlsPlugin)?.enable(key ?? this)
        },
        disable: (viewer: ThreeViewer, key?: any) => {
            viewer.getPlugin(TransformControlsPlugin)?.disable(key ?? this)
        },
    },
    'widgets': {
        enable: (viewer: ThreeViewer, key?: any) => {
            viewer.getPlugin(Object3DWidgetsPlugin)?.enable(key ?? this)
        },
        disable: (viewer: ThreeViewer, key?: any) => {
            viewer.getPlugin(Object3DWidgetsPlugin)?.disable(key ?? this)
        },
    },
    'picking': {
        enable: (viewer: ThreeViewer, key?: any) => {
            viewer.getPlugin(PickingPlugin)?.enable(key ?? this)
        },
        disable: (viewer: ThreeViewer, key?: any) => {
            viewer.getPlugin(PickingPlugin)?.disable(key ?? this)
        },
    },
    'configurators': {
        enable: (viewer: ThreeViewer, key?: any) => {
            viewer.getPlugin(MaterialConfiguratorPlugin)?.enable(key ?? this)
            viewer.getPlugin(SwitchNodePlugin)?.enable(key ?? this)
            viewer.getPlugin(GLTFKHRMaterialVariantsPlugin)?.enable(key ?? this)
        },
        disable: (viewer: ThreeViewer, key?: any) => {
            viewer.getPlugin(MaterialConfiguratorPlugin)?.disable(key ?? this)
            viewer.getPlugin(SwitchNodePlugin)?.disable(key ?? this)
            viewer.getPlugin(GLTFKHRMaterialVariantsPlugin)?.disable(key ?? this)
        },
    },
    'prompts': {
        enable: (viewer: ThreeViewer, key?: any) => {
            viewer.getPlugin(InteractionPromptPlugin)?.enable(key ?? this)
        },
        disable: (viewer: ThreeViewer, key?: any) => {
            viewer.getPlugin(InteractionPromptPlugin)?.disable(key ?? this)
        },
    },
    'post-processing': {
        enable: (viewer: ThreeViewer, key?: any) => {
            viewer.getPlugin(VignettePlugin)?.enable(key ?? this)
            viewer.getPlugin(ChromaticAberrationPlugin)?.enable(key ?? this)
            viewer.getPlugin(FilmicGrainPlugin)?.enable(key ?? this)
            viewer.getPlugin(TonemapPlugin)?.enable(key ?? this)
            viewer.getPlugin(FrameFadePlugin)?.enable(key ?? this)
            viewer.getPlugin(SSAOPlugin)?.enable(key ?? this)
            viewer.getPlugin(SSAAPlugin)?.enable(key ?? this)
            viewer.getPlugin(SSReflectionPlugin)?.enable(key ?? this)
            viewer.getPlugin(DepthOfFieldPlugin)?.enable(key ?? this)
            viewer.getPlugin(GBufferPlugin)?.enable(key ?? this)
            viewer.getPlugin(DepthBufferPlugin)?.enable(key ?? this)
            viewer.getPlugin(NormalBufferPlugin)?.enable(key ?? this)
            viewer.getPlugin(BloomPlugin)?.enable(key ?? this)
            viewer.getPlugin(SSContactShadowsPlugin)?.enable(key ?? this)
            viewer.getPlugin(TemporalAAPlugin)?.enable(key ?? this)
            viewer.getPlugin(VelocityBufferPlugin)?.enable(key ?? this)
            viewer.getPlugin(OutlinePlugin)?.enable(key ?? this)
            viewer.getPlugin(SSGIPlugin)?.enable(key ?? this)
        },
        disable: (viewer: ThreeViewer, key?: any) => {
            viewer.getPlugin(VignettePlugin)?.disable(key ?? this)
            viewer.getPlugin(ChromaticAberrationPlugin)?.disable(key ?? this)
            viewer.getPlugin(FilmicGrainPlugin)?.disable(key ?? this)
            viewer.getPlugin(TonemapPlugin)?.disable(key ?? this)
            viewer.getPlugin(FrameFadePlugin)?.disable(key ?? this)
            viewer.getPlugin(SSAOPlugin)?.disable(key ?? this)
            viewer.getPlugin(SSAAPlugin)?.disable(key ?? this)
            viewer.getPlugin(GBufferPlugin)?.disable(key ?? this)
            viewer.getPlugin(DepthBufferPlugin)?.disable(key ?? this)
            viewer.getPlugin(NormalBufferPlugin)?.disable(key ?? this)
            viewer.getPlugin(SSReflectionPlugin)?.disable(key ?? this)
            viewer.getPlugin(DepthOfFieldPlugin)?.disable(key ?? this)
            viewer.getPlugin(BloomPlugin)?.disable(key ?? this)
            viewer.getPlugin(SSContactShadowsPlugin)?.disable(key ?? this)
            viewer.getPlugin(TemporalAAPlugin)?.disable(key ?? this)
            viewer.getPlugin(VelocityBufferPlugin)?.disable(key ?? this)
            viewer.getPlugin(OutlinePlugin)?.disable(key ?? this)
            viewer.getPlugin(SSGIPlugin)?.disable(key ?? this)
        },
    },
    'path-tracing': {
        enable: (viewer: ThreeViewer, key?: any) => {
            viewer.getPlugin(ThreeGpuPathTracerPlugin)?.enable(key ?? this)
        },
        disable: (viewer: ThreeViewer, key?: any) => {
            viewer.getPlugin(ThreeGpuPathTracerPlugin)?.disable(key ?? this)
        },
    },
    'damping': {
        enable: (_viewer: ThreeViewer, _key?: any) => {
            // todo support key based enable/disable damping in orbit controls etc
            // const controls = viewer.scene.mainCamera.controls as OrbitControls3
            // if(controls.enableDamping === undefined) return
            // controls.enableDamping = true
        },
        disable: (_viewer: ThreeViewer, _key?: any) => {
            // const controls = viewer.scene.mainCamera.controls as OrbitControls3
            // if(controls.enableDamping === undefined) return
            // controls.stopDamping()
            // controls.enableDamping = false
        },
    },
}

export class EditorFeatures {
    get viewer() {
        return this.manager.get()
    }

    constructor(public manager: ViewerInstanceManager) {
    }

    set(feature: keyof typeof editorFeatures, value = true, key?: any) {
        if (value) this.enable(feature, key)
        else this.disable(feature, key)
        return value
    }

    enable(feature: keyof typeof editorFeatures, key?: any) {
        editorFeatures[feature]?.enable(this.viewer, key)
    }

    disable(feature: keyof typeof editorFeatures, key?: any) {
        editorFeatures[feature]?.disable(this.viewer, key)
    }

    enableOnly(features: (keyof typeof editorFeatures)[], key?: any) {
        for (const f of Object.keys(editorFeatures)) {
            if (features.includes(f as any)) this.enable(f as any, key)
            else this.disable(f as any, key)
        }
    }
    refresh(mode: EditorModes){
        const features = editorModesList[mode].features
        const key = 'EditorModes'
        this.enableOnly(features, key)
    }

}

