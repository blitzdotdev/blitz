import {Object3DComponent} from 'threepipe'

export class Spinner extends Object3DComponent {
    static ComponentType = 'Spinner'

    update() {
        this.object.rotation.y += 0.01
        window.__blitzUpdates = (window.__blitzUpdates || 0) + 1
        this.object.setDirty?.({source: 'Spinner', change: 'rotation'})
        return true
    }
}
