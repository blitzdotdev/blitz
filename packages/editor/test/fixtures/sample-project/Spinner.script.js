import {Object3DComponent} from 'threepipe'

export class Spinner extends Object3DComponent {
    static ComponentType = 'Spinner'

    update() {
        this.object.rotation.y += 0.01
        window.__kite3dUpdates = (window.__kite3dUpdates || 0) + 1
        this.object.setDirty?.({source: 'Spinner', change: 'rotation'})
        return true
    }
}
