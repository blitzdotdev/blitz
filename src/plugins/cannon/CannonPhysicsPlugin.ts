import {Body, ContactMaterial, Material as CannonMaterial, Shape, World} from "cannon-es"
import {
    AViewerPluginSync,
    EntityComponentPlugin,
    FrameFadePlugin, generateUUID,
    IObject3D,
    IViewerEvent,
    Matrix4,
    Object3DWidgetsPlugin,
    Quaternion,
    serialize,
    ThreeSerialization,
    ThreeViewer,
    TObject3DComponent,
    TypeSystem,
    uiConfig,
    uiFolderContainer, uiInput, uiMonitor, uiNumber,
    uiToggle,
    Vector3
} from "threepipe"
import {Cannon3DShapeComponent, Cannon3DShapeHelper} from "./Cannon3DShapeComponent.ts";
import {Cannon3DBodyComponent} from "./Cannon3DBodyComponent.ts";
import {CannonRagdollComponent} from "./CannonRagdollComponent.ts";

@uiFolderContainer('Cannon Material')
export class CannonMaterial2 extends CannonMaterial{
    @uiInput()
    declare name: string
    @uiMonitor()
    uuid: string = generateUUID()
    @uiNumber()
    declare friction
    @uiNumber()
    declare restitution
}
ThreeSerialization.MakeSerializable(CannonMaterial as any, 'CannonMaterial', ['friction', 'restitution']) // this is not needed actually, but just in case
ThreeSerialization.MakeSerializable(CannonMaterial2 as any, 'CannonMaterial', ['name', 'uuid', 'friction', 'restitution']) // this should be after CannonMaterial
ThreeSerialization.MakeSerializable(ContactMaterial as any, 'CannonContactMaterial', [/* 'materials', */'friction', 'restitution', 'contactEquationStiffness', 'contactEquationRelaxation', 'frictionEquationStiffness', 'frictionEquationRelaxation'])
TypeSystem.AddClass({
    key: 'CannonMaterial',
    getId(obj: CannonMaterial2) {
        return obj.uuid
    },
    getLabel(obj?: CannonMaterial2) {
        return obj ? obj.name : 'Cannon Material'
    },
    setName(obj: CannonMaterial2, name: string) {
        obj.name = name
    },
    ctor: CannonMaterial2,
})

// uses https://github.com/pmndrs/cannon-es

@uiFolderContainer('Physics')
export class CannonPhysicsPlugin extends AViewerPluginSync {
    public static readonly PluginType = 'CannonPhysicsPlugin'
    private _world: World = new World()
    get world() { return this._world }
    // dependencies: Class<IViewerPlugin<any>>[]

    @serialize()
    @uiToggle()
    enabled = true

    static CannonTypes = {
        Body, Shape, World, Material: CannonMaterial, ContactMaterial,
    }
    @uiToggle('Running', (_that: CannonPhysicsPlugin)=>({onChange: ()=>{return}}))
    running = true

    nextSteps = 0

    @uiConfig()
        stepPhysics: any = {
            stepCount: 100,
            delta: 0.1,
            step: () => {
                this.nextSteps = this.stepPhysics.stepCount
            },
        }

    @uiConfig()
    @serialize()
        defaultMaterial = new CannonMaterial2('default')

    // @uiButton('Make Root Bodies')
    //     makeRootBodies = () => {
    //         this._viewer?.scene.modelRoot.children.forEach((child) => {
    //             this.makeBody(child)
    //         })
    //     }

    // stepMultiple = () => {
    //     console.log(this.enabled, this.nextSteps)
    //     if (this.enabled) return
    //     this.nextSteps = 100
    //     // this.enabled = true
    //     // this._viewer?.doOnce('postFrame', () => {
    //     //     // Step the physics world
    //     //     for (let i = 0; i < 100; i++) {
    //     //         this._world.step(0.1)
    //     //     }
    //     //     // this._viewer?.doOnce('postFrame', () => {
    //     //     //     this.enabled = false
    //     //     // })
    //     // })
    //     // this._viewer?.setDirty()
    // }

