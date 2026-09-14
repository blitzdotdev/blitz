import {
    BasicDepthPacking,
    Box3B,
    Color,
    MeshDepthMaterialOverride,
    MeshNormalMaterialOverride,
    NoBlending,
    Object3D,
    PerspectiveCamera2,
    ThreeViewer,
    Vector3
} from "threepipe";
import {MeshBasicMaterialOverride} from "./materials/MeshBasicMaterialOverride.ts";
import {MeshNormalMaterialWorldOverride} from "./materials/MeshNormalMaterialWorldOverride.ts";
import {MeshMaterialIdOverride} from "./materials/MeshMaterialIdOverride.ts";
import {MeshUVOverride} from "./materials/MeshUVOverride.ts";
import {overrideLightingPresets} from "./OverrideLightingPresets.ts";

// Type for override material types
export type OverrideMaterialType = 'basic' | 'depth' | 'normal' | 'normalWorld' | 'materialId' | 'uv';
export type SceneOverrideMaterial = MeshBasicMaterialOverride | MeshDepthMaterialOverride | MeshNormalMaterialOverride | MeshNormalMaterialWorldOverride | MeshMaterialIdOverride | MeshUVOverride

// Type for override lighting types - includes both light-based and environment-based presets
export type OverrideLightingType = OverrideLightingPreset

export type OverrideLightingPreset = keyof typeof overrideLightingPresets

export class LightMaterialOverrider {

    sceneOverrideMaterial: SceneOverrideMaterial | null = null
    private _sceneOverrideMaterialType: OverrideMaterialType | null = null

    private _sceneOverrideLightingType: OverrideLightingType | null = null
    private _originalLights: any[] = []
    private _originalEnvironment: any = null

    // Saved override states when plugin is disabled
    private _savedOverrideMaterialType: OverrideMaterialType | null = null
    private _savedOverrideLightingType: OverrideLightingType | null = null

    // Override materials - created once and reused
    private _overrideMaterials: Record<OverrideMaterialType, SceneOverrideMaterial>

    // Override lighting container
    overrideLightsContainer = new Object3D()

    constructor() {

        // Initialize override lights container
        this.overrideLightsContainer.name = 'EditMode Override Lights'
        this.overrideLightsContainer.visible = false

        // Initialize override materials once
        this._overrideMaterials = {
            basic: new MeshBasicMaterialOverride({
                color: new Color(0xaaaaaa),
            }),
            depth: new MeshDepthMaterialOverride({
                depthPacking: BasicDepthPacking,
                blending: NoBlending,
                transparent: true,
            }),
            normal: new MeshNormalMaterialOverride({
                blending: NoBlending,
            }),
            normalWorld: new MeshNormalMaterialWorldOverride({
                blending: NoBlending,
            }),
            materialId: new MeshMaterialIdOverride({}),
            uv: new MeshUVOverride({}),
        }
    }

    private _viewer: ThreeViewer | null = null
    // get viewer(){
    //     return this._viewer
    // }
    set viewer(v: ThreeViewer | null) {
        this._viewer = v
        if (v) v.scene.add(this.overrideLightsContainer)
        else this.overrideLightsContainer.removeFromParent()
    }

    setSceneOverrideMaterial(materialType?: OverrideMaterialType | null) {
        if (!this._viewer) return
        if (materialType) {
            if (this._sceneOverrideMaterialType !== materialType) {
                this._sceneOverrideMaterialType = materialType
                // Select the pre-created material based on type
                this.sceneOverrideMaterial = this._overrideMaterials[materialType]

                // Reset UV channel to 0 when first switching to UV material
                if (materialType === 'uv') {
                    (this.sceneOverrideMaterial as MeshUVOverride).uvChannel = 0
                }
            } else if (materialType === 'uv') {
                // If already on UV material, cycle through channels 0-3
                const uvMaterial = this.sceneOverrideMaterial as MeshUVOverride
                uvMaterial.uvChannel = ((uvMaterial.uvChannel + 1) % 4) as 0 | 1 | 2 | 3
                // Need to recompile shader for the channel change to take effect
                uvMaterial.needsUpdate = true
            }

            // Set the override material on the scene
            this._viewer.scene.overrideMaterial = this.sceneOverrideMaterial
        } else {
            // Clear the override material
            this._viewer.scene.overrideMaterial = null
            this._sceneOverrideMaterialType = null
            this.sceneOverrideMaterial = null
        }
        this._viewer.scene.setDirty()
    }

