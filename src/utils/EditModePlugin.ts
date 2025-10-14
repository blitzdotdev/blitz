import {
    AViewerPluginSync,
    Box3B,
    Color,
    getFittingDistance,
    glsl,
    GridHelper,
    onChange,
    OrbitControls3,
    OrthographicCamera2,
    PerspectiveCamera2,
    PickingPlugin,
    serialize,
    ShaderMaterial,
    ThreeViewer,
    uiColor,
    Vector2,
    Vector3,
    Vector4,
} from "threepipe";

// just for edit mode settings and basic stuff, dont put project running state here.
export class EditModePlugin extends AViewerPluginSync{
    public static readonly PluginType = 'EditModePlugin';

    // todo disable this plugin when the scene config is being imported. use some hook
    @onChange('setDirty')
    enabled = true

    private _lastEnabled = false

    dependencies = [PickingPlugin]

    cameraPerspective = new PerspectiveCamera2('orbit')
    cameraOrtho = new OrthographicCamera2('orbit')

    @onChange('setDirty')
    cameraMode: 'perspective' | 'orthographic' = 'perspective'

    // grid = new Mesh(new PlaneGeometry(), new GridMaterial())
    grid = new GridHelper(100, 100, 0x62793a, 0x4e4f4f)

    constructor() {
        super();
        this._lastEnabled = this.enabled
        // this.grid.scale.set(1000,1000,1000)
        // this.grid.rotation.x = -Math.PI/2
        this.grid.visible = false
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

        this.cameraPerspective.position.set(0,0,10)
        this.cameraPerspective.target.set(0,0,0)
        this.cameraPerspective.userData.disableWidgets = true
        this.cameraPerspective.autoNearFar = false
        this.cameraPerspective.autoAspect = true
        this.cameraOrtho.position.set(0,0,10)
        this.cameraOrtho.target.set(0,0,0)
        this.cameraOrtho.frustumSize = 10
        this.cameraOrtho.userData.disableWidgets = true
        this.cameraOrtho.autoNearFar = false
        this.cameraOrtho.autoAspect = true
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer);

        const picking = viewer.getPlugin(PickingPlugin)!
        this.uiConfig = picking.uiConfig

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

