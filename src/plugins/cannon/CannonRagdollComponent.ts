import { Body, Box, ConeTwistConstraint, Constraint, Sphere, Vec3 } from "cannon-es"
import {
    BoxGeometry,
    Bone,
    ComponentDefn,
    ComponentJSON,
    IObject3D,
    Mesh,
    MeshStandardMaterial,
    Object3D,
    Object3DComponent,
    Quaternion,
    SkinnedMesh,
    SphereGeometry,
    uiFolderContainer,
    Vector3,
    ViewerEventMap
} from "threepipe"
import { CannonMaterial2, CannonPhysicsPlugin } from "./CannonPhysicsPlugin.ts"

export interface RagdollConfig {
    scale: number
    angle: number
    angleShoulders: number
    twistAngle: number
}

export interface RagdollParts {
    lowerLeftLeg: Body
    lowerRightLeg: Body
    upperLeftLeg: Body
    upperRightLeg: Body
    pelvis: Body
    upperBody: Body
    head: Body
    upperLeftArm: Body
    upperRightArm: Body
    lowerLeftArm: Body
    lowerRightArm: Body
}

export interface RagdollConstraints {
    neckJoint: ConeTwistConstraint
    leftKneeJoint: ConeTwistConstraint
    rightKneeJoint: ConeTwistConstraint
    leftHipJoint: ConeTwistConstraint
    rightHipJoint: ConeTwistConstraint
    spineJoint: ConeTwistConstraint
    leftShoulder: ConeTwistConstraint
    rightShoulder: ConeTwistConstraint
    leftElbowJoint: ConeTwistConstraint
    rightElbowJoint: ConeTwistConstraint
}

@uiFolderContainer('Ragdoll')
export class CannonRagdollComponent extends Object3DComponent {
    static ComponentType = 'CannonRagdollComponent'
    static StateProperties: ComponentDefn['StateProperties'] = [
        'scale',
        'angle',
        'angleShoulders',
        'twistAngle',
        'mass',
        'autoCreateOnInit',
        'hideRagdollMeshes'
    ]

    scale = 1

    angle = Math.PI / 4

    angleShoulders = Math.PI / 3

    twistAngle = Math.PI / 8

    mass = 1

    /** If true, creates ragdoll bodies on init. If false, waits for activate() call */
    autoCreateOnInit = true

    /** If true, hides the debug ragdoll meshes (useful when using with character model) */
    hideRagdollMeshes = false

    material: CannonMaterial2 = new CannonMaterial2()

    private _bodies: Body[] = []
    private _constraints: Constraint[] = []
    private _parts: RagdollParts | null = null
    private _ragdollConstraints: RagdollConstraints | null = null
    private _cannon: CannonPhysicsPlugin | null = null

    // Visual meshes
    private _meshes: Mesh[] = []
    private _meshContainer: Object3D | null = null
    private _visualMaterial: MeshStandardMaterial | null = null
    private _lastObjectPosition = new Vector3()
    private _lastObjectQuaternion = new Quaternion()
    private _initialized = false

    // Ragdoll state
    private _isActive = false
    private _characterMeshes: SkinnedMesh[] = []
    private _boneMap: Map<string, Bone> = new Map()

    // Store initial bone transforms (bind pose) and initial ragdoll body transforms
    private _initialBoneQuats: Map<string, Quaternion> = new Map()
    private _initialBoneWorldQuats: Map<string, Quaternion> = new Map()
    private _initialBodyQuats: Map<Body, Quaternion> = new Map()

    // Bone name mappings (common Mixamo bone names)
    private _boneNames = {
        head: ['Head', 'mixamorigHead', 'head'],
        neck: ['Neck', 'mixamorigNeck', 'neck'],
        spine: ['Spine', 'mixamorigSpine', 'spine'],
        spine1: ['Spine1', 'mixamorigSpine1', 'spine1'],
        spine2: ['Spine2', 'mixamorigSpine2', 'spine2'],
        hips: ['Hips', 'mixamorigHips', 'hips', 'pelvis'],
        leftUpLeg: ['LeftUpLeg', 'mixamorigLeftUpLeg', 'left_upper_leg', 'LeftThigh'],
        rightUpLeg: ['RightUpLeg', 'mixamorigRightUpLeg', 'right_upper_leg', 'RightThigh'],
        leftLeg: ['LeftLeg', 'mixamorigLeftLeg', 'left_lower_leg', 'LeftShin'],
        rightLeg: ['RightLeg', 'mixamorigRightLeg', 'right_lower_leg', 'RightShin'],
        leftArm: ['LeftArm', 'mixamorigLeftArm', 'left_upper_arm', 'LeftShoulder'],
        rightArm: ['RightArm', 'mixamorigRightArm', 'right_upper_arm', 'RightShoulder'],
        leftForeArm: ['LeftForeArm', 'mixamorigLeftForeArm', 'left_lower_arm', 'LeftElbow'],
        rightForeArm: ['RightForeArm', 'mixamorigRightForeArm', 'right_lower_arm', 'RightElbow'],
    }

    // Reusable temp objects for transform calculations
    private _currentObjectPosition = new Vector3()
    private _currentObjectQuaternion = new Quaternion()
    private _deltaQuaternion = new Quaternion()
    private _invLastQuaternion = new Quaternion()
    private _tempVec3 = new Vector3()
    private _pivotPoint = new Vector3()
    private _tempWorldPos = new Vector3()
    private _tempWorldQuat = new Quaternion()

    get bodies(): Body[] {
        return this._bodies
    }

    get constraints(): Constraint[] {
        return this._constraints
    }

