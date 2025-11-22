import {
    AHelperWidget,
    ComponentDefn,
    ComponentJSON,
    EntityComponentPlugin, Group,
    IMaterial,
    IObject3D,
    literalStrings,
    Mesh,
    Object3DComponent, Object3DWidgetsPlugin,
    PartialRecord
} from "threepipe"
import {getShapeParameters, ShapeParameters, ShapeResult, ShapeType, threeToCannon} from "./threeToCannon"
import {Box, Quaternion as CQuaternion, Shape, Vec3} from "cannon-es"
import {Cannon3DBodyComponent} from "./Cannon3DBodyComponent.ts";
import {CannonDebugger} from "./helper.ts";

export const typeToCannon = {
    autoBox: ShapeType.BOX,
    autoCylinder: ShapeType.CYLINDER,
    autoSphere: ShapeType.SPHERE,
    autoConvex: ShapeType.HULL,
    autoTrimesh: ShapeType.MESH,
    box: ShapeType.BOX,
    sphere: ShapeType.SPHERE,
    cylinder: ShapeType.CYLINDER,
    convex: ShapeType.HULL,
    trimesh: ShapeType.MESH,
    // plane: ShapeType.PLANE,
} as const

export type CannonShapeType = keyof typeof typeToCannon

export const cannonShapeTypes = Object.keys(typeToCannon) as CannonShapeType[]

export const cannonShapeTypeParams: PartialRecord<CannonShapeType, ShapeParameters['params']> = {
    box: {x: 1, y: 1, z: 1},
    sphere: {radius: 1},
    cylinder: {radiusTop: 1, radiusBottom: 1, height: 1, segments: 8},
    convex: {vertices: new Float32Array([1, 1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1, 0, 0, -1]), faces: [[0, 1, 2, 3], [4, 0, 3], [4, 3, 2], [4, 2, 1], [4, 1, 0]]},
    trimesh: {vertices: new Float32Array([1, 1, 1, -1, -1, 1, -1, 1, -1, 1, -1, -1]), indices: new Uint32Array([0, 1, 2, 0, 3, 1, 0, 2, 3, 1, 3, 2])},
    // not for auto
}

export class Cannon3DShapeComponent extends Object3DComponent {
    static ComponentType = 'Cannon3DShapeComponent'
    static StateProperties: ComponentDefn['StateProperties'] = [{
        key: 'type',
        type: literalStrings(cannonShapeTypes),
    }]
    static EmptyResult: ShapeResult = {shape: new Box(new Vec3(0.025, 0.025, 0.025))}

    result: ShapeResult = Cannon3DShapeComponent.EmptyResult
    bodyRef: Cannon3DBodyComponent | undefined
    type: CannonShapeType = 'autoBox'
    params: ShapeParameters | null = null

    constructor() {
        super()
        this.onStateChange('type', () => {
            // const shapeType = typeToCannon[this.shapeType]
            const params = cannonShapeTypeParams[this.type]
            if (params) {
                const params1 = {}
                Object.entries(params).forEach(([k, v]) => {
                    (params1 as any)[k] = (v as Array<any>).slice ? (v as Array<any>).slice() : v
                })
                this.params = {
                    type: typeToCannon[this.type],
                    params: params1 as any,
                    offset: new Vec3(),
                    orientation: new CQuaternion(),
                }
            } else {
                this.params = null
            }
            if (!this.object) return
            this.refreshShape()
        })
    }

    // static IsCompatible(_object: IObject3D) { return true }

    init(object: IObject3D, state: ComponentJSON['state']) {
        super.init(object, state)
        this.refreshShape(false)
        const body = EntityComponentPlugin.GetComponentInParent(object, Cannon3DBodyComponent)
        if (!body) {
            // console.warn('Cannon3DShapeComponent: No Cannon3DBodyComponent found in parent hierarchy')
        } else {
            body.addShape(this)
        }
        this.object.addEventListener('objectUpdate', this.objectUpdate)
        this.object.addEventListener('childadded', this.childadded)
        this.object.addEventListener('childremoved', this.childremoved)
        this.ctx.viewer.addEventListener('preFrame', this.preFrame)
    }

    destroy(): Record<string, any> {
        if (this.bodyRef) {
            this.bodyRef.removeShape(this, false)
            this.bodyRef = undefined
        }
        this.object.removeEventListener('objectUpdate', this.objectUpdate)
        this.ctx.viewer.removeEventListener('preFrame', this.preFrame)
        this.result = Cannon3DShapeComponent.EmptyResult
        return super.destroy()
    }