        // todo fade the ground away from the camera.

    }

    onRemove(viewer: ThreeViewer) {

        this.onDisable()
        this.grid.removeFromParent()
        this.cameraPerspective.removeFromParent()
        this.cameraOrtho.removeFromParent()

        super.onRemove(viewer);
    }

    setDirty(): any {
        if(!this.isDisabled() !== this._lastEnabled){
            this._lastEnabled = !this._lastEnabled
            if(this._lastEnabled) this.onEnable()
            else this.onDisable()
        }
        if(!this.isDisabled()&&this._viewer){
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
            }
        }
    }

    serializeWithViewer = false

    @uiColor()
    @serialize()
    backgroundColor = new Color(0x3f3f3f)

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
        camera.setDirty({change: 'position'})
    }

    onEnable(){
        if(!this._viewer) return
        this._settingsSet = true
        this._settings.sceneBackgroundColor = this._viewer.scene.backgroundColor?.clone() || null
        this._viewer.scene.setBackgroundColor(this.backgroundColor)
        this._settings.backgroundTonemap = this._viewer.scene.backgroundTonemap
        this._viewer.scene.backgroundTonemap = false
        this.grid.visible = true
        // this._settings.autoNearFarEnabled = this._viewer.scene.autoNearFarEnabled
        // this._viewer.scene.autoNearFarEnabled = false
        // this._settings.minNearPlane = this._viewer.scene.mainCamera.minNearPlane
        // this._viewer.scene.mainCamera.minNearPlane = 0.1
        // this._settings.maxFarPlane = this._viewer.scene.mainCamera.maxFarPlane
        // this._viewer.scene.mainCamera.maxFarPlane = 1000
        this._settings.viewerCursorStyle = this._viewer.canvas.style.cursor
        this._viewer.canvas.style.cursor = 'default' // todo prevent orbit controls etc from overriding it.
        this._settings.sceneMainCamera = this._viewer.scene.mainCamera
        ;(this.cameraMode === 'perspective' ? this.cameraPerspective : this.cameraOrtho).activateMain()
        ;(this.cameraPerspective.controls as OrbitControls3).enableDamping = false
        ;(this.cameraOrtho.controls as OrbitControls3).enableDamping = false
    }

    onDisable(){
        this.grid.visible = false
        if(!this._viewer) return
        if(!this._settingsSet) return
        this._settingsSet = false
        this._viewer.scene.setBackgroundColor(this._settings.sceneBackgroundColor)
        delete this._settings.sceneBackgroundColor
        this._viewer.scene.backgroundTonemap = this._settings.backgroundTonemap
        delete this._settings.backgroundTonemap
        // this._viewer.scene.autoNearFarEnabled = this._settings.autoNearFarEnabled
        // delete this._settings.autoNearFarEnabled
        // this._viewer.scene.mainCamera.minNearPlane = this._settings.minNearPlane
        // delete this._settings.minNearPlane
        // this._viewer.scene.mainCamera.maxFarPlane = this._settings.maxFarPlane
        // delete this._settings.maxFarPlane
        this._viewer.canvas.style.cursor = this._settings.viewerCursorStyle
        delete this._settings.viewerCursorStyle
        this._settings.sceneMainCamera.activateMain()
        delete this._settings.sceneMainCamera

        const controls = this._viewer.scene.mainCamera.controls as OrbitControls3
        controls.stopDamping() // just in case
    }

    toggleGrid = (_current: boolean, next: boolean)=>{
        if(!this._viewer) return next
        if(_current === next) return next
        this.grid.visible = next
        // @ts-ignore
        this.grid.setDirty()
        return next
    }
    toggleBackgroundColor = (_current: boolean, next: boolean)=>{
        if(!this._viewer) return next
        if(_current === next) return next
        if(!next){
            this._viewer.scene.setBackgroundColor(this.backgroundColor)
        } else {
            this._viewer.scene.setBackgroundColor(this._settings.sceneBackgroundColor)
        }
        this._viewer.scene.setDirty()
        return next
    }
    toggleCameraMode = (_current: boolean, next: boolean)=>{
        if(_current === next) return next
        this.cameraMode = next ? 'orthographic' : 'perspective'
        this.setDirty()
        return next
    }
}

export class GridMaterial extends ShaderMaterial{
    constructor() {
        super({
            uniforms: {
                vSize: {value: new Vector2(100, 100)},
                color: {value: new Vector4(1, 1, 1, 1)},
                gridSize: {value: 1},
            },
            vertexShader: glsl`
                varying vec3 vWorldPosition;
                void main() {
                    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                    vWorldPosition = worldPosition.xyz;
                    gl_Position = projectionMatrix * viewMatrix * worldPosition;
                }
            `,
            // todo try this - https://discussions.unity.com/t/how-to-make-an-infinite-grid-that-becomes-transparent-as-its-getting-away-from-the-camera/683283/7
            fragmentShader: glsl`
                uniform vec4 color;
                uniform float gridSize;
                uniform vec2 vSize;
                varying vec3 vWorldPosition;
                void main() {
                    vec2 gridPos = mod(vWorldPosition.xz, gridSize);
                    float lineThickness = gridSize * 0.1;

                    // Calculate if we are on a line
                    float isLineX = 1. - step(0.0, mod(gridPos.x, gridSize) - lineThickness) - step(gridSize - lineThickness, mod(gridPos.x, gridSize));
                    float isLineY = 1. - step(0.0, mod(gridPos.y, gridSize) - lineThickness) - step(gridSize - lineThickness, mod(gridPos.y, gridSize));
                    float isLine = max(isLineX, isLineY);

                    vec3 gridColor = mix(color.xyz, vec3(0.0), isLine);
                    gl_FragColor = vec4(gridColor, isLine);
                    #include <colorspace_fragment>
                    
                }
            `,
        })
        this.transparent = true
    }
}
