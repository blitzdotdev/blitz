import {AViewerPluginSync, EntityComponentPlugin} from 'threepipe'

export class OrderPlugin extends AViewerPluginSync {
    static PluginType = 'OrderPlugin'
    enabled = true

    onAdded(viewer) {
        super.onAdded(viewer)
        window.__componentRegisteredBeforePlugin = viewer
            .getPlugin(EntityComponentPlugin)
            ?.hasComponentType('LateComponent') === true
    }
}