    get parts(): RagdollParts | null {
        return this._parts
    }

    get ragdollConstraints(): RagdollConstraints | null {
        return this._ragdollConstraints
    }

    /** Returns true if ragdoll physics is currently active */
    get isActive(): boolean {
        return this._isActive
    }

    constructor() {
        super()
        this.onStateChange('scale', () => this._recreateRagdoll())
        this.onStateChange('angle', () => this._updateConstraints())
        this.onStateChange('angleShoulders', () => this._updateConstraints())
        this.onStateChange('twistAngle', () => this._updateConstraints())
        this.onStateChange('mass', () => this._updateMass())
        this.onStateChange('hideRagdollMeshes', () => this._updateMeshVisibility())
    }

    init(object: IObject3D, state: ComponentJSON['state']) {
        super.init(object, state)
        this._cannon = this.ctx.plugin(CannonPhysicsPlugin)

        // Clean up any existing ragdoll first
        this._removeRagdoll()

        // Create visual material
        if (!this._visualMaterial) {
            this._visualMaterial = new MeshStandardMaterial({ color: 0x888888 })
        }

        // Create container for meshes in the scene (not the object, to avoid saving)
        if (!this._meshContainer) {
            this._meshContainer = new Object3D()
            this._meshContainer.name = `RagdollMeshes_${this.object.uuid}`
            // Add to scene instead of object to prevent serialization
            this.ctx.viewer?.scene.add(this._meshContainer)
        }

        // Find character meshes and build bone map
        this._findCharacterMeshes()
        this._buildBoneMap()

        if (this.autoCreateOnInit) {
            this._createRagdoll()
            // Start deactivated - bodies are kinematic until activated
            this._deactivateBodies()
        }

        this._updateMeshVisibility()
    }

    destroy(): Record<string, any> {
        this._removeRagdoll()

        // Remove mesh container from scene
        if (this._meshContainer) {
            this.ctx.viewer?.scene.remove(this._meshContainer)
            this._meshContainer = null
        }

        // Dispose material
        if (this._visualMaterial) {
            this._visualMaterial.dispose()
            this._visualMaterial = null
        }

        this._cannon = null
        return super.destroy()
    }

    // Called automatically by the component system each frame
    preFrame(_event: ViewerEventMap["preFrame"]): void {
        if (this._isActive) {
            // When ragdoll is active, sync bones to follow ragdoll bodies
            this._syncRagdollToBones()
        } else {
            // When not active, sync ragdoll to follow object transform
            this._syncObjectPosition()
        }
        this._updateMeshes()
    }

    /**
     * Syncs the character's bones to match the ragdoll body positions/rotations.
     * Called each frame when ragdoll is active.
     *
     * The approach:
     * 1. Calculate how much the ragdoll body has rotated in world space (delta from initial)
     * 2. Apply that same world-space delta to the bone's initial world orientation
     * 3. Convert the new world orientation back to local space for the bone
     *
     * Note: Only the root bone (hips) gets position updates. Other bones only get rotation updates
     * because in a skeleton hierarchy, bone positions are fixed (defined by bone length).
     */
    private _syncRagdollToBones() {
        if (!this._parts || this._characterMeshes.length === 0) return

        // Helper to sync a bone's rotation to a ragdoll body
        const syncBoneRotation = (body: Body, boneNames: string[]) => {
            const bone = this._findBone(boneNames)
            if (!bone) return

            const boneName = bone.name

            // Get stored initial values
            const initialBodyQuat = this._initialBodyQuats.get(body)
            const initialBoneWorldQuat = this._initialBoneWorldQuats.get(boneName)

            if (!initialBodyQuat || !initialBoneWorldQuat) {
                return
            }

            // Get the body's current world quaternion
            const currentBodyQuat = new Quaternion(
                body.quaternion.x,
                body.quaternion.y,
                body.quaternion.z,
                body.quaternion.w
            )

            // Calculate delta rotation in world space: how much has the body rotated?
            // deltaQuat = currentBodyQuat * inverse(initialBodyQuat)
            const initialBodyQuatInverse = initialBodyQuat.clone().invert()
            const worldDeltaQuat = currentBodyQuat.clone().multiply(initialBodyQuatInverse)

            // Apply world delta to the bone's initial world orientation
            // newBoneWorldQuat = worldDeltaQuat * initialBoneWorldQuat
            const newBoneWorldQuat = worldDeltaQuat.clone().multiply(initialBoneWorldQuat)

            // Convert new world quaternion to local space
            if (bone.parent) {
                // Get parent's current world quaternion
                const parentWorldQuat = new Quaternion()
                bone.parent.getWorldQuaternion(parentWorldQuat)

                // localQuat = inverse(parentWorldQuat) * newBoneWorldQuat
                const parentWorldQuatInverse = parentWorldQuat.clone().invert()
                const newLocalQuat = parentWorldQuatInverse.clone().multiply(newBoneWorldQuat)

                bone.quaternion.copy(newLocalQuat)
            } else {
                // No parent, world = local
                bone.quaternion.copy(newBoneWorldQuat)
            }
        }

        // Sync root bone (hips) - this one gets both position and rotation
        const hipsBone = this._findBone(this._boneNames.hips)
        if (hipsBone && this._parts.pelvis) {
            // Position: only the root bone should move in world space
            this._tempWorldPos.set(
                this._parts.pelvis.position.x,
                this._parts.pelvis.position.y,
                this._parts.pelvis.position.z
            )

            if (hipsBone.parent) {
                const parentMatrixWorldInverse = hipsBone.parent.matrixWorld.clone().invert()
                this._tempWorldPos.applyMatrix4(parentMatrixWorldInverse)
            }
            hipsBone.position.copy(this._tempWorldPos)

            // Rotation
            syncBoneRotation(this._parts.pelvis, this._boneNames.hips)
        }

        // Sync all other bones - rotation only (no position changes)
        syncBoneRotation(this._parts.head, this._boneNames.head)
        syncBoneRotation(this._parts.upperBody, this._boneNames.spine2)
        syncBoneRotation(this._parts.upperLeftLeg, this._boneNames.leftUpLeg)
        syncBoneRotation(this._parts.upperRightLeg, this._boneNames.rightUpLeg)
        syncBoneRotation(this._parts.lowerLeftLeg, this._boneNames.leftLeg)
        syncBoneRotation(this._parts.lowerRightLeg, this._boneNames.rightLeg)
        syncBoneRotation(this._parts.upperLeftArm, this._boneNames.leftArm)
        syncBoneRotation(this._parts.upperRightArm, this._boneNames.rightArm)
        syncBoneRotation(this._parts.lowerLeftArm, this._boneNames.leftForeArm)
        syncBoneRotation(this._parts.lowerRightArm, this._boneNames.rightForeArm)

        // Update the skeleton's matrix world
        for (const skinnedMesh of this._characterMeshes) {
            if (skinnedMesh.skeleton) {
                skinnedMesh.skeleton.update()
            }
        }
    }

