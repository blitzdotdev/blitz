import {EventDispatcher, PickingPlugin} from "threepipe";
import {ViewerInstanceManager} from "./ViewerInstanceManager.ts";

export class EditPreviewHelper extends EventDispatcher<{
    editPreviewChange: {},
}> {

    enabled = false
    private pickerCursorStyles?: {default: string, down: string}

    constructor(private features: ViewerInstanceManager['features']) {
        super()
    }

    async start() {
        if (this.enabled) return

        const viewer = this.features.viewer
        const picker = viewer.getPlugin(PickingPlugin)?.picker
        if (picker) this.pickerCursorStyles = {...picker.cursorStyles}

        this.features.disable('widgets', 'EditPreview')
        this.features.disable('transform-controls', 'EditPreview')
        this.features.disable('picking', 'EditPreview')
        this.features.disable('edit-mode', 'EditPreview')

        // ObjectPicker keeps its DOM listeners while its plugin is disabled.
        // Neutral cursor styles prevent those listeners from showing the
        // editor-only grab cursor during preview/play input.
        if (picker) {
            picker.cursorStyles.default = 'default'
            picker.cursorStyles.down = 'default'
        }
        viewer.canvas.style.cursor = 'default'

        this.enabled = true
        this.dispatchEvent({type: 'editPreviewChange'})
    }

    async stop() {
        if (!this.enabled) return

        const viewer = this.features.viewer
        const picker = viewer.getPlugin(PickingPlugin)?.picker

        this.features.enable('widgets', 'EditPreview')
        this.features.enable('transform-controls', 'EditPreview')
        this.features.enable('picking', 'EditPreview')
        this.features.enable('edit-mode', 'EditPreview')

        if (picker && this.pickerCursorStyles) {
            picker.cursorStyles = this.pickerCursorStyles
            this.pickerCursorStyles = undefined
        }

        this.enabled = false
        this.dispatchEvent({type: 'editPreviewChange'})
    }

}