    constructor(enabled = true, running = false) {
        super()
        this.enabled = enabled
        this.running = running

        // replaced for UI
        this.defaultMaterial.friction = 0
        this.defaultMaterial.restitution = 0
        this._world.defaultMaterial = this.defaultMaterial
        this._world.defaultContactMaterial.materials = [this.defaultMaterial, this.defaultMaterial]

        let collisionEv: CollisionEvent = {} as any
        this._world.addEventListener('beginContact', (e: any)=>{
            const compA = this.cannonBodies.get(e.bodyA)
            const compB = this.cannonBodies.get(e.bodyB)
            if(!compA || !compB){
                console.warn('[CannonPhysicsPlugin] Contact bodies not managed by plugin', e.bodyA, e.bodyB)
                return
            }
            collisionEv.object = compB.object
            collisionEv.body = compB
            EntityComponentPlugin.ObjectDispatch(compA.object, 'onBeginContact', collisionEv)
            collisionEv.object = compA.object
            collisionEv.body = compA
            EntityComponentPlugin.ObjectDispatch(compB.object, 'onBeginContact', collisionEv)
        })
        this._world.addEventListener('endContact', (e: any)=>{
            const compA = this.cannonBodies.get(e.bodyA)
            const compB = this.cannonBodies.get(e.bodyB)
            if(!compA || !compB){
                console.warn('[CannonPhysicsPlugin] Contact bodies not managed by plugin', e.bodyA, e.bodyB)
                return
            }
            collisionEv.object = compB.object
            collisionEv.body = compB
            EntityComponentPlugin.ObjectDispatch(compA.object, 'onEndContact', collisionEv)
            collisionEv.object = compA.object
            collisionEv.body = compA
            EntityComponentPlugin.ObjectDispatch(compB.object, 'onEndContact', collisionEv)
        })
        // this._world.addEventListener('beginShapeContact', (e)=>{
        //     console.log(e)
        // })
        // this._world.addEventListener('endShapeContact', (e)=>{
        //     console.log(e)
        // })
        // this._world.addEventListener(Body.COLLIDE_EVENT_NAME, (e)=>{
        //     console.log(e)
        // })
        this._world.gravity.set(0, -9.81, 0)
        // this._world.gravity.set(0, 0, 0)

        console.log(this.enabled)
        //
        // // Max solver iterations: Use more for better force propagation, but keep in mind that it's not very computationally cheap!
        // this._world.solver.iterations = 20
        //
        // // Tweak contact properties.
        // // Contact stiffness - use to make softer/harder contacts
        // this._world.defaultContactMaterial.contactEquationStiffness = 1e10
        // this._world.defaultContactMaterial.contactEquationRelaxation = 10
        //

        // coeff of restitution: 0 = no bounce, 1 = perfect bounce

        // test

        // const mat = new CannonMaterial('defaultMat')
        // mat.friction = 0.351
        // mat.restitution = 0.63
        // const contactMat = new ContactMaterial(mat, mat, {friction: 0.13, restitution: 0.563})
        //
        // const mjson = ThreeSerialization.Serialize(mat)
        // const mat2 = ThreeSerialization.Deserialize(mjson, null) as CannonMaterial
        // const mat3 = ThreeSerialization.Deserialize(mjson, mat) as CannonMaterial
        // console.log(mjson, mat2, mat3, mat3 === mat)
        //
        // const cmjson = ThreeSerialization.Serialize(contactMat)
        // const contactMat2 = ThreeSerialization.Deserialize(cmjson, null) as ContactMaterial
        // const contactMat3 = ThreeSerialization.Deserialize(cmjson, contactMat) as ContactMaterial
        // console.log(cmjson, contactMat2, contactMat3, contactMat3 === contactMat)

    }

    dependencies = [EntityComponentPlugin]

    // private _bodyMeshMap = new WeakMap<Body, Object3D>()

