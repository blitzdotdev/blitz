import {
    BufferGeometry,
    Camera,
    Color,
    Group,
    IMaterial,
    Mesh,
    MeshBasicMaterial,
    MeshBasicMaterialParameters,
    Object3D,
    PhysicalMaterial,
    Scene,
    WebGLRenderer
} from "threepipe";

export class MeshMaterialIdOverride extends MeshBasicMaterial {
    private _colorCache: Map<number, Color> = new Map()

    constructor(parameters?: MeshBasicMaterialParameters) {
        super(parameters)
        this.reset()
    }

    // Generate a consistent color based on material ID
    private _getColorForId(id: number): Color {
        if (!this._colorCache.has(id)) {
            // Use golden ratio to get well-distributed hues
            const goldenRatioConjugate = 0.618033988749895
            const hue = (id * goldenRatioConjugate) % 1.0
            const saturation = 1
            const lightness = 0.5

            const color = new Color()
            color.setHSL(hue, saturation, lightness)
            this._colorCache.set(id, color)
        }
        return this._colorCache.get(id)!
    }

    onBeforeRender(renderer: WebGLRenderer, scene: Scene, camera: Camera, geometry: BufferGeometry, object: Object3D, group: Group) {
        super.onBeforeRender(renderer, scene, camera, geometry, object, group)

        const mesh = object as Mesh
        if (!mesh.material || !mesh.isMesh) {
            this.visible = false
            return
        }
        this.visible = true
        const material = mesh.material as IMaterial & Partial<PhysicalMaterial>

        // Set color based on material ID
        const materialId = material.id ?? 0
        this.color.copy(this._getColorForId(materialId))

        // Copy opacity and transparency
        if (material.opacity !== undefined) this.opacity = material.opacity
        if (material.transparent !== undefined) this.transparent = material.transparent

        // Copy maps for alpha testing
        if (material.alphaMap !== undefined) this.alphaMap = material.alphaMap
        if (material.alphaTest !== undefined) this.alphaTest = material.alphaTest < 1e-4 ? 1e-4 : material.alphaTest
        if (material.alphaHash !== undefined) this.alphaHash = material.alphaHash

        // Copy side and wireframe
        if (material.side !== undefined) this.side = material.side
        if (material.wireframe !== undefined) this.wireframe = material.wireframe
        if (material.wireframeLinewidth !== undefined) this.wireframeLinewidth = material.wireframeLinewidth

        // @ts-expect-error resetCurrentMaterial is provided by the modified three.js renderer.
        renderer.resetCurrentMaterial && renderer.resetCurrentMaterial()
    }

    onAfterRender(renderer: WebGLRenderer, scene: Scene, camera: Camera, geometry: BufferGeometry, object: Object3D, group: Group) {
        super.onAfterRender(renderer, scene, camera, geometry, object, group)
        this.reset()
    }

    reset() {
        this.visible = true
        this.color.setHex(0xffffff)
        this.opacity = 1
        this.transparent = false

        this.alphaMap = null
        this.alphaTest = 0

        this.side = 0 // FrontSide
        this.wireframe = false
        this.wireframeLinewidth = 1
    }
}