    private _syncObjectPosition() {
        if (!this._initialized || this._bodies.length === 0) return

        // Get current object world transform
        this.object.getWorldPosition(this._currentObjectPosition)
        this.object.getWorldQuaternion(this._currentObjectQuaternion)

        // Calculate position delta
        const deltaX = this._currentObjectPosition.x - this._lastObjectPosition.x
        const deltaY = this._currentObjectPosition.y - this._lastObjectPosition.y
        const deltaZ = this._currentObjectPosition.z - this._lastObjectPosition.z

        // Check if rotation changed
        const rotationChanged = !this._currentObjectQuaternion.equals(this._lastObjectQuaternion)

        // If rotation changed, we need to rotate all bodies around the object's position
        if (rotationChanged) {
            // Calculate the delta rotation: deltaQ = currentQ * inverse(lastQ)
            this._invLastQuaternion.copy(this._lastObjectQuaternion).invert()
            this._deltaQuaternion.copy(this._currentObjectQuaternion).multiply(this._invLastQuaternion)

            // Pivot point is the object's last position (before any position change)
            this._pivotPoint.copy(this._lastObjectPosition)

            // Rotate each body around the pivot point
            for (const body of this._bodies) {
                // Get body position relative to pivot
                this._tempVec3.set(
                    body.position.x - this._pivotPoint.x,
                    body.position.y - this._pivotPoint.y,
                    body.position.z - this._pivotPoint.z
                )

                // Rotate the relative position by delta quaternion
                this._tempVec3.applyQuaternion(this._deltaQuaternion)

                // Set new position (pivot + rotated relative position)
                body.position.x = this._pivotPoint.x + this._tempVec3.x
                body.position.y = this._pivotPoint.y + this._tempVec3.y
                body.position.z = this._pivotPoint.z + this._tempVec3.z

                // Also rotate the body's own quaternion
                // Convert cannon quaternion to three quaternion, apply delta, convert back
                const bodyQuat = new Quaternion(
                    body.quaternion.x,
                    body.quaternion.y,
                    body.quaternion.z,
                    body.quaternion.w
                )
                bodyQuat.premultiply(this._deltaQuaternion)
                body.quaternion.set(bodyQuat.x, bodyQuat.y, bodyQuat.z, bodyQuat.w)
            }

            // Update last quaternion
            this._lastObjectQuaternion.copy(this._currentObjectQuaternion)
        }

        // Apply position delta (after rotation, so we translate the already-rotated positions)
        if (deltaX !== 0 || deltaY !== 0 || deltaZ !== 0) {
            for (const body of this._bodies) {
                body.position.x += deltaX
                body.position.y += deltaY
                body.position.z += deltaZ
            }

            // Update last position
            this._lastObjectPosition.copy(this._currentObjectPosition)
        }
    }

    private _updateMeshes() {
        if (!this._parts || this._meshes.length === 0) return

        // Sync each mesh position/rotation with its corresponding body
        for (let i = 0; i < this._bodies.length && i < this._meshes.length; i++) {
            const body = this._bodies[i]
            const mesh = this._meshes[i]

            mesh.position.set(body.position.x, body.position.y, body.position.z)
            mesh.quaternion.set(
                body.quaternion.x,
                body.quaternion.y,
                body.quaternion.z,
                body.quaternion.w
            )
        }
    }

    private _recreateRagdoll() {
        if (!this._cannon) return
        this._removeRagdoll()
        this._createRagdoll()
        this.object.setDirty?.({ source: 'CannonRagdollComponent' })
    }

    private _updateMass() {
        for (const body of this._bodies) {
            body.mass = this.mass
            body.updateMassProperties()
        }
        this.object.setDirty?.({ source: 'CannonRagdollComponent' })
    }

    private _updateConstraints() {
        // Recreate constraints with new angles
        this._recreateRagdoll()
    }

