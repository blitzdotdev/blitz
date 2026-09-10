import { Body, Vec3, Quaternion as CQuaternion } from "cannon-es"
import {
    ComponentDefn,
    ComponentJSON, EntityComponentPlugin,
    IObject3D,
    IObject3DEventMap,
    literalStrings,
    Object3DComponent, Quaternion, Vector3
} from "threepipe"
import {Cannon3DShapeComponent} from "./Cannon3DShapeComponent.ts";
import {CannonMaterial2, CannonPhysicsPlugin} from "./CannonPhysicsPlugin.ts";

export const physicsBodyType = ['static', 'dynamic', 'kinematic'] as const
export type PhysicsBodyType = typeof physicsBodyType[number]

export class Cannon3DBodyComponent extends Object3DComponent {
    static ComponentType = 'Cannon3DBodyComponent'
    static StateProperties: ComponentDefn['StateProperties'] = ['mass', {
        key: 'type',
        type: literalStrings(physicsBodyType),
    }, 'isTrigger', 'material']

    declare body: Body

    mass = 1
    type: PhysicsBodyType = 'dynamic'
    isTrigger = false
    material: CannonMaterial2 = new CannonMaterial2()

    private _typeToCannon(type: PhysicsBodyType) {
        if (type === 'static') return Body.STATIC
        else if (type === 'dynamic') return Body.DYNAMIC
        else if (type === 'kinematic') return Body.KINEMATIC
        return Body.STATIC
    }

    updateMassProperties(){
        if (!this.body) return
        try {
            this.body.updateMassProperties()
        }catch (e) {
            console.error('[Cannon3DBodyComponent] updateMassProperties error', e)
        }
    }
    updateBoundingRadius(){
        if (!this.body) return
        try {
            this.body.updateBoundingRadius()
        }catch (e) {
            console.error('[Cannon3DBodyComponent] updateBoundingRadius error', e)
        }
    }


    constructor() {
        super()
        this.onStateChange('mass', (v)=>{
            if (!this.body) return
            this.body.mass = v
            this.updateMassProperties()
            this.object.setDirty?.({source: 'Cannon3DBodyComponent'})
        })
        this.onStateChange('type', (v)=>{
            if (!this.body) return
            this.body.type = this._typeToCannon(v)
            this.updateMassProperties()
            this.object.setDirty?.({source: 'Cannon3DBodyComponent'})
        })
        this.onStateChange('isTrigger', (v)=>{
            if (!this.body) return
            this.body.isTrigger = v
            this.object.setDirty?.({source: 'Cannon3DBodyComponent'})
        })
        this.onStateChange('material', (v)=>{
            if (!this.body) return
            this.body.material = v
            this.uiConfig?.uiRefresh?.()
            this.object.setDirty?.({source: 'Cannon3DBodyComponent'})
        })
    }

    private _objectUpdate = (e: IObject3DEventMap['objectUpdate'])=>{
        if (e.source === 'Cannon3DBodyComponent' || e.source === 'CannonPhysicsPlugin') return
        const changeKey = e?.change ?? e?.key
        const update = !changeKey || changeKey === 'position' || changeKey === 'transform' || changeKey === 'quaternion'
        if (update) this.resetTransform(changeKey)
    }

    init(object: IObject3D, state: ComponentJSON['state']) {
        super.init(object, state)
        const cannon = this.ctx.plugin(CannonPhysicsPlugin)
        this.body = new Body()
        this.body.material = this.material
        this.body.mass = this.mass
        this.body.type = this._typeToCannon(this.type)
        this.body.isTrigger = this.isTrigger
        this.updateMassProperties()
        this.resetTransform()
        object.addEventListener('objectUpdate', this._objectUpdate)
        cannon.addBody(this)

        object.traverseModels && object.traverseModels(m=>{
            EntityComponentPlugin.GetComponents(m, Cannon3DShapeComponent).forEach(sh=>{
                this.addShape(sh, false)
            })
        }, {widgets: false, visible: false})
        if (this.shapeRefs.length) {
            this.refreshShapes()
        }

    }