    private _v1 = new Vector3()
    private _v2 = new Vector3()
    private _s2 = new Vector3()
    private _q1 = new Quaternion()
    private _q2 = new Quaternion()
    private _m1 = new Matrix4()
    private _m2 = new Matrix4()
    frameFadeToggled = false

    protected _preFrame = (e: IViewerEvent) => {
        const viewer = this._viewer
        if (!viewer) return
        if(this.isDisabled()) return
        const frameFadePlugin = viewer.getPlugin(FrameFadePlugin)
        // todo use isDisabled
        if (!this.running) {
            if (this.nextSteps > 0) this.running = true
            else {
                if (frameFadePlugin && this.frameFadeToggled) {
                    frameFadePlugin.enable(CannonPhysicsPlugin.PluginType)
                    this.frameFadeToggled = false
                }
                this._dirty = false
                return
            }
        }
        if (frameFadePlugin && !this.frameFadeToggled) {
            frameFadePlugin.disable(CannonPhysicsPlugin.PluginType)
        }

        try {
            // Step the physics world
            if (this.nextSteps > 0) {
                for (let i = 0; i < this.stepPhysics.stepCount; i++) {
                    this._world.step(this.stepPhysics.delta)
                }
            } else {
                // todo use dt
                // const dt = e.deltaTime
                this._world.fixedStep()
            }
        }catch (e) {
            console.error('[CannonPhysicsPlugin] Error stepping physics world')
            console.error(e)
        }

        this._dirty = false
        let dirty = false
        // Update the bodies
        for (const bodyC of this.bodyComponents.values()) {
            if (bodyC.mass === 0) continue
            const mesh = bodyC.object
            const body = bodyC.body
            if (!mesh) continue
            dirty = false
            mesh.updateWorldMatrix(true, false)
            mesh.getWorldPosition(this._v2)
            mesh.getWorldQuaternion(this._q2)
            mesh.getWorldScale(this._s2)
            this._v1.copy(body.position)
            if (!dirty && this._v2.manhattanDistanceTo(this._v1) > 0) {
                dirty = true
                // world = parent.local
                // parent-1 . world = local
            }
            this._q1.copy(body.quaternion as any)
            if (!dirty && this._q2.angleTo(this._q1) > 0) {
                dirty = true
            }
            if (dirty) {
                this._m1.compose(this._v1, this._q1, this._s2)
                if (!mesh.parent) {
                    // throw new Error('no parent')
                    console.error('[CannonPhysicsPlugin] Mesh has no parent, cannot set world transform', mesh)
                }else {
                    this._m2.copy(mesh.parent.matrixWorld).invert()
                    this._m2.multiply(this._m1)
                    this._m2.decompose(this._v1, this._q1, this._s2)
                    mesh.position.copy(this._v1)
                    mesh.quaternion.copy(this._q1)
                    mesh.setDirty && mesh.setDirty({change: 'transform', source: 'CannonPhysicsPlugin'})
                }
            }
        }
        this._dirty = dirty
        viewer.setDirty()
        // viewer.scene.setDirty({sceneUpdate: false})
        viewer.renderManager.resetShadows()

        if (this.nextSteps > 0) {
            this.running = false
            this.nextSteps = 0
        }
    }

    private _onRemove: (()=>void)[] = []

    async onAdded(viewer: ThreeViewer): Promise<
        void> {
        super.onAdded(viewer)

        const offUpdate = viewer.on('preFrame', {
            order: -1, // before most things
            callback: this._preFrame,
        })
        if (offUpdate) this._onRemove.push(offUpdate)

        Object.values(this.componentTypes).forEach((compType) => {
            viewer.getPlugin(EntityComponentPlugin)?.addComponentType(compType)
        })

        viewer.object3dManager.getObjects().forEach(object=>this._objectAdd({object}))
        viewer.object3dManager.addEventListener('objectAdd', this._objectAdd)
        viewer.object3dManager.addEventListener('objectRemove', this._objectRemove)

        viewer.forPlugin(Object3DWidgetsPlugin, (wplugin) => {
            wplugin.helpers.push(Cannon3DShapeHelper)
        }, (wplugin)=>{
            const i = wplugin.helpers.indexOf(Cannon3DShapeHelper)
            if (i >= 0) wplugin.helpers.splice(i, 1)
        })

        // viewer.scene.addEventListener('update', (e) => {
        //     this._bodyMeshMap.forEach((mesh, body) => {
        //         body.velocity.set(0, 0, 0)
        //         body.angularVelocity.set(0, 0, 0)
        //     })
        // })
    }

