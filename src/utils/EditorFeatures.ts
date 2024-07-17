import {
    ChromaticAberrationPlugin,
    FilmicGrainPlugin,
    FrameFadePlugin,
    Object3DWidgetsPlugin, PickingPlugin,
    ThreeViewer,
    TonemapPlugin,
    TransformControlsPlugin,
    VignettePlugin
} from 'threepipe'
import {ViewerInstanceManager} from './ViewerInstanceManager.ts'
import {EditorModes, editorModesList} from '../components/EditorModes.tsx'

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
    'post-processing': {
        enable: (viewer: ThreeViewer, key?: any) => {
            viewer.getPlugin(VignettePlugin)?.enable(key ?? this)
            viewer.getPlugin(ChromaticAberrationPlugin)?.enable(key ?? this)
            viewer.getPlugin(FilmicGrainPlugin)?.enable(key ?? this)
            viewer.getPlugin(TonemapPlugin)?.enable(key ?? this)
            viewer.getPlugin(FrameFadePlugin)?.enable(key ?? this)
        },
        disable: (viewer: ThreeViewer, key?: any) => {
            viewer.getPlugin(VignettePlugin)?.disable(key ?? this)
            viewer.getPlugin(ChromaticAberrationPlugin)?.disable(key ?? this)
            viewer.getPlugin(FilmicGrainPlugin)?.disable(key ?? this)
            viewer.getPlugin(TonemapPlugin)?.disable(key ?? this)
            viewer.getPlugin(FrameFadePlugin)?.disable(key ?? this)
        },
    }
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

