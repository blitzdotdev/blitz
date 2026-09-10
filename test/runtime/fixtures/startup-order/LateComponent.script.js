import {AViewerPluginSync, EntityComponentPlugin, Object3DComponent} from 'threepipe'

export class LateComponent extends Object3DComponent {
    static ComponentType = 'LateComponent'

    update() {
        window.__startupOrderUpdates = (window.__startupOrderUpdates || 0) + 1
        return true
    }
}

export class ScriptOrderPlugin extends AViewerPluginSync {
    static PluginType = 'ScriptOrderPlugin'
    enabled = true

    onAdded(viewer) {
        super.onAdded(viewer)
        window.__componentRegisteredBeforeScriptPlugin = viewer
            .getPlugin(EntityComponentPlugin)
            ?.hasComponentType('LateComponent') === true
    }
}