    refreshShape(refreshBody = true) {
        // todo auto refresh on geometry or hierarchy changed if set to auto
        if (!this.object.__cannonShapes) this.object.__cannonShapes = []

        if(this.result){
            const index = this.object.__cannonShapes.indexOf(this.result)
            if(index !== -1) this.object.__cannonShapes.splice(index, 1)
        }

        const shapeType = typeToCannon[this.type]
        const shapeParameters = this.params ?? (shapeType ? getShapeParameters(this.object, {type: shapeType}) : null)

        // console.log('shapeParameters', shapeParameters)
        if (shapeParameters) {
            this.result = threeToCannon(this.object, undefined, shapeParameters)!
        } else {
            this.result = Cannon3DShapeComponent.EmptyResult
        }

        if (!this.object.__cannonShapes.includes(this.result)) this.object.__cannonShapes.push(this.result)

        if (refreshBody && this.bodyRef) this.bodyRef.refreshShapes()

        this.object.setDirty?.()
        this.ctx.plugin(Object3DWidgetsPlugin)?.refreshObject(this.object)
    }

    private _needsUpdate = false
    objectUpdate = (e: any)=>{
    }

    childadded = (e: any)=>{
        this._needsUpdate = true
        e.child.addEventListener('objectUpdate', this.objectUpdate)
        e.child.addEventListener('childadded', this.childadded)
        e.child.addEventListener('childremoved', this.childremoved)
        // console.log('childadded', {...e})
    }
    childremoved = (e: any)=>{
        this._needsUpdate = true
        e.child.removeEventListener('objectUpdate', this.objectUpdate)
        e.child.removeEventListener('childadded', this.childadded)
        e.child.removeEventListener('childremoved', this.childremoved)
        // console.log('childremoved', {...e})
    }

    preFrame = ()=>{
        if(this._needsUpdate){
            this._needsUpdate = false
            this.refreshShape()
        }
    }
}

export class Cannon3DShapeHelper extends AHelperWidget {
    autoUpgradeChildren = false // used elsewhere
    private _shapes: ShapeResult[] = []
    private _meshes = new WeakMap<Shape, Mesh>()
    declare object: IObject3D | undefined

    private _gp = new Group()
    constructor(object: IObject3D) {
        super(object, false)

        this.attach(object)
        this.add(this._gp)
        this.visible = false
    }

    update() {
        super.update()

        this._gp.scale.setFromMatrixScale(this.matrixWorld)
        this._gp.scale.set(
            1./this._gp.scale.x,
            1./this._gp.scale.y,
            1./this._gp.scale.z
        )

        const shapes = (this.object?.__cannonShapes || []) as ShapeResult[]
        const added = shapes.filter(s => !this._shapes.includes(s))
        const removed = this._shapes.filter(s => !shapes.includes(s))
        if (!added.length && !removed.length) return

        for (const shape of removed) {
            const mesh = this._meshes.get(shape.shape)
            if (mesh) {
                this._gp.remove(mesh)
                mesh.geometry.dispose()
                ;(mesh.material as IMaterial).dispose()
                this._meshes.delete(shape.shape)
            }
        }
        this._shapes = []
        for (const shape of shapes) {
            const current = this._meshes.get(shape.shape)
            // update
            const mesh = CannonDebugger.updateMesh(current, shape.shape)
            if (mesh !== current && mesh) {
                this._gp.add(mesh)
                if (current) {
                    current.removeFromParent()
                    current.geometry.dispose()
                    ;(current.material as IMaterial).dispose()
                }
                this._meshes.set(shape.shape, mesh)
            }
            if(mesh){
                if(shape.offset){
                    mesh.position.set(shape.offset.x, shape.offset.y, shape.offset.z)
                }
                if(shape.orientation){
                    mesh.quaternion.set(shape.orientation.x, shape.orientation.y, shape.orientation.z, shape.orientation.w)
                }
            }
            this._shapes.push(shape)
        }

    }

    dispose() {
        this._shapes = []
        this.children.forEach(c => {
            if (c instanceof Mesh) {
                c.geometry.dispose()
                ;(c.material as IMaterial).dispose()
            }
        })
        super.dispose()
    }

    static Check(obj: IObject3D) {
        return !!EntityComponentPlugin.GetComponentData(obj, Cannon3DShapeComponent)
    }

    static Create(obj: IObject3D) {
        return new Cannon3DShapeHelper(obj as any)
    }
}

declare module 'threepipe' {
    interface IObject3D{
        /**
         * Shapes associated with this object
         * @internal - for cannon js physics
         */
        ['__cannonShapes']?: ShapeResult[]
    }
}
