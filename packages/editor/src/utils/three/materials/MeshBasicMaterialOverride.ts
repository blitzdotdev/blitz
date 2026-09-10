import {
    BufferGeometry,
    Camera,
    Group,
    IMaterial,
    Mesh,
    MeshBasicMaterial,
    PhysicalMaterial,
    Scene,
    WebGLRenderer
} from "threepipe";

export class MeshBasicMaterialOverride extends MeshBasicMaterial {

    constructor(parameters?: any) {
        super(parameters)
        this.reset()
    }

    onBeforeRender(renderer: WebGLRenderer, scene: Scene, camera: Camera, geometry: BufferGeometry, object: any, group: Group) {
        super.onBeforeRender(renderer, scene, camera, geometry, object, group)

        if (!object.material || !(object as Mesh).isMesh) {
            this.visible = false
            return
        }
        this.visible = true
        const material = object.material as IMaterial & Partial<PhysicalMaterial>

        // Copy color properties
        if (material.color !== undefined) this.color.copy(material.color)
        if (material.opacity !== undefined) this.opacity = material.opacity
        if (material.transparent !== undefined) this.transparent = material.transparent

        // Copy maps
        if (material.map !== undefined) this.map = material.map
        if (material.alphaMap !== undefined) this.alphaMap = material.alphaMap
        if (material.aoMap !== undefined) this.aoMap = material.aoMap
        if (material.aoMapIntensity !== undefined) this.aoMapIntensity = material.aoMapIntensity
        if (material.lightMap !== undefined) this.lightMap = material.lightMap
        if (material.lightMapIntensity !== undefined) this.lightMapIntensity = material.lightMapIntensity
        if (material.envMap !== undefined) this.envMap = material.envMap
        if (material.reflectivity !== undefined) this.reflectivity = material.reflectivity

        // Copy alpha test and hash
        if (material.alphaTest !== undefined) this.alphaTest = material.alphaTest < 1e-4 ? 1e-4 : material.alphaTest
        if (material.alphaHash !== undefined) this.alphaHash = material.alphaHash

        // Copy side and wireframe
        if (material.side !== undefined) this.side = material.side
        if (material.wireframe !== undefined) this.wireframe = material.wireframe
        if (material.wireframeLinewidth !== undefined) this.wireframeLinewidth = material.wireframeLinewidth

        // this.needsUpdate = true
        // this.id+=1 // to force update uniforms etc
        // @ts-ignore todo add to type
        renderer.resetCurrentMaterial && renderer.resetCurrentMaterial()
    }

    onAfterRender(renderer: WebGLRenderer, scene: Scene, camera: Camera, geometry: BufferGeometry, object: any, group: Group) {
        super.onAfterRender(renderer, scene, camera, geometry, object, group)
        this.reset()
    }

    reset() {
        this.visible = true
        this.color.setHex(0xffffff)
        this.opacity = 1
        this.transparent = false

        this.map = null
        this.alphaMap = null
        this.aoMap = null
        this.aoMapIntensity = 1
        this.lightMap = null
        this.lightMapIntensity = 1
        this.envMap = null
        this.reflectivity = 1

        this.alphaTest = 0
        // this.alphaHash = false

        this.side = 0 // FrontSide
        this.wireframe = false
        this.wireframeLinewidth = 1

        // this.combine = 0 // MultiplyOperation
    }
}
