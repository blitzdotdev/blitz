import {
    ChromaticAberrationPlugin,
    DepthBufferPlugin,
    FilmicGrainPlugin,
    FrameFadePlugin,
    GBufferPlugin,
    GLTFKHRMaterialVariantsPlugin,
    InteractionPromptPlugin, IViewerEvent,
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
// import {MaterialConfiguratorPlugin, SwitchNodePlugin} from '@threepipe/plugin-configurator'
// import {
//     BloomPlugin,
//     DepthOfFieldPlugin,
//     OutlinePlugin,
//     SSContactShadowsPlugin, SSGIPlugin,
//     SSReflectionPlugin,
//     TemporalAAPlugin,
//     VelocityBufferPlugin
// } from '@threepipe/webgi-plugins'
// import {ThreeGpuPathTracerPlugin} from "@threepipe/plugin-path-tracing";
import {EditModePlugin} from "./EditModePlugin.ts";
import {CannonPhysicsPlugin} from "@kite3d/engine";
import {DepthOfFieldPlugin, SSReflectionPlugin} from "@threepipe/webgi-plugins";

const pluginDisableListener = (k: any)=>((ev: IViewerEvent)=>{
    if(typeof !ev.plugin?.disable !== 'function') return
    ev.plugin.disable(k)
})

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
            // viewer.getPlugin(FrameFadePlugin)?.disable(key ?? this)
            viewer.getPlugin(PickingPlugin)?.enable(key ?? this)
        },
        disable: (viewer: ThreeViewer, key?: any) => {
            // viewer.getPlugin(FrameFadePlugin)?.enable(key ?? this)
            viewer.getPlugin(PickingPlugin)?.disable(key ?? this)
        },
    },
    'edit-mode': {
        enable: (viewer: ThreeViewer, key?: any) => {
            viewer.getPlugin(EditModePlugin)?.enable(key ?? this)
        },
        disable: (viewer: ThreeViewer, key?: any) => {
            viewer.getPlugin(EditModePlugin)?.disable(key ?? this)
        },
    },
    'configurators': {
        enable: (viewer: ThreeViewer, key?: any) => {
            // viewer.getPlugin(MaterialConfiguratorPlugin)?.enable(key ?? this)
            // viewer.getPlugin(SwitchNodePlugin)?.enable(key ?? this)
            viewer.getPlugin(GLTFKHRMaterialVariantsPlugin)?.enable(key ?? this)
        },
        disable: (viewer: ThreeViewer, key?: any) => {
            // viewer.getPlugin(MaterialConfiguratorPlugin)?.disable(key ?? this)
            // viewer.getPlugin(SwitchNodePlugin)?.disable(key ?? this)
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
        pluginTypes: [
            'VignettePlugin',
            'ChromaticAberrationPlugin',
            'FilmicGrainPlugin',
            'TonemapPlugin',
            'FrameFadePlugin',
            'SSAOPlugin',
            'SSAAPlugin',
            'GBufferPlugin',
            'DepthBufferPlugin',
            'NormalBufferPlugin',
            'SSReflectionPlugin',
            'DepthOfFieldPlugin',
            'BloomPlugin',
            'SSContactShadowsPlugin',
            'TemporalAAPlugin',
            'VelocityBufferPlugin',
            'OutlinePlugin',
            'SSGIPlugin',
        ],
        pluginDisableListeners: new Map<any, (ev:any)=>void>(),
        enable: (viewer: ThreeViewer, key?: any) => {
            const k = key ?? this
            const {pluginTypes, pluginDisableListeners} = editorFeatures['post-processing']
            let listener = pluginDisableListeners.get(k)
            if(listener) {
                viewer.removePluginListener('add', listener)
                pluginDisableListeners.delete(k)
            }
            for(const type of pluginTypes) {
                viewer.getPlugin(type)?.enable(key ?? this)
            }
        },
        disable: (viewer: ThreeViewer, key?: any) => {
            const k = key ?? this
            const {pluginTypes, pluginDisableListeners} = editorFeatures['post-processing']
            let listener = pluginDisableListeners.get(k)
            if(!listener) {
                listener = pluginDisableListener(k)
                pluginDisableListeners.set(k, listener)
            }
            viewer.addPluginListener('add', listener, ...pluginTypes)
            for(const type of pluginTypes) {
                viewer.getPlugin(type)?.disable(key ?? this)
            }
        },
    },
    'path-tracing': {
        enable: (viewer: ThreeViewer, key?: any) => {
            // viewer.getPlugin(ThreeGpuPathTracerPlugin)?.enable(key ?? this)
        },
        disable: (viewer: ThreeViewer, key?: any) => {
            // viewer.getPlugin(ThreeGpuPathTracerPlugin)?.disable(key ?? this)
        },
    },
    'physics': {
        enable: (viewer: ThreeViewer, key?: any) => {
            const physics = viewer.getPlugin(CannonPhysicsPlugin)
            if(physics) {
                physics.running = true
            }
        },
        disable: (viewer: ThreeViewer, key?: any) => {
            const physics = viewer.getPlugin(CannonPhysicsPlugin)
            if(physics) {
                physics.running = false
            }
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