    private _createRagdoll() {
        if (!this._cannon) return

        const scale = this.scale
        const angle = this.angle
        const angleShoulders = this.angleShoulders
        const twistAngle = this.twistAngle

        // Dimensions (same as original)
        const shouldersDistance = 0.5 * scale
        const upperArmLength = 0.4 * scale
        const lowerArmLength = 0.4 * scale
        const upperArmSize = 0.2 * scale
        const lowerArmSize = 0.2 * scale
        const neckLength = 0.1 * scale
        const headRadius = 0.25 * scale
        const upperBodyLength = 0.6 * scale
        const pelvisLength = 0.4 * scale
        const upperLegLength = 0.5 * scale
        const upperLegSize = 0.2 * scale
        const lowerLegSize = 0.2 * scale
        const lowerLegLength = 0.5 * scale

        // Shapes - Original uses Z as up, we use Y as up
        // Original: Box(x, y, z) where Z is height for vertical parts
        // Ours: Box(x, y, z) where Y is height for vertical parts
        const headShape = new Sphere(headRadius)

        // Arms extend along X axis (horizontal)
        const upperArmShape = new Box(
            new Vec3(upperArmLength * 0.5, upperArmSize * 0.5, upperArmSize * 0.5)
        )
        const lowerArmShape = new Box(
            new Vec3(lowerArmLength * 0.5, lowerArmSize * 0.5, lowerArmSize * 0.5)
        )

        // Upper body: X is width (shoulders), Z is depth, Y is height
        // Original: (shouldersDistance * 0.5, lowerArmSize * 0.5, upperBodyLength * 0.5)
        // Convert Z->Y for height
        const upperBodyShape = new Box(
            new Vec3(shouldersDistance * 0.5, upperBodyLength * 0.5, lowerArmSize * 0.5)
        )
        const pelvisShape = new Box(
            new Vec3(shouldersDistance * 0.5, pelvisLength * 0.5, lowerArmSize * 0.5)
        )

        // Legs: vertical, so Y is the length
        const upperLegShape = new Box(
            new Vec3(upperLegSize * 0.5, upperLegLength * 0.5, lowerArmSize * 0.5)
        )
        const lowerLegShape = new Box(
            new Vec3(lowerLegSize * 0.5, lowerLegLength * 0.5, lowerArmSize * 0.5)
        )

        // Get world position and rotation of the object as the base transform
        const basePos = this.object.getWorldPosition(new Vector3())
        const baseQuat = this.object.getWorldQuaternion(new Quaternion())

        // Helper to transform a local offset by the object's world rotation and add to world position
        const transformLocalToWorld = (localOffset: Vector3): Vec3 => {
            const worldOffset = localOffset.clone().applyQuaternion(baseQuat)
            return new Vec3(
                basePos.x + worldOffset.x,
                basePos.y + worldOffset.y,
                basePos.z + worldOffset.z
            )
        }

        // Helper to create mesh for a body
        const createMeshForBody = (body: Body, isHead = false): Mesh => {
            let geometry
            if (isHead) {
                geometry = new SphereGeometry(headRadius, 16, 16)
            } else {
                const shape = body.shapes[0] as Box
                geometry = new BoxGeometry(
                    shape.halfExtents.x * 2,
                    shape.halfExtents.y * 2,
                    shape.halfExtents.z * 2
                )
            }
            const mesh = new Mesh(geometry, this._visualMaterial!)
            mesh.position.set(body.position.x, body.position.y, body.position.z)
            this._meshContainer?.add(mesh)
            this._meshes.push(mesh)
            return mesh
        }

        // Lower legs - positions converted from Z-up to Y-up
        // Original: position(x, 0, lowerLegLength/2) -> ours: position(x, lowerLegLength/2, 0)
        const lowerLeftLeg = new Body({
            mass: this.mass,
            position: transformLocalToWorld(new Vector3(shouldersDistance / 2, lowerLegLength / 2, 0)),
            material: this.material,
        })
        const lowerRightLeg = new Body({
            mass: this.mass,
            position: transformLocalToWorld(new Vector3(-shouldersDistance / 2, lowerLegLength / 2, 0)),
            material: this.material,
        })
        lowerLeftLeg.addShape(lowerLegShape)
        lowerRightLeg.addShape(lowerLegShape)
        lowerLeftLeg.quaternion.set(baseQuat.x, baseQuat.y, baseQuat.z, baseQuat.w)
        lowerRightLeg.quaternion.set(baseQuat.x, baseQuat.y, baseQuat.z, baseQuat.w)
        this._bodies.push(lowerLeftLeg, lowerRightLeg)
        createMeshForBody(lowerLeftLeg)
        createMeshForBody(lowerRightLeg)

        // Upper legs
        const upperLeftLeg = new Body({
            mass: this.mass,
            position: transformLocalToWorld(new Vector3(shouldersDistance / 2, lowerLegLength + upperLegLength / 2, 0)),
            material: this.material,
        })
        const upperRightLeg = new Body({
            mass: this.mass,
            position: transformLocalToWorld(new Vector3(-shouldersDistance / 2, lowerLegLength + upperLegLength / 2, 0)),
            material: this.material,
        })
        upperLeftLeg.addShape(upperLegShape)
        upperRightLeg.addShape(upperLegShape)
        upperLeftLeg.quaternion.set(baseQuat.x, baseQuat.y, baseQuat.z, baseQuat.w)
        upperRightLeg.quaternion.set(baseQuat.x, baseQuat.y, baseQuat.z, baseQuat.w)
        this._bodies.push(upperLeftLeg, upperRightLeg)
        createMeshForBody(upperLeftLeg)
        createMeshForBody(upperRightLeg)

        // Pelvis
        const pelvisLocalY = lowerLegLength + upperLegLength + pelvisLength / 2
        const pelvis = new Body({
            mass: this.mass,
            position: transformLocalToWorld(new Vector3(0, pelvisLocalY, 0)),
            material: this.material,
        })
        pelvis.addShape(pelvisShape)
        pelvis.quaternion.set(baseQuat.x, baseQuat.y, baseQuat.z, baseQuat.w)
        this._bodies.push(pelvis)
        createMeshForBody(pelvis)

        // Upper body
        const upperBodyLocalY = pelvisLocalY + pelvisLength / 2 + upperBodyLength / 2
        const upperBody = new Body({
            mass: this.mass,
            position: transformLocalToWorld(new Vector3(0, upperBodyLocalY, 0)),
            material: this.material,
        })
        upperBody.addShape(upperBodyShape)
        upperBody.quaternion.set(baseQuat.x, baseQuat.y, baseQuat.z, baseQuat.w)
        this._bodies.push(upperBody)
        createMeshForBody(upperBody)

        // Head
        const headLocalY = upperBodyLocalY + upperBodyLength / 2 + headRadius + neckLength
        const head = new Body({
            mass: this.mass,
            position: transformLocalToWorld(new Vector3(0, headLocalY, 0)),
            material: this.material,
        })
        head.addShape(headShape)
        head.quaternion.set(baseQuat.x, baseQuat.y, baseQuat.z, baseQuat.w)
        this._bodies.push(head)
        createMeshForBody(head, true)

        // Upper arms - at shoulder height
        const armLocalY = upperBodyLocalY + upperBodyLength / 2
        const upperLeftArm = new Body({
            mass: this.mass,
            position: transformLocalToWorld(new Vector3(shouldersDistance / 2 + upperArmLength / 2, armLocalY, 0)),
            material: this.material,
        })
        const upperRightArm = new Body({
            mass: this.mass,
            position: transformLocalToWorld(new Vector3(-shouldersDistance / 2 - upperArmLength / 2, armLocalY, 0)),
            material: this.material,
        })
        upperLeftArm.addShape(upperArmShape)
        upperRightArm.addShape(upperArmShape)
        upperLeftArm.quaternion.set(baseQuat.x, baseQuat.y, baseQuat.z, baseQuat.w)
        upperRightArm.quaternion.set(baseQuat.x, baseQuat.y, baseQuat.z, baseQuat.w)
        this._bodies.push(upperLeftArm, upperRightArm)
        createMeshForBody(upperLeftArm)
        createMeshForBody(upperRightArm)

        // Lower arms
        const lowerLeftArm = new Body({
            mass: this.mass,
            position: transformLocalToWorld(new Vector3(
                shouldersDistance / 2 + upperArmLength + lowerArmLength / 2,
                armLocalY,
                0
            )),
            material: this.material,
        })
        const lowerRightArm = new Body({
            mass: this.mass,
            position: transformLocalToWorld(new Vector3(
                -shouldersDistance / 2 - upperArmLength - lowerArmLength / 2,
                armLocalY,
                0
            )),
            material: this.material,
        })
        lowerLeftArm.addShape(lowerArmShape)
        lowerRightArm.addShape(lowerArmShape)
        lowerLeftArm.quaternion.set(baseQuat.x, baseQuat.y, baseQuat.z, baseQuat.w)
        lowerRightArm.quaternion.set(baseQuat.x, baseQuat.y, baseQuat.z, baseQuat.w)
        this._bodies.push(lowerLeftArm, lowerRightArm)
        createMeshForBody(lowerLeftArm)
        createMeshForBody(lowerRightArm)

        // Store parts reference
        this._parts = {
            lowerLeftLeg,
            lowerRightLeg,
            upperLeftLeg,
            upperRightLeg,
            pelvis,
            upperBody,
            head,
            upperLeftArm,
            upperRightArm,
            lowerLeftArm,
            lowerRightArm,
        }

        // Add bodies to world
        for (const body of this._bodies) {
            this._cannon.world.addBody(body)
        }

        // CONSTRAINTS - Convert from Z-up to Y-up
        // Original uses UNIT_Z for vertical axis, we use UNIT_Y
        // Pivots: original (x, y, z) where z is height -> ours (x, y, z) where y is height
        // So pivot (x, 0, z) -> (x, z, 0)

        // Neck joint
        // Original: pivotA(0, 0, -headRadius - neckLength/2), pivotB(0, 0, upperBodyLength/2)
        // Ours: pivotA(0, -headRadius - neckLength/2, 0), pivotB(0, upperBodyLength/2, 0)
        const neckJoint = new ConeTwistConstraint(head, upperBody, {
            pivotA: new Vec3(0, -headRadius - neckLength / 2, 0),
            pivotB: new Vec3(0, upperBodyLength / 2, 0),
            axisA: Vec3.UNIT_Y,
            axisB: Vec3.UNIT_Y,
            angle,
            twistAngle,
        })
        this._constraints.push(neckJoint)

        // Knee joints
        // Original: pivotA(0, 0, lowerLegLength/2), pivotB(0, 0, -upperLegLength/2)
        // Ours: pivotA(0, lowerLegLength/2, 0), pivotB(0, -upperLegLength/2, 0)
        const leftKneeJoint = new ConeTwistConstraint(lowerLeftLeg, upperLeftLeg, {
            pivotA: new Vec3(0, lowerLegLength / 2, 0),
            pivotB: new Vec3(0, -upperLegLength / 2, 0),
            axisA: Vec3.UNIT_Y,
            axisB: Vec3.UNIT_Y,
            angle,
            twistAngle,
        })
        const rightKneeJoint = new ConeTwistConstraint(lowerRightLeg, upperRightLeg, {
            pivotA: new Vec3(0, lowerLegLength / 2, 0),
            pivotB: new Vec3(0, -upperLegLength / 2, 0),
            axisA: Vec3.UNIT_Y,
            axisB: Vec3.UNIT_Y,
            angle,
            twistAngle,
        })
        this._constraints.push(leftKneeJoint, rightKneeJoint)

        // Hip joints
        // Original: pivotA(0, 0, upperLegLength/2), pivotB(shouldersDistance/2, 0, -pelvisLength/2)
        // Ours: pivotA(0, upperLegLength/2, 0), pivotB(shouldersDistance/2, -pelvisLength/2, 0)
        const leftHipJoint = new ConeTwistConstraint(upperLeftLeg, pelvis, {
            pivotA: new Vec3(0, upperLegLength / 2, 0),
            pivotB: new Vec3(shouldersDistance / 2, -pelvisLength / 2, 0),
            axisA: Vec3.UNIT_Y,
            axisB: Vec3.UNIT_Y,
            angle,
            twistAngle,
        })
        const rightHipJoint = new ConeTwistConstraint(upperRightLeg, pelvis, {
            pivotA: new Vec3(0, upperLegLength / 2, 0),
            pivotB: new Vec3(-shouldersDistance / 2, -pelvisLength / 2, 0),
            axisA: Vec3.UNIT_Y,
            axisB: Vec3.UNIT_Y,
            angle,
            twistAngle,
        })
        this._constraints.push(leftHipJoint, rightHipJoint)

        // Spine
        // Original: pivotA(0, 0, pelvisLength/2), pivotB(0, 0, -upperBodyLength/2)
        // Ours: pivotA(0, pelvisLength/2, 0), pivotB(0, -upperBodyLength/2, 0)
        const spineJoint = new ConeTwistConstraint(pelvis, upperBody, {
            pivotA: new Vec3(0, pelvisLength / 2, 0),
            pivotB: new Vec3(0, -upperBodyLength / 2, 0),
            axisA: Vec3.UNIT_Y,
            axisB: Vec3.UNIT_Y,
            angle,
            twistAngle,
        })
        this._constraints.push(spineJoint)

        // Shoulders - these use UNIT_X in original, keep the same
        // Original: pivotA(shouldersDistance/2, 0, upperBodyLength/2), pivotB(-upperArmLength/2, 0, 0)
        // Ours: pivotA(shouldersDistance/2, upperBodyLength/2, 0), pivotB(-upperArmLength/2, 0, 0)
        const leftShoulder = new ConeTwistConstraint(upperBody, upperLeftArm, {
            pivotA: new Vec3(shouldersDistance / 2, upperBodyLength / 2, 0),
            pivotB: new Vec3(-upperArmLength / 2, 0, 0),
            axisA: Vec3.UNIT_X,
            axisB: Vec3.UNIT_X,
            angle: angleShoulders,
        })
        const rightShoulder = new ConeTwistConstraint(upperBody, upperRightArm, {
            pivotA: new Vec3(-shouldersDistance / 2, upperBodyLength / 2, 0),
            pivotB: new Vec3(upperArmLength / 2, 0, 0),
            axisA: Vec3.UNIT_X,
            axisB: Vec3.UNIT_X,
            angle: angleShoulders,
            twistAngle,
        })
        this._constraints.push(leftShoulder, rightShoulder)

        // Elbow joints - use UNIT_X as in original
        const leftElbowJoint = new ConeTwistConstraint(lowerLeftArm, upperLeftArm, {
            pivotA: new Vec3(-lowerArmLength / 2, 0, 0),
            pivotB: new Vec3(upperArmLength / 2, 0, 0),
            axisA: Vec3.UNIT_X,
            axisB: Vec3.UNIT_X,
            angle,
            twistAngle,
        })
        const rightElbowJoint = new ConeTwistConstraint(lowerRightArm, upperRightArm, {
            pivotA: new Vec3(lowerArmLength / 2, 0, 0),
            pivotB: new Vec3(-upperArmLength / 2, 0, 0),
            axisA: Vec3.UNIT_X,
            axisB: Vec3.UNIT_X,
            angle,
            twistAngle,
        })
        this._constraints.push(leftElbowJoint, rightElbowJoint)

        // Store constraints reference
        this._ragdollConstraints = {
            neckJoint,
            leftKneeJoint,
            rightKneeJoint,
            leftHipJoint,
            rightHipJoint,
            spineJoint,
            leftShoulder,
            rightShoulder,
            leftElbowJoint,
            rightElbowJoint,
        }

        // Add constraints to world
        for (const constraint of this._constraints) {
            this._cannon.world.addConstraint(constraint)
        }

        // Store initial object transform for tracking movement
        this.object.getWorldPosition(this._lastObjectPosition)
        this.object.getWorldQuaternion(this._lastObjectQuaternion)
        this._initialized = true
    }

