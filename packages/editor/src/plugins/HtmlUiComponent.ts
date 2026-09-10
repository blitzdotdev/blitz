import {
    ComponentDefn,
    ComponentJSON,
    IObject3D,
    IObject3DEventMap,
    ISceneEventMap,
    literalStrings,
    Object3DComponent,
    Vector3,
    ViewerEventMap
} from "threepipe"

export const uiPositionMode = ['world', 'screen', 'viewport'] as const
export type UiPositionMode = typeof uiPositionMode[number]

export class HtmlUiComponent extends Object3DComponent {
    static ComponentType = 'HtmlUiComponent'
    static StateProperties: ComponentDefn['StateProperties'] = [
        'enabled',
        {
            key: 'htmlData',
            type: 'string',
            uiConfig: {
                multiline: true,
                rows: 5,
                autoResize: true,
            }
        },
        'width',
        'height',
        'scrollable',
        'interactable',
        {
            key: 'positionMode',
            type: literalStrings(uiPositionMode),
        },
        'offsetX',
        'offsetY',
        'zIndex',
        'visible',
        'appendToBody'
    ]

    declare element: HTMLDivElement

    enabled = true

    // HTML content
    htmlData = '<div>Hello World</div>'

    // Size properties
    width = -1 // in pixels
    height = -1 // in pixels

    // Behavior properties
    scrollable = false
    interactable = true
    visible = true
    appendToBody = false // false = append to viewer.container (default), true = append to document.body

    // Position properties
    positionMode: UiPositionMode = 'world' // world follows 3D object, screen is fixed, viewport is relative to viewport
    offsetX = 0 // pixel offset from calculated position
    offsetY = 0 // pixel offset from calculated position
    zIndex = 1000 // CSS z-index

    private _worldPosition = new Vector3()
    private _animationFrameId?: number

    constructor() {
        super()

        this.onStateChange('htmlData', (v) => {
            if (!this.element) return
            this.element.innerHTML = v
            // this.object.setDirty?.({source: 'HtmlUiComponent'})
        })

        this.onStateChange('width', (v) => {
            if (!this.element) return
            this.element.style.width = v < 0 ? 'auto' : `${v}px`
            this.object.setDirty?.({source: 'HtmlUiComponent'})
        })

        this.onStateChange('height', (v) => {
            if (!this.element) return
            this.element.style.height = v < 0 ? 'auto' : `${v}px`
            this.object.setDirty?.({source: 'HtmlUiComponent'})
        })

        this.onStateChange('scrollable', (v) => {
            if (!this.element) return
            this.element.style.overflow = v ? 'auto' : 'hidden'
            this.object.setDirty?.({source: 'HtmlUiComponent'})
        })

        this.onStateChange('interactable', (v) => {
            if (!this.element) return
            this.element.style.pointerEvents = v ? 'auto' : 'none'
            this.object.setDirty?.({source: 'HtmlUiComponent'})
        })

        this.onStateChange('visible', (v) => {
            if (!this.element) return
            this.element.style.display = v ? 'block' : 'none'
            this.object.setDirty?.({source: 'HtmlUiComponent'})
        })

        this.onStateChange('positionMode', () => {
            if (!this.element) return
            this._updateElementPosition()
            this.object.setDirty?.({source: 'HtmlUiComponent'})
        })

        this.onStateChange('offsetX', () => {
            if (!this.element) return
            this._updateElementPosition()
            this.object.setDirty?.({source: 'HtmlUiComponent'})
        })

        this.onStateChange('offsetY', () => {
            if (!this.element) return
            this._updateElementPosition()
            this.object.setDirty?.({source: 'HtmlUiComponent'})
        })

        this.onStateChange('zIndex', (v) => {
            if (!this.element) return
            this.element.style.zIndex = `${v}`
            this.object.setDirty?.({source: 'HtmlUiComponent'})
        })

        this.onStateChange('appendToBody', (v) => {
            if (!this.element) return
            // Remove from current parent
            if (this.element.parentNode) {
                this.element.parentNode.removeChild(this.element)
            }
            // Append to new container
            const container = v ? document.body : (this.ctx?.viewer?.container || document.body)
            container.appendChild(this.element)
            this.object.setDirty?.({source: 'HtmlUiComponent'})
        })
    }

    private _objectUpdate = (e: IObject3DEventMap['objectUpdate'] | ISceneEventMap['mainCameraUpdate']) => {
        if (e.source === 'HtmlUiComponent') return
        const changeKey = e?.change ?? e?.key
        const update = !changeKey || changeKey === 'position' || changeKey === 'transform' || changeKey === 'quaternion' || changeKey === 'visible' || changeKey === 'controls'
        if (update && this.positionMode === 'world') {
            this._updateElementPosition()
        }
    }

