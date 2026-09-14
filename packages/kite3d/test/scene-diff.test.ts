import {describe, expect, it} from 'vitest'
import {diffSceneGltf} from '../src/scene-diff.ts'

/**
 * The dev server diffs the scene on every write of the main scene file, and that diff
 * blocks the PUT response. Flattening a material walks the whole material, so it has to
 * happen once per material, not once per property compared.
 */

interface CountedMaterial {
    material: Record<string, unknown>
    flattenCount: () => number
}

/**
 * A material that counts how many times something enumerates its top level keys.
 * `flattenMaterial` is the only caller in this path that does, once per call.
 */
function countingMaterial(name: string, propertyCount: number, tweak: boolean): CountedMaterial {
    let ownKeysCalls = 0
    const target: Record<string, unknown> = {
        name,
        pbrMetallicRoughness: {baseColorFactor: [1, 1, 1, 1], metallicFactor: 0.5},
    }
    for (let index = 0; index < propertyCount; index += 1) {
        target[`property${index}`] = {value: tweak && index === 0 ? 1 : 0, nested: [1, 2, 3]}
    }
    const material = new Proxy(target, {
        ownKeys(subject) {
            ownKeysCalls += 1
            return Reflect.ownKeys(subject)
        },
    })
    return {material, flattenCount: () => ownKeysCalls}
}

function documentWith(material: Record<string, unknown>): Record<string, unknown> {
    return {
        asset: {version: '2.0'},
        materials: [material],
        meshes: [{name: 'Cube', primitives: [{attributes: {POSITION: 0}, material: 0}]}],
        nodes: [{name: 'Cube', mesh: 0, extras: {uuid: 'cube-uuid'}}],
        scenes: [{nodes: [0]}],
    }
}

describe('scene diff material comparison', () => {
    it('flattens each material once, whatever the property count', () => {
        const before = countingMaterial('Steel', 40, false)
        const after = countingMaterial('Steel', 40, true)

        const diff = diffSceneGltf(documentWith(before.material), documentWith(after.material))

        expect(diff.materials).toHaveLength(1)
        expect(before.flattenCount()).toBe(1)
        expect(after.flattenCount()).toBe(1)
    })

    it('flattens each material once even as the property count grows', () => {
        const before = countingMaterial('Steel', 200, false)
        const after = countingMaterial('Steel', 200, true)

        diffSceneGltf(documentWith(before.material), documentWith(after.material))

        expect(before.flattenCount()).toBe(1)
        expect(after.flattenCount()).toBe(1)
    })

    it('still reports the property that changed', () => {
        const before = countingMaterial('Steel', 4, false)
        const after = countingMaterial('Steel', 4, true)

        const diff = diffSceneGltf(documentWith(before.material), documentWith(after.material))

        expect(diff.materials).toHaveLength(1)
        expect(diff.materials[0].property).toBe('property0.value')
        expect(diff.materials[0].old).toBe(0)
        expect(diff.materials[0].new).toBe(1)
    })

    it('reports no material change when the two are identical', () => {
        const before = countingMaterial('Steel', 8, false)
        const after = countingMaterial('Steel', 8, false)

        const diff = diffSceneGltf(documentWith(before.material), documentWith(after.material))

        expect(diff.materials).toHaveLength(0)
    })
})