    private _removeRagdoll() {
        // Remove constraints from world
        for (const constraint of this._constraints) {
            this._cannon?.world.removeConstraint(constraint)
        }
        this._constraints = []
        this._ragdollConstraints = null

        // Remove bodies from world
        for (const body of this._bodies) {
            this._cannon?.world.removeBody(body)
        }
        this._bodies = []
        this._parts = null

        // Remove and dispose meshes
        for (const mesh of this._meshes) {
            mesh.geometry.dispose()
            this._meshContainer?.remove(mesh)
        }
        this._meshes = []
    }

    /**
     * Reset the ragdoll to its initial position relative to the object
     */
    resetPosition() {
        if (!this._parts) return

        const basePos = this.object.getWorldPosition(new Vector3())
        const scale = this.scale

        const shouldersDistance = 0.5 * scale
        const lowerLegLength = 0.5 * scale
        const upperLegLength = 0.5 * scale
        const pelvisLength = 0.4 * scale
        const upperBodyLength = 0.6 * scale
        const headRadius = 0.25 * scale
        const neckLength = 0.1 * scale
        const upperArmLength = 0.4 * scale
        const lowerArmLength = 0.4 * scale

        const resetBody = (body: Body, pos: Vec3) => {
            body.position.copy(pos)
            body.velocity.set(0, 0, 0)
            body.angularVelocity.set(0, 0, 0)
            body.quaternion.set(0, 0, 0, 1)
        }

        resetBody(this._parts.lowerLeftLeg, new Vec3(
            basePos.x + shouldersDistance / 2,
            basePos.y + lowerLegLength / 2,
            basePos.z
        ))
        resetBody(this._parts.lowerRightLeg, new Vec3(
            basePos.x - shouldersDistance / 2,
            basePos.y + lowerLegLength / 2,
            basePos.z
        ))
        resetBody(this._parts.upperLeftLeg, new Vec3(
            basePos.x + shouldersDistance / 2,
            basePos.y + lowerLegLength + upperLegLength / 2,
            basePos.z
        ))
        resetBody(this._parts.upperRightLeg, new Vec3(
            basePos.x - shouldersDistance / 2,
            basePos.y + lowerLegLength + upperLegLength / 2,
            basePos.z
        ))

        const pelvisY = basePos.y + lowerLegLength + upperLegLength + pelvisLength / 2
        resetBody(this._parts.pelvis, new Vec3(basePos.x, pelvisY, basePos.z))

        const upperBodyY = pelvisY + pelvisLength / 2 + upperBodyLength / 2
        resetBody(this._parts.upperBody, new Vec3(basePos.x, upperBodyY, basePos.z))

        const headY = upperBodyY + upperBodyLength / 2 + headRadius + neckLength
        resetBody(this._parts.head, new Vec3(basePos.x, headY, basePos.z))

        const armY = upperBodyY + upperBodyLength / 2
        resetBody(this._parts.upperLeftArm, new Vec3(
            basePos.x + shouldersDistance / 2 + upperArmLength / 2,
            armY,
            basePos.z
        ))
        resetBody(this._parts.upperRightArm, new Vec3(
            basePos.x - shouldersDistance / 2 - upperArmLength / 2,
            armY,
            basePos.z
        ))
        resetBody(this._parts.lowerLeftArm, new Vec3(
            basePos.x + shouldersDistance / 2 + upperArmLength + lowerArmLength / 2,
            armY,
            basePos.z
        ))
        resetBody(this._parts.lowerRightArm, new Vec3(
            basePos.x - shouldersDistance / 2 - upperArmLength - lowerArmLength / 2,
            armY,
            basePos.z
        ))

        this.object.setDirty?.({ source: 'CannonRagdollComponent' })
    }