    async setSceneOverrideLighting(lightingType?: OverrideLightingType | null) {
        if (!this._viewer) return

        if (lightingType) {
            // Clear any existing override lights from container
            while (this.overrideLightsContainer.children.length > 0) {
                const child = this.overrideLightsContainer.children[0]
                this.overrideLightsContainer.remove(child)
                if ((child as any).dispose) (child as any).dispose()
            }

            // Save original state if not already saved
            if (this._sceneOverrideLightingType === null) {
                // Save original lights
                this._originalLights = []
                this._viewer.scene.traverse((obj: any) => {
                    if (obj.isLight) {
                        this._originalLights.push({
                            light: obj,
                            visible: obj.visible
                        })
                        obj.visible = false
                    }
                })

                // Save original environment
                this._originalEnvironment = this._viewer.scene.overrideRenderEnvironment
            }

            this._sceneOverrideLightingType = lightingType

            // Use the preset to create lights/environment
            const preset = overrideLightingPresets[lightingType]
            if (preset) {
                const result = await preset.create(this._viewer)

                // Set environment if provided
                if ('environment' in result) {
                    this._viewer.scene.overrideRenderEnvironment = result.environment
                } else {
                    // Clear any override environment if no environment in result
                    this._viewer.scene.overrideRenderEnvironment = null
                }

                // Add lights to container if provided
                if ('lights' in result && result.lights) {
                    result.lights.forEach(light => {
                        this.overrideLightsContainer.add(light)
                    })
                }
            }

            // Show the lights container
            this.overrideLightsContainer.visible = true
        } else {
            // Clear override lights from container
            while (this.overrideLightsContainer.children.length > 0) {
                const child = this.overrideLightsContainer.children[0]
                this.overrideLightsContainer.remove(child)
                if ((child as any).dispose) (child as any).dispose()
            }

            // Hide the container
            this.overrideLightsContainer.visible = false

            // Restore original lights
            this._originalLights.forEach(({light, visible}) => {
                light.visible = visible
            })
            this._originalLights = []

            // Restore original environment
            if (this._originalEnvironment !== null) {
                this._viewer.scene.overrideRenderEnvironment = this._originalEnvironment
                this._originalEnvironment = null
            }

            this._sceneOverrideLightingType = null
        }
        this._viewer.scene.setDirty()
    }

    onEnable() {
        // Restore any previously saved override states
        if (this._savedOverrideMaterialType) {
            this.setSceneOverrideMaterial(this._savedOverrideMaterialType)
            this._savedOverrideMaterialType = null
        }
        if (this._savedOverrideLightingType) {
            this.setSceneOverrideLighting(this._savedOverrideLightingType)
            this._savedOverrideLightingType = null
        }
    }

    onDisable() {

        // Save current override states before clearing
        this._savedOverrideMaterialType = this._sceneOverrideMaterialType
        this._savedOverrideLightingType = this._sceneOverrideLightingType

        // Clear any override material and lighting when disabling
        this.setSceneOverrideMaterial(null)
        this.setSceneOverrideLighting(null)

    }

    preFrame(plugin: {
        cameraPerspective: PerspectiveCamera2,
    }) {
        if (!this._viewer) return

        if (this._viewer.scene.mainCamera !== plugin.cameraPerspective) return
        if (this._sceneOverrideMaterialType === 'depth') {
            const bounds = new Box3B().expandByObject(this._viewer.scene.modelRoot, false, true)
            if (!bounds.isEmpty()) {
                const camera = plugin.cameraPerspective
                // const cameraPos = camera.position
                //
                // // Get camera forward direction (view direction)
                // const viewDir = new Vector3()
                // camera.getWorldDirection(viewDir)
                // viewDir.normalize()
                //
                // // Get all 8 corners of the bounding box
                // const corners = [
                //     new Vector3(bounds.min.x, bounds.min.y, bounds.min.z),
                //     new Vector3(bounds.min.x, bounds.min.y, bounds.max.z),
                //     new Vector3(bounds.min.x, bounds.max.y, bounds.min.z),
                //     new Vector3(bounds.min.x, bounds.max.y, bounds.max.z),
                //     new Vector3(bounds.max.x, bounds.min.y, bounds.min.z),
                //     new Vector3(bounds.max.x, bounds.min.y, bounds.max.z),
                //     new Vector3(bounds.max.x, bounds.max.y, bounds.min.z),
                //     new Vector3(bounds.max.x, bounds.max.y, bounds.max.z),
                // ]
                //
                // // Project each corner onto the camera's view axis to get depth
                // let minDepth = Infinity
                // let maxDepth = -Infinity
                // for (const corner of corners) {
                //     const toCorner = corner.clone().sub(cameraPos)
                //     // Project onto view direction to get depth along camera axis
                //     const depth = toCorner.dot(viewDir)
                //     minDepth = Math.min(minDepth, depth)
                //     maxDepth = Math.max(maxDepth, depth)
                // }
                //
                // // Handle edge cases when camera is inside or at edge of bounds
                // // If minDepth is negative, camera is inside/behind some geometry
                // const nearPlane = minDepth > 0. ? minDepth * 0.5 : 0.01
                // // If maxDepth is negative, all geometry is behind camera - use fallback
                // const farPlane = maxDepth > 0.1 ? maxDepth * 1.5 : Math.max(nearPlane * 2, 100)

                camera.near = 1
                camera.far = bounds.getSize(new Vector3()).length() * 1.5
                // console.log('Adjusted near/far:', nearPlane, farPlane)
                camera.updateProjectionMatrix()
            }
        } else {
            // reset to defaults
            const camera = plugin.cameraPerspective
            camera.near = 0.1
            camera.far = 1000
            camera.updateProjectionMatrix()
        }

    }

    dispose() {

        // Dispose all override materials
        Object.values(this._overrideMaterials).forEach(material => material.dispose())

    }
}
