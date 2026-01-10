import {EventDispatcher} from "threepipe";
import {ViewerInstanceManager} from "./ViewerInstanceManager.ts";

export class EditPreviewHelper extends EventDispatcher<{
    editPreviewChange: {},
}> {

    enabled = false

    constructor(private features: ViewerInstanceManager['features']) {
        super()
    }

    async start() {
        this.features.disable('widgets', 'EditPreview')
        this.features.disable('transform-controls', 'EditPreview')
        // this.features.disable('picking', 'EditPreview')
        // debugger
        this.features.disable('edit-mode', 'EditPreview')
        this.enabled = true
        this.dispatchEvent({type: 'editPreviewChange'})
    }

    async stop() {
        this.features.enable('widgets', 'EditPreview')
        this.features.enable('transform-controls', 'EditPreview')
        // this.features.enable('picking', 'EditPreview')
        this.features.enable('edit-mode', 'EditPreview')
        this.enabled = false
        this.dispatchEvent({type: 'editPreviewChange'})
    }

}