    /**
     * Apply an impulse to all bodies
     */
    applyImpulse(impulse: Vec3, worldPoint?: Vec3) {
        for (const body of this._bodies) {
            body.applyImpulse(impulse, worldPoint || body.position)
        }
    }

    /**
     * Apply an impulse to a specific body part
     */
    applyImpulseToPart(partName: keyof RagdollParts, impulse: Vec3, worldPoint?: Vec3) {
        if (!this._parts) return
        const body = this._parts[partName]
        if (body) {
            body.applyImpulse(impulse, worldPoint || body.position)
        }
    }

    private _updateMeshVisibility() {
        if (this._meshContainer) {
            this._meshContainer.visible = !this.hideRagdollMeshes
        }
    }

    private _findCharacterMeshes() {
        this._characterMeshes = []
        this.object.traverse((child) => {
            if ((child as unknown as SkinnedMesh).isSkinnedMesh) {
                this._characterMeshes.push(child as unknown as SkinnedMesh)
            }
        })
    }

    private _buildBoneMap() {
        this._boneMap.clear()
        this.object.traverse((child) => {
            if ((child as Bone).isBone) {
                const bone = child as Bone
                // Map by exact name
                this._boneMap.set(bone.name, bone)
                // Also map by lowercase for case-insensitive matching
                this._boneMap.set(bone.name.toLowerCase(), bone)
            }
        })
    }