    private _objectAdd = (e: {object?: IObject3D})=>{
        const obj = e.object
        // console.log('pbject add', obj?.name, obj?.userData, obj)
        if (obj?.userData?.physicsMass === undefined) return
        const ecs = this._viewer?.getPlugin(EntityComponentPlugin)
        if (!ecs) return
        const existing = EntityComponentPlugin.GetComponentData(obj, this.componentTypes.body)
        if (existing) return
        // const pBody = ecs.addComponent(obj, this.componentTypes.body).component
        // const pShape = ecs.addComponent(obj, this.componentTypes.shape).component
        // if (!pBody || !pShape) return
        // pBody.mass = typeof obj.userData.physicsMass === 'number' ? obj.userData.physicsMass : 0
        // if (obj.userData.physicsBodyType !== undefined) {
        //     if (typeof obj.userData.physicsBodyType === 'string' && physicsBodyType.includes(obj.userData.physicsBodyType as PhysicsBodyType)) {
        //         pBody.type = obj.userData.physicsBodyType as PhysicsBodyType
        //     }
        // }
        // if (obj.userData.physicsShape !== undefined) {
        //     if (typeof obj.userData.physicsShape === 'string' && cannonShapeTypes.includes(obj.userData.physicsShape as CannonShapeType)) {
        //         pShape.type = obj.userData.physicsShape as CannonShapeType
        //     }
        // }
    }

    private _objectRemove = (e: {object?: IObject3D})=>{
        const obj = e.object
        if (!obj?.userData?.physicsMass === undefined) return

    }

    onRemove(viewer: ThreeViewer) {
        this._onRemove.forEach(off=>off())
        Object.values(this.componentTypes).forEach((compType) => {
            viewer.getPlugin(EntityComponentPlugin)?.removeComponentType(compType)
        })
        viewer.object3dManager.removeEventListener('objectAdd', this._objectAdd)
        viewer.object3dManager.removeEventListener('objectRemove', this._objectRemove)
        viewer.object3dManager.getObjects().forEach(object=>this._objectRemove({object}))

        // todo assert all bodies removed?

        super.onRemove(viewer)
    }

    readonly componentTypes = {
        body: Cannon3DBodyComponent,
        shape: Cannon3DShapeComponent,
        ragdoll: CannonRagdollComponent,
    } satisfies Record<string, TObject3DComponent>

    bodyComponents = new Set<Cannon3DBodyComponent>()
    cannonBodies = new WeakMap<Body, Cannon3DBodyComponent>()
    addBody(body: Cannon3DBodyComponent) {
        if (this.bodyComponents.has(body)) return
        this.bodyComponents.add(body)
        this._world.addBody(body.body)
        this.cannonBodies.set(body.body, body)
        // this._bodyMeshMap.set(body.body, body.object)
        // this._viewer?.setDirty()
    }
    removeBody(body: Cannon3DBodyComponent) {
        if (!this.bodyComponents.has(body)) return
        this.bodyComponents.delete(body)
        this._world.removeBody(body.body)
        this.cannonBodies.delete(body.body)
        // this._bodyMeshMap.delete(body.body)
        // this._viewer?.setDirty()
    }

}

export interface CollisionEvent{
    object: IObject3D
    body: Cannon3DBodyComponent
}
declare module 'threepipe'{
    interface Object3DComponent{
        onBeginContact?(collisionEvent: any):void
        onEndContact?(collisionEvent: any):void

    }
}