    destroy(): Record<string, any> {
        this.shapeRefs.forEach(shape=>{
            this.removeShape(shape, false)
        })
        this.refreshShapes(false)

        this.object.removeEventListener('objectUpdate', this._objectUpdate)
        const cannon = this.ctx.plugin(CannonPhysicsPlugin)
        cannon.removeBody(this)
        this.body = null as any
        return super.destroy()
    }

    // update({time}: IAnimationLoopEvent) {
    //
    // }

    resetTransform(changeKey?: string) {
        // const changeKey = e?.change ?? e?.key
        if (!changeKey || changeKey === 'position' || changeKey === 'transform')
            this.body.position.set(...this.object.getWorldPosition(new Vector3()).toArray())
        if (!changeKey || changeKey === 'quaternion' || changeKey === 'transform')
            this.body.quaternion.set(...(this.object.getWorldQuaternion(new Quaternion()).toArray() as [number, number, number, number]))
        this.body.angularVelocity.set(0, 0, 0)
        this.body.velocity.set(0, 0, 0)
    }

    // static IsCompatible(_object: IObject3D) { return true }

    shapeRefs: Cannon3DShapeComponent[] = []
    addShape(shape: Cannon3DShapeComponent, refresh = true) {
        if (!this.shapeRefs.includes(shape)) {
            if (shape.bodyRef && shape.bodyRef !== this) {
                // ignore
                return
            }
            this.shapeRefs.push(shape)
            shape.bodyRef = this
            if (refresh) this.refreshShapes()
        }
    }
    removeShape(shape: Cannon3DShapeComponent, refresh = true) {
        const index = this.shapeRefs.indexOf(shape)
        if (index !== -1) {
            if (shape.bodyRef === this) shape.bodyRef = undefined
            this.shapeRefs.splice(index, 1)
            if (refresh) this.refreshShapes()
        }
    }
    refreshShapes(update = true) {
        let changed = false
        for (const s of this.body.shapes) {
            if (!this.shapeRefs.find(sh=>sh.result.shape === s)) {
                const index = this.body.shapes.indexOf(s)
                if (index !== -1) {
                    this.body.shapes.splice(index, 1)
                    this.body.shapeOffsets.splice(index, 1)
                    this.body.shapeOrientations.splice(index, 1)
                    s.body = null
                    changed = true
                }
            }
        }
        const bodyObj = this.object
        bodyObj.updateMatrixWorld(true)
        const bodyWorldPos = bodyObj.getWorldPosition(new Vector3())
        const bodyWorldQuat = bodyObj.getWorldQuaternion(new Quaternion())
        for (const s of this.shapeRefs) {
            // s.bodyRef = this
            if (!this.body.shapes.includes(s.result.shape)) {
                const shape = s.result.shape
                this.body.shapes.push(shape)
                const offset = new Vec3()
                const quat = new CQuaternion()
                if(s.result.offset){
                    offset.x += s.result.offset.x
                    offset.y += s.result.offset.y
                    offset.z += s.result.offset.z
                }
                if(s.result.orientation){
                    quat.x = s.result.orientation.x
                    quat.y = s.result.orientation.y
                    quat.z = s.result.orientation.z
                    quat.w = s.result.orientation.w
                }
                const shapeObj = s.object
                if(bodyObj !== shapeObj){
                    shapeObj.updateMatrixWorld(true)
                    const worldPos = shapeObj.getWorldPosition(new Vector3())
                    offset.x += worldPos.x - bodyWorldPos.x
                    offset.y += worldPos.y - bodyWorldPos.y
                    offset.z += worldPos.z - bodyWorldPos.z
                    const worldQuat = shapeObj.getWorldQuaternion(new Quaternion())
                    const relQuat = worldQuat.multiply(bodyWorldQuat.invert())
                    // todo we need to multiply here
                    quat.x = relQuat.x
                    quat.y = relQuat.y
                    quat.z = relQuat.z
                    quat.w = relQuat.w
                }
                this.body.shapeOffsets.push(offset)
                this.body.shapeOrientations.push(quat)
                shape.body = this.body
                changed = true
            }
        }
        if (update && changed) {
            this.updateMassProperties()
            this.updateBoundingRadius()

            this.body.aabbNeedsUpdate = true
            this.object.setDirty?.({source: 'Cannon3DBodyComponent'})
        }
    }
}