    init(object: IObject3D, state: ComponentJSON['state']) {
        super.init(object, state)

        // Create the HTML element
        this.element = document.createElement('div')
        this.element.className = 'threepipe-html-ui'

        // Apply initial styles
        this.element.style.position = 'absolute'
        this.element.style.width = this.width < 0 ? 'auto' : `${this.width}px`
        this.element.style.height = this.height < 0 ? 'auto' : `${this.height}px`
        this.element.style.overflow = this.scrollable ? 'auto' : 'hidden'
        this.element.style.pointerEvents = this.interactable ? 'auto' : 'none'
        this.element.style.zIndex = `${this.zIndex}`
        this.element.style.display = this.visible ? 'block' : 'none'
        this.element.style.boxSizing = 'border-box'

        // Set HTML content
        this.element.innerHTML = this.htmlData

        // Add to document or viewer container
        const container = this.appendToBody ? document.body : (this.ctx?.viewer?.container || document.body)
        container.appendChild(this.element)

        // Listen for object updates
        object.addEventListener('objectUpdate', this._objectUpdate)
        this.ctx.viewer.scene.addEventListener('mainCameraUpdate', this._objectUpdate)

        // Start position tracking for world-positioned elements
        this._updateElementPosition()
    }

    destroy(): Record<string, any> {
        // Stop position tracking
        this._stopPositionTracking()

        // Remove event listener
        this.object.removeEventListener('objectUpdate', this._objectUpdate)
        this.ctx.viewer.scene.removeEventListener('mainCameraUpdate', this._objectUpdate)

        // Remove element from DOM
        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element)
        }
        this.element = null as any

        return super.destroy()
    }

    private _stopPositionTracking() {
        if (this._animationFrameId !== undefined) {
            cancelAnimationFrame(this._animationFrameId)
            this._animationFrameId = undefined
        }
    }

    preFrame({resized}: ViewerEventMap["preFrame"]): boolean | void {
        if(!this.element || !this.enabled) return
        //   world - on camera change, canvas size change, object transform change
        //   screen - no change
        //   viewport - on canvas size change
        if(this.positionMode === 'screen') return
        if(!resized && this.positionMode === 'viewport') return
        if(!resized && this.positionMode === 'world') return // todo: tracked separately
        this._updateElementPosition()
    }

    private _updateElementPosition() {
        if (!this.element) return

        switch (this.positionMode) {
            case 'world':
                this._updateWorldPosition()
                break
            case 'screen':
                this._updateScreenPosition()
                break
            case 'viewport':
                this._updateViewportPosition()
                break
        }
    }

    private _updateWorldPosition() {
        // Get the world position of the object
        this.object.getWorldPosition(this._worldPosition)

        // Project to screen space
        const camera = this.ctx?.viewer?.scene?.mainCamera
        if (!camera) return

        const canvas = this.ctx?.viewer?.canvas
        if (!canvas) return

        // Clone position and project it
        const projected = this._worldPosition.clone()
        projected.project(camera)

        // Convert to screen coordinates
        const x = (projected.x * 0.5 + 0.5) * canvas.clientWidth
        const y = (projected.y * -0.5 + 0.5) * canvas.clientHeight

        // Apply position with offset
        this.element.style.left = `${x + this.offsetX}px`
        this.element.style.top = `${y + this.offsetY}px`
        this.element.style.transform = 'translate(-50%, -50%)' // Center on point
    }

    private _updateScreenPosition() {
        // Fixed screen position
        this.element.style.left = `${this.offsetX}px`
        this.element.style.top = `${this.offsetY}px`
        this.element.style.transform = 'none'
    }

    private _updateViewportPosition() {
        // Viewport-relative position (percentage-based)
        const canvas = this.ctx?.viewer?.canvas
        if (!canvas) return

        const x = (this.offsetX / 100) * canvas.clientWidth
        const y = (this.offsetY / 100) * canvas.clientHeight

        this.element.style.left = `${x}px`
        this.element.style.top = `${y}px`
        this.element.style.transform = 'none'
    }

    /**
     * Update the HTML content programmatically
     */
    setHtml(html: string) {
        this.htmlData = html
    }

    /**
     * Set the position
     */
    setPosition(x: number, y: number) {
        this.offsetX = x
        this.offsetY = y
    }

    /**
     * Set the size
     */
    setSize(width: number, height: number) {
        this.width = width
        this.height = height
    }

    /**
     * Show the element
     */
    show() {
        this.visible = true
    }

    /**
     * Hide the element
     */
    hide() {
        this.visible = false
    }
}

