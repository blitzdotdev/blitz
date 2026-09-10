import {readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'
import {diffSceneGltf} from '../src/scene-diff.ts'

describe('scene semantic diff', () => {
    it('reports node, transform, component, and material changes', async () => {
        const before = await fixture('scene-before.gltf')
        const after = await fixture('scene-after.gltf')
        const diff = diffSceneGltf(before, after)

        expect(diff.nodesAdded).toEqual([{name: 'Added', uuid: 'added-uuid'}])
        expect(diff.nodesRemoved).toEqual([{name: 'Removed', uuid: 'removed-uuid'}])
        expect(diff.nodesRenamed).toEqual([{uuid: 'root-uuid', oldName: 'Old root', newName: 'New root'}])
        expect(diff.transforms).toEqual([{
            node: {name: 'New root', uuid: 'root-uuid'},
            property: 'position',
            old: [0, 0, 0],
            new: [1, 2, 3],
        }])
        expect(diff.components).toMatchObject([
            {id: 'generator', type: 'Generator', change: 'state'},
            {id: 'spin', type: 'Spin', change: 'added'},
        ])
        expect(diff.materials).toEqual([{
            material: {name: 'Ground', uuid: 'material-uuid'},
            nodes: [{name: 'New root', uuid: 'root-uuid'}],
            property: 'pbrMetallicRoughness.roughnessFactor',
            old: 1,
            new: 0.25,
        }])
    })
})

async function fixture(name: string): Promise<unknown> {
    const path = fileURLToPath(new URL(`fixtures/${name}`, import.meta.url))
    return JSON.parse(await readFile(path, 'utf8')) as unknown
}