    private _findBone(boneNames: string[]): Bone | null {
        for (const name of boneNames) {
            const bone = this._boneMap.get(name) || this._boneMap.get(name.toLowerCase())
            if (bone) return bone
        }
        return null
    }

    private _getBoneWorldPosition(bone: Bone): Vector3 {
        bone.getWorldPosition(this._tempWorldPos)
        return this._tempWorldPos.clone()
    }

    private _getBoneWorldQuaternion(bone: Bone): Quaternion {
        bone.getWorldQuaternion(this._tempWorldQuat)
        return this._tempWorldQuat.clone()
    }

    start() {
        super.start();
        setTimeout(()=>{
            this.activate(new Vec3(5, 3, 0), undefined);
        }, 2000)
    }

    /**
     * Activates the ragdoll physics simulation.
     * Call this when the character should start ragdolling (e.g., on death).
     * @param impulse Optional initial impulse to apply (e.g., from bullet impact)
     * @param impactPoint Optional world point where impulse is applied
     */
    activate(impulse?: Vec3, impactPoint?: Vec3) {
        if (this._isActive) return

        // Create ragdoll if not created yet
        if (!this._parts) {
            this._createRagdoll()
        }

        // Store initial bone quaternions (local space) before activation
        this._storeInitialBoneQuats()

        // Store initial body quaternions (world space)
        this._storeInitialBodyQuats()

        // Activate physics bodies (make them dynamic)
        this._activateBodies()

        // Show ragdoll meshes if not hidden
        if (this._meshContainer) {
            this._meshContainer.visible = !this.hideRagdollMeshes
        }

        // Apply initial impulse if provided
        if (impulse) {
            // Apply impulse to central body parts (pelvis, upperBody, head)
            // Limbs will follow naturally due to constraints and gravity
            if (this._parts) {
                this._parts.pelvis.applyImpulse(impulse, new Vec3(0, 0, 0))
                this._parts.upperBody.applyImpulse(impulse, new Vec3(0, 0, 0))
                this._parts.head.applyImpulse(impulse, new Vec3(0, 0, 0))
            }
        }

        this._isActive = true
    }

