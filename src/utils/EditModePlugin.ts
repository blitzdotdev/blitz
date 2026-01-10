import {
    AViewerPluginEventMap,
    AViewerPluginSync,
    Box3B,
    EditorViewWidgetPlugin,
    getFittingDistance,
    GridHelper,
    IObject3D,
    iObjectCommons,
    IViewerEvent,
    IViewerEventTypes,
    onChange,
    OrbitControls3,
    OrthographicCamera2,
    PartialRecord,
    PerspectiveCamera2,
    PickingPlugin,
    serialize,
    ThreeViewer,
    uiFolderContainer,
    uiNumber,
    uiToggle,
    UndoManagerPlugin,
    Vector3
} from "threepipe";
import {editorCameraController} from "./three/EditorCameraController.ts";
import {LightMaterialOverrider} from "./three/LightMaterialOverrider.ts";
import {isExternalObject} from "./projectUtils.ts";

// Camera type that can be 'perspective', 'orthographic', 'default' (scene.defaultCamera), or a scene camera UUID
export type CameraType = 'perspective' | 'orthographic' | 'default' | string;

// just for edit mode settings and basic stuff, dont put project running state here.
@uiFolderContainer('Edit Mode', {expanded: true})
export class EditModePlugin extends AViewerPluginSync<{
    enableChanged: {}
    cameraChanged: {camera: 'perspective' | 'orthographic' | IObject3D}
} & AViewerPluginEventMap>{
    public static readonly PluginType = 'EditModePlugin';

    get isEnabled2(){
        return !this.isDisabled()
    }

    // todo disable this plugin when the scene config is being imported. use some hook
    @onChange('setDirty')
    enabled = true

    private _lastEnabled = false

    dependencies = [PickingPlugin]

    cameraPerspective = new PerspectiveCamera2('orbit')
    cameraOrtho = new OrthographicCamera2('orbit')

    @onChange('setDirty')
    cameraMode: CameraType = 'perspective'

    // grid = new Mesh(new PlaneGeometry(), new GridMaterial())
    grid = new GridHelper(100, 100, 0x62793a, 0x4e4f4f)

    lightOverrider = new LightMaterialOverrider()

    constructor() {
        super();
        this._lastEnabled = this.enabled
        // this.grid.scale.set(1000,1000,1000)
        // this.grid.rotation.x = -Math.PI/2
        this.grid.visible = false
        this.grid.material.userData.renderToGBuffer = false
        this.grid.material.userData.renderToDepth = false
        this.grid.material.allowOverride = false

        // this.grid.material.transparent = true
        // this.grid.material.opacity = 1
        // console.log(this.grid.material)
        // @ts-ignore
        this.grid.isWidget = true;
//         this.grid.material.onBeforeCompile = (shader) => {
//             console.log(shader.vertexShader)
//             console.log(shader.fragmentShader)
//             shader.vertexShader = 'varying vec3 vViewPosition;\n' + shaderReplaceString(shader.vertexShader, '#include <worldpos_vertex>', glsl`
//             vViewPosition = - mvPosition.xyz;
//             `, {prepend: true})
//             shader.fragmentShader = 'varying vec3 vViewPosition;\n' + shaderReplaceString(shader.fragmentShader, '#include <opaque_fragment>', glsl`
// float falloffRate = 0.1; // Lower = more gradual
// float distance = abs(vViewPosition.z);
// vec3 c2 = gl_FragColor.xyz;
// // #3f3f3f
// vec3 c1 = vec3(0.05);
// // vec3 c1 = vec3(0);
// // vec3 c2 = vec3(1);
// distance = clamp((100.-distance)/100., 0.1, 1.0);
// // exponential
// gl_FragColor.xyz = mix(c1, c2, pow(distance, 1.));
//             `, {append: true})
//         }

        this.cameraPerspective.name = 'EditMode Perspective Camera'
        this.cameraPerspective.position.set(0,0,10)
        this.cameraPerspective.target.set(0,0,0)
        this.cameraPerspective.userData.disableWidgets = true
        this.cameraPerspective.autoNearFar = false
        this.cameraPerspective.autoAspect = true
        this.cameraPerspective.autoLookAtTarget = true
        this.cameraOrtho.name = 'EditMode Orthographic Camera'
        this.cameraOrtho.position.set(0,0,10)
        this.cameraOrtho.target.set(0,0,0)
        this.cameraOrtho.frustumSize = 10
        this.cameraOrtho.userData.disableWidgets = true
        this.cameraOrtho.autoNearFar = false
        this.cameraOrtho.autoAspect = true
        this.cameraOrtho.autoLookAtTarget = true

    }

    dispose() {
        this.cameraPerspective.dispose()
        this.cameraOrtho.dispose()
        this.grid.geometry.dispose()
        if(Array.isArray(this.grid.material)){
            this.grid.material.forEach(m=>m.dispose())
        } else {
            this.grid.material.dispose()
        }

        this.lightOverrider.dispose()

        super.dispose();
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer);

        // this.grid.material.color.set(0xff0000)

        // console.log(this.grid)
        // todo why is it still shadowing on the ground
        this.grid.userData.autoUpgradeChildren = false
        this.grid.traverse(o=>{
            o.userData.__keepShadowDef = true
            o.castShadow = false
            o.receiveShadow = false
            o.userData.renderToDepth = false
            o.userData.renderToGBuffer = false
            o.userData.bboxVisible = false
        })
        viewer.scene.addObject(this.grid, {addToRoot: true})
        // viewer.scene.addObject(this.cameraPerspective, {addToRoot: true})
        // viewer.scene.addObject(this.cameraOrtho, {addToRoot: true})
        viewer.scene.add(this.cameraPerspective)
        viewer.scene.add(this.cameraOrtho)

        this.lightOverrider.viewer = viewer

        // todo fade the ground away from the camera.

        viewer.canvas.addEventListener('keydown', this._keyDown, true)
        document.addEventListener('keydown', this._keyDownGlobal, true)
        viewer.canvas.addEventListener('keyup', this._keyUp, true)
        document.addEventListener('keyup', this._keyUpGlobal, true)
        viewer.canvas.addEventListener('pointerdown', this._pointerDown, true)
        viewer.canvas.addEventListener('pointerup', this._pointerUp, true)
        viewer.canvas.addEventListener('contextmenu', this._contextMenu, true)

        this._lastEnabled = false
        this.setDirty()
    }

    onRemove(viewer: ThreeViewer) {

        viewer.canvas.removeEventListener('keydown', this._keyDown, true)
        document.removeEventListener('keydown', this._keyDownGlobal, true)
        viewer.canvas.removeEventListener('keyup', this._keyUp, true)
        document.removeEventListener('keyup', this._keyUpGlobal, true)
        viewer.canvas.removeEventListener('pointerdown', this._pointerDown, true)
        viewer.canvas.removeEventListener('pointerup', this._pointerUp, true)
        viewer.canvas.removeEventListener('contextmenu', this._contextMenu, true)

        this.onDisable()
        this.grid.removeFromParent()
        this.cameraPerspective.removeFromParent()
        this.cameraOrtho.removeFromParent()
        this.lightOverrider.viewer = null

        super.onRemove(viewer);
    }

    @onChange('setDirty')
    @uiToggle()
    @serialize()
    enableWASDMovement = true

    @onChange('setDirty')
    @uiNumber()
    @serialize()
    wasdMovementSpeed = 1

    // @onChange('setDirty')
    @uiNumber()
    @serialize()
    focusAnimDuration = 500

    _viewerListeners: PartialRecord<IViewerEventTypes, (e: IViewerEvent) => void> = {
        preFrame: (e)=> {
            if(this.isDisabled() || !this._viewer) return
            editorCameraController(this)

            this.lightOverrider.preFrame(this)

        }
    }

    keyMap: {[key: string]: boolean} = {}

    keyListeners: {
        keys: string[],
        metaKey?: boolean,
        ctrlKey?: boolean,
        shiftKey?: boolean,
        altKey?: boolean,
        onDown?: (event: KeyboardEvent)=>void,
        onUp?: (event: KeyboardEvent)=>void,
    }[] = [
        // delete object
        {
            keys: ['Backspace', 'Delete'],
            onDown: async (event: KeyboardEvent) => {
                if (this.isDisabled()) return
                const picking = this._viewer?.getPlugin(PickingPlugin)
                if (!picking) return
                const selected = picking.getSelectedObject()
                if (selected && (selected as IObject3D).isObject3D) {
                    if(!isExternalObject(selected as IObject3D)){
                        console.warn('Not allowed editing external object') // todo toast
                        return
                    }
                    event.preventDefault()
                    // await iObjectCommons.deleteObject((selected as IObject3D), event)
                    const undoMan = this._viewer?.getPlugin(UndoManagerPlugin)
                    if(!undoMan) {
                        console.error('Undo manager not found')
                        await iObjectCommons.deleteObject((selected as IObject3D), event)
                    }else {
                        undoMan.performAction(undefined, iObjectCommons.deleteObject, [(selected as IObject3D), event], 'delete_object')
                    }
                }
            }
        },
        // focus object
        {
            keys: ['f'],
            onDown: async (event: KeyboardEvent) => {
                if (this.isDisabled()) return
                const picking = this._viewer?.getPlugin(PickingPlugin)
                if (!picking) return
                const selected = picking.getSelectedObject() || this._viewer?.scene.modelRoot
                if (selected && (selected as IObject3D).isObject3D) {
                    event.preventDefault()
                    // await picking.focusObject((selected as IObject3D))
                    this._viewer?.fitToView(selected ?? undefined, 1.5, this.focusAnimDuration, 'linear')
                }
            }
        },
        // duplicate object
        {
            keys: ['d'],
            metaKey: true,
            onDown: async (event: KeyboardEvent) => {
                if (this.isDisabled()) return
                const picking = this._viewer?.getPlugin(PickingPlugin)
                if (!picking) return
                const selected = picking.getSelectedObject()
                if (selected && (selected as IObject3D).isObject3D) {
                    if(!isExternalObject(selected as IObject3D)){
                        console.warn('Not allowed editing external object') // todo toast
                        return
                    }
                    event.preventDefault()
                    const undoMan = this._viewer?.getPlugin(UndoManagerPlugin)
                    if(!undoMan) {
                        console.error('Undo manager not found')
                        ;(await iObjectCommons.duplicateObject((selected as IObject3D), event)).action()
                    }else {
                        undoMan.performAction(undefined, iObjectCommons.duplicateObject, [(selected as IObject3D), event], 'duplicate_object')
                    }
                }
            }
        }
    ]

    private _keyDown = (event: KeyboardEvent) => {
        if(!event.metaKey && !event.ctrlKey) {
            this.keyMap[event.key.toLowerCase()] = true
        }
    }

    private _keyDownGlobal = (event: KeyboardEvent) => {
        const target = event.target as HTMLElement
        if(target&&['INPUT','TEXTAREA','SELECT'].includes(target.tagName)) return
        if (this.isDisabled()) return;
        for (const kl of this.keyListeners) {
            if (kl.keys.map(k => k.toLowerCase()).includes(event.key.toLowerCase())) {
                if (kl.metaKey !== undefined && kl.metaKey !== event.metaKey) continue
                if (kl.ctrlKey !== undefined && kl.ctrlKey !== event.ctrlKey) continue
                if (kl.shiftKey !== undefined && kl.shiftKey !== event.shiftKey) continue
                if (kl.altKey !== undefined && kl.altKey !== event.altKey) continue
                kl.onDown && kl.onDown(event)
            }
        }
    }

    private _keyUp = (event: KeyboardEvent) => {
        // if(this.isDisabled()) return
        this.keyMap[event.key.toLowerCase()] = false
    }

    private _keyUpGlobal = (event: KeyboardEvent) => {
        const target = event.target as HTMLElement
        if(target&&['INPUT','TEXTAREA','SELECT'].includes(target.tagName)) return

        if (this.isDisabled()) return;
        for (const kl of this.keyListeners) {
            if (kl.keys.map(k => k.toLowerCase()).includes(event.key.toLowerCase())) {
                if (kl.metaKey !== undefined && kl.metaKey !== event.metaKey) continue
                if (kl.ctrlKey !== undefined && kl.ctrlKey !== event.ctrlKey) continue
                if (kl.shiftKey !== undefined && kl.shiftKey !== event.shiftKey) continue
                if (kl.altKey !== undefined && kl.altKey !== event.altKey) continue
                kl.onUp && kl.onUp(event)
            }
        }
    }

    private _pointerDown = (event: PointerEvent) => {
        // Mouse button mapping: 0 = left, 1 = middle, 2 = right, 3 = back, 4 = forward
        const button = `mouse${event.button}`
        this.keyMap[button] = true
    }

    private _pointerUp = (event: PointerEvent) => {
        const button = `mouse${event.button}`
        this.keyMap[button] = false
    }

    private _contextMenu = (event: MouseEvent) => {
        // Prevent context menu on right click if needed
        // Can be customized based on requirements
    }

    setDirty(): any {
        if(!this._viewer) return
        const enabled = !this.isDisabled()
        if(enabled !== this._lastEnabled){
            this._lastEnabled = !this._lastEnabled
            if(this._lastEnabled) this.onEnable()
            else this.onDisable()
        }
        if(enabled && this._viewer){
            // Only activate editor cameras, not scene cameras
            if(this.cameraMode === 'perspective' || this.cameraMode === 'orthographic') {
                const cam = this.cameraMode === 'perspective' ? this.cameraPerspective : this.cameraOrtho
                if(this._viewer.scene.mainCamera !== cam){
                    // this._viewer.scene.mainCamera = cam
                    if(cam === this.cameraPerspective && this._viewer.scene.mainCamera === this.cameraOrtho){
                        // switching from ortho to perspective, match position
                        this.cameraPerspective.position.copy(this.cameraOrtho.position)
                        this.cameraPerspective.target.copy(this.cameraOrtho.target)
                    } else if(cam === this.cameraOrtho && this._viewer.scene.mainCamera === this.cameraPerspective){
                        // switching from perspective to ortho, match position
                        this.cameraOrtho.position.copy(this.cameraPerspective.position)
                        this.cameraOrtho.target.copy(this.cameraPerspective.target)
                    }
                    cam.activateMain()
                    this.dispatchEvent({type: 'cameraChanged', camera: this.cameraMode})
                }
            }
        }
    }

    serializeWithViewer = false

    // @uiColor()
    // @serialize()
    // backgroundColor = new Color(0x3f3f3f)
    // backgroundColor = new Color(0x1e1e1e)

    private _settings: any = {}

    private _settingsSet = false

    fitView(){
        if(!this._viewer) return
        const camera = this.cameraMode === 'perspective' ? this.cameraPerspective : this.cameraOrtho
        const bbox = new Box3B().expandByObject(this._viewer.scene.modelRoot, false, true)
        const cameraZ = getFittingDistance(camera, bbox)
        const target = bbox.getCenter(new Vector3()) // world position
        // await this.animateToTarget(, center, duration, ease)
        // const direction = camera.getWorldDirection(new Vector3())
        const direction = new Vector3(0,0,-1)
        camera.target.copy(target)
        camera.position.copy(direction.multiplyScalar(-cameraZ * 1.5).add(camera.target))
        camera.setDirty({change: 'transform'})
    }
    resetView(){
        if(!this._viewer) return
        const camera = this.cameraMode === 'perspective' ? this.cameraPerspective : this.cameraOrtho
        camera.position.set(0,0,10)
        camera.target.set(0,0,0)
        camera.setDirty({change: 'transform'})
    }

    onEnable(){
        if(!this._viewer) return
        this._settingsSet = true

        this.lightOverrider.onEnable()

        // this._settings.sceneBackgroundColor = this._viewer.scene.backgroundColor?.clone() || null
        // this._viewer.scene.setBackgroundColor(this.backgroundColor)
        // this._settings.backgroundTonemap = this._viewer.scene.backgroundTonemap
        // this._viewer.scene.backgroundTonemap = false
        this._viewer.renderManager.renderPass.renderBackground = false
        this.grid.visible = true
        // this._settings.autoNearFarEnabled = this._viewer.scene.autoNearFarEnabled
        // this._viewer.scene.autoNearFarEnabled = false
        // this._settings.minNearPlane = this._viewer.scene.mainCamera.minNearPlane
        // this._viewer.scene.mainCamera.minNearPlane = 0.1
        // this._settings.maxFarPlane = this._viewer.scene.mainCamera.maxFarPlane
        // this._viewer.scene.mainCamera.maxFarPlane = 1000
        this._settings.viewerCursorStyle = this._viewer.canvas.style.cursor
        this._viewer.canvas.style.cursor = 'default' // todo prevent orbit controls etc from overriding it.

        // this._settings.sceneMainCamera = this._viewer.scene.mainCamera
        ;(this.cameraMode === 'perspective' ? this.cameraPerspective : this.cameraOrtho).activateMain()

        const controlProps = {
            enableDamping: false,
            minDistance: 0.5,
            maxDistance: 1000,
            zoomSpeed: 0.5,
            maxZoomSpeed: 0.5,
            autoPushTarget: true,
            autoPullTarget: false,
            rotateSpeed: 1,
        }

        Object.assign((this.cameraPerspective.controls as OrbitControls3), controlProps)
        Object.assign((this.cameraOrtho.controls as OrbitControls3), controlProps) // todo not working for ortho

        const picking = this._viewer.getPlugin(PickingPlugin)
        if(picking) {
            this._settings.pickingWidgetEnabled = picking.widgetEnabled
            picking.widgetEnabled = true
        }

        const editViewWidget = this._viewer.getPlugin(EditorViewWidgetPlugin)
        if(editViewWidget){
            editViewWidget.enabled = true
        }

        this.dispatchEvent({type: 'enableChanged'})
    }

    onDisable(){
        this.grid.visible = false
        if(!this._viewer) return
        if(!this._settingsSet) return
        this._settingsSet = false

        this.lightOverrider.onDisable()

        // this._viewer.scene.setBackgroundColor(this._settings.sceneBackgroundColor)
        // delete this._settings.sceneBackgroundColor
        // this._viewer.scene.backgroundTonemap = this._settings.backgroundTonemap
        // delete this._settings.backgroundTonemap
        this._viewer.renderManager.renderPass.renderBackground = true
        // this._viewer.scene.autoNearFarEnabled = this._settings.autoNearFarEnabled
        // delete this._settings.autoNearFarEnabled
        // this._viewer.scene.mainCamera.minNearPlane = this._settings.minNearPlane
        // delete this._settings.minNearPlane
        // this._viewer.scene.mainCamera.maxFarPlane = this._settings.maxFarPlane
        // delete this._settings.maxFarPlane
        this._viewer.canvas.style.cursor = this._settings.viewerCursorStyle
        delete this._settings.viewerCursorStyle
        this._viewer.scene.defaultCamera.activateMain()
        // delete this._settings.sceneMainCamera

        const controls = this._viewer.scene.mainCamera.controls as OrbitControls3|undefined
        if(typeof controls?.stopDamping === 'function')
            controls.stopDamping() // just in case

        const picking = this._viewer.getPlugin(PickingPlugin)
        if(picking) {
            picking.widgetEnabled = this._settings.pickingWidgetEnabled
            delete this._settings.pickingWidgetEnabled
        }
        const editViewWidget = this._viewer.getPlugin(EditorViewWidgetPlugin)
        if(editViewWidget){
            editViewWidget.enabled = false
        }

        this.dispatchEvent({type: 'enableChanged'})
    }

    toggleGrid = (_current: boolean, next: boolean)=>{
        if(!this._viewer) return next
        if(_current === next) return next
        this.grid.visible = next
        // @ts-ignore
        this.grid.setDirty()
        return next
    }

    get viewer(){
        return this._viewer
    }
    toggleBackgroundColor = (_current: boolean, next: boolean)=>{
        if(!this._viewer) return next
        if(_current === next) return next
        if(!next){
            // this._viewer.scene.setBackgroundColor(this.backgroundColor)
            this._viewer.renderManager.renderPass.renderBackground = false
        } else {
            // this._viewer.scene.setBackgroundColor(this._settings.sceneBackgroundColor)
            this._viewer.renderManager.renderPass.renderBackground = true
        }
        this._viewer.scene.setDirty()
        return next
    }

    /**
     * Set the camera mode to editor camera (perspective/orthographic) or scene camera (default or UUID)
     * @param cameraType - 'perspective', 'orthographic', 'default', or UUID string
     * Returns true if the camera was successfully activated
     */
    setCameraMode(cameraType: CameraType): boolean {
        if(!this._viewer || this.isDisabled()) return false

        // Handle editor cameras
        if (cameraType === 'perspective' || cameraType === 'orthographic') {
            this.cameraMode = cameraType
            this.setDirty()
            return true
        }

        // Handle scene cameras ('default' or UUID)
        let camera: IObject3D | null = null

        if (cameraType === 'default') {
            // Use scene.defaultCamera
            camera = this._viewer.scene.defaultCamera as IObject3D
        } else {
            // Find camera by UUID in the scene
            this._viewer.scene.modelRoot.traverse((obj: IObject3D) => {
                if (obj.uuid === cameraType && obj.isCamera) {
                    camera = obj
                }
            })
        }

        if (!camera || !camera.isCamera) return false

        // Activate the camera
        const activateMain = (camera as any).activateMain
        if (typeof activateMain === 'function') {
            activateMain.call(camera)
            this.cameraMode = cameraType // Store 'default' or UUID in cameraMode
            this.dispatchEvent({type: 'cameraChanged', camera: camera})
            return true
        }

        return false
    }


    /**
     * Get the currently active camera type
     * Returns 'perspective', 'orthographic', 'default', or the UUID of a scene camera
     */
    getActiveCameraType(): CameraType {
        if(!this._viewer) return this.cameraMode

        const mainCamera = this._viewer.scene.mainCamera

        if (mainCamera === this.cameraPerspective) {
            return 'perspective'
        } else if (mainCamera === this.cameraOrtho) {
            return 'orthographic'
        } else if (mainCamera === this._viewer.scene.defaultCamera) {
            return 'default'
        } else if (mainCamera) {
            // It's another scene camera
            return mainCamera.uuid
        }

        return this.cameraMode
    }

    /**
     * Check if currently using a scene camera (not editor cameras)
     */
    isUsingSceneCamera(): boolean {
        const type = this.getActiveCameraType()
        return type !== 'perspective' && type !== 'orthographic'
    }

}
