import {Object3D, Quaternion, Vector3} from 'three'
import {beforeEach, describe, expect, it} from 'vitest'
import {CannonPhysicsPlugin} from '../../src/plugins/cannon/CannonPhysicsPlugin.ts'

/**
 * CannonPhysicsPlugin runs one `preFrame` per rendered frame. Re-rendering every
 * light's shadow map costs a full pass over every shadow caster, so the plugin must
 * only ask for that when its own step actually moved a mesh.
 */

interface ViewerCalls {
    setDirty: number
    resetShadows: number
}

/** The slice of ThreeViewer that `_preFrame` touches, plus call counters. */
function fakeViewer(): {viewer: unknown, calls: ViewerCalls} {
    const calls: ViewerCalls = {setDirty: 0, resetShadows: 0}
    const viewer = {
        getPlugin: () => undefined,
        setDirty: () => {
            calls.setDirty += 1
        },
        renderManager: {
            resetShadows: () => {
                calls.resetShadows += 1
            },
        },
    }
    return {viewer, calls}
}

/**
 * A stand-in for Cannon3DBodyComponent: a mesh in the scene graph and the cannon body
 * the solver writes into. `bodyAt` is where the solver put the body this step.
 */
function fakeBody(meshAt: Vector3, bodyAt: Vector3) {
    const parent = new Object3D()
    const object = new Object3D()
    parent.add(object)
    object.position.copy(meshAt)
    parent.updateMatrixWorld(true)
    return {
        mass: 1,
        object,
        body: {position: bodyAt.clone(), quaternion: new Quaternion()},
    }
}

function stepOnce(plugin: CannonPhysicsPlugin, viewer: unknown): void {
    const internals = plugin as unknown as {
        _viewer: unknown
        _preFrame: (event: unknown) => void
    }
    internals._viewer = viewer
    internals._preFrame({deltaTime: 16})
}

describe('CannonPhysicsPlugin shadow invalidation', () => {
    let plugin: CannonPhysicsPlugin
    let viewer: unknown
    let calls: ViewerCalls

    beforeEach(() => {
        plugin = new CannonPhysicsPlugin(true, true)
        const fake = fakeViewer()
        viewer = fake.viewer
        calls = fake.calls
    })

    it('does not reset shadows when the step moved nothing', () => {
        const still = new Vector3(1, 2, 3)
        plugin.bodyComponents.add(fakeBody(still, still) as never)

        stepOnce(plugin, viewer)

        expect(calls.resetShadows).toBe(0)
        expect(plugin.dirty).toBe(false)
    })

    it('does not reset shadows when there are no bodies at all', () => {
        stepOnce(plugin, viewer)

        expect(calls.resetShadows).toBe(0)
    })

    it('resets shadows when the step moved a mesh', () => {
        plugin.bodyComponents.add(fakeBody(new Vector3(0, 0, 0), new Vector3(0, 5, 0)) as never)

        stepOnce(plugin, viewer)

        expect(calls.resetShadows).toBe(1)
        expect(plugin.dirty).toBe(true)
    })

    // The moved body is first and the still body is last. A flag that only survives the
    // final iteration reports "nothing moved" here and drops the shadow update.
    it('resets shadows when an earlier body moved and the last one did not', () => {
        const still = new Vector3(9, 9, 9)
        plugin.bodyComponents.add(fakeBody(new Vector3(0, 0, 0), new Vector3(0, 5, 0)) as never)
        plugin.bodyComponents.add(fakeBody(still, still) as never)

        stepOnce(plugin, viewer)

        expect(calls.resetShadows).toBe(1)
        expect(plugin.dirty).toBe(true)
    })

    // A running game renders every frame regardless of physics, so setDirty stays unguarded.
    it('still marks the viewer dirty on a step that moved nothing', () => {
        const still = new Vector3(1, 2, 3)
        plugin.bodyComponents.add(fakeBody(still, still) as never)

        stepOnce(plugin, viewer)

        expect(calls.setDirty).toBe(1)
    })

    it('does nothing at all while the plugin is stopped', () => {
        plugin.running = false
        plugin.bodyComponents.add(fakeBody(new Vector3(0, 0, 0), new Vector3(0, 5, 0)) as never)

        stepOnce(plugin, viewer)

        expect(calls.resetShadows).toBe(0)
        expect(calls.setDirty).toBe(0)
        expect(plugin.dirty).toBe(false)
    })
})