    /**
     * Store initial bone quaternions (both local and world space) for rotation offset calculation
     */
    private _storeInitialBoneQuats() {
        this._initialBoneQuats.clear()
        this._initialBoneWorldQuats.clear()

        const storeBoneQuat = (boneNames: string[]) => {
            const bone = this._findBone(boneNames)
            if (bone) {
                // Store local quaternion
                this._initialBoneQuats.set(bone.name, bone.quaternion.clone())
                // Store world quaternion
                const worldQuat = new Quaternion()
                bone.getWorldQuaternion(worldQuat)
                this._initialBoneWorldQuats.set(bone.name, worldQuat)
            }
        }

        storeBoneQuat(this._boneNames.head)
        storeBoneQuat(this._boneNames.spine2)
        storeBoneQuat(this._boneNames.hips)
        storeBoneQuat(this._boneNames.leftUpLeg)
        storeBoneQuat(this._boneNames.rightUpLeg)
        storeBoneQuat(this._boneNames.leftLeg)
        storeBoneQuat(this._boneNames.rightLeg)
        storeBoneQuat(this._boneNames.leftArm)
        storeBoneQuat(this._boneNames.rightArm)
        storeBoneQuat(this._boneNames.leftForeArm)
        storeBoneQuat(this._boneNames.rightForeArm)
    }

    /**
     * Store initial body quaternions (world space) for rotation offset calculation
     */
    private _storeInitialBodyQuats() {
        this._initialBodyQuats.clear()

        for (const body of this._bodies) {
            this._initialBodyQuats.set(body, new Quaternion(
                body.quaternion.x,
                body.quaternion.y,
                body.quaternion.z,
                body.quaternion.w
            ))
        }
    }

    /**
     * Deactivates the ragdoll and restores the character.
     * Call this to reset the character to normal state.
     */
    deactivate() {
        if (!this._isActive) return

        // Deactivate physics bodies (make them kinematic)
        this._deactivateBodies()

        // Show character mesh, hide ragdoll
        this._setCharacterVisible(true)
        if (this._meshContainer) {
            this._meshContainer.visible = false
        }

        this._isActive = false
    }

    private _matchBonesToRagdoll() {
        if (!this._parts) return

        // Match each ragdoll body to its corresponding bone position
        const matchBodyToBone = (body: Body, boneNames: string[]) => {
            const bone = this._findBone(boneNames)
            if (bone) {
                const worldPos = this._getBoneWorldPosition(bone)
                const worldQuat = this._getBoneWorldQuaternion(bone)
                body.position.set(worldPos.x, worldPos.y, worldPos.z)
                body.quaternion.set(worldQuat.x, worldQuat.y, worldQuat.z, worldQuat.w)
                body.velocity.set(0, 0, 0)
                body.angularVelocity.set(0, 0, 0)
            }
        }

        matchBodyToBone(this._parts.head, this._boneNames.head)
        matchBodyToBone(this._parts.upperBody, this._boneNames.spine2)
        matchBodyToBone(this._parts.pelvis, this._boneNames.hips)
        matchBodyToBone(this._parts.upperLeftLeg, this._boneNames.leftUpLeg)
        matchBodyToBone(this._parts.upperRightLeg, this._boneNames.rightUpLeg)
        matchBodyToBone(this._parts.lowerLeftLeg, this._boneNames.leftLeg)
        matchBodyToBone(this._parts.lowerRightLeg, this._boneNames.rightLeg)
        matchBodyToBone(this._parts.upperLeftArm, this._boneNames.leftArm)
        matchBodyToBone(this._parts.upperRightArm, this._boneNames.rightArm)
        matchBodyToBone(this._parts.lowerLeftArm, this._boneNames.leftForeArm)
        matchBodyToBone(this._parts.lowerRightArm, this._boneNames.rightForeArm)
    }

    private _activateBodies() {
        for (const body of this._bodies) {
            body.type = Body.DYNAMIC
            body.mass = this.mass
            body.updateMassProperties()
            body.wakeUp()
        }
    }

    private _deactivateBodies() {
        for (const body of this._bodies) {
            body.type = Body.KINEMATIC
            body.mass = 0
            body.velocity.set(0, 0, 0)
            body.angularVelocity.set(0, 0, 0)
        }
    }

    private _setCharacterVisible(visible: boolean) {
        for (const mesh of this._characterMeshes) {
            mesh.visible = visible
        }
    }

    private _findClosestBody(point: Vec3): Body | null {
        let closest: Body | null = null
        let minDist = Infinity

        for (const body of this._bodies) {
            const dx = body.position.x - point.x
            const dy = body.position.y - point.y
            const dz = body.position.z - point.z
            const dist = dx * dx + dy * dy + dz * dz

            if (dist < minDist) {
                minDist = dist
                closest = body
            }
        }

        return closest
    }
}
