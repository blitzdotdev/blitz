import {describe, expect, it} from 'vitest'
import {serializeSceneGltfDocument} from '../../src/sceneSerialization.ts'

describe('scene serialization', () => {
    it('is deterministic and extracts one buffer plus hashed textures', async () => {
        const input = {
            nodes: [{translation: [1, 2, 3], name: 'Named node'}],
            scenes: [{nodes: [0]}],
            scene: 0,
            asset: {version: '2.0'},
            bufferViews: [
                {byteLength: 2, buffer: 0},
                {byteLength: 2, buffer: 1},
            ],
            buffers: [
                {byteLength: 2, uri: 'data:application/octet-stream;base64,AQI='},
                {byteLength: 2, uri: 'data:application/octet-stream;base64,AwQ='},
            ],
            images: [
                {uri: 'data:image/png;base64,iVBORw0KGgo='},
                {uri: 'textures/project.png'},
            ],
        }

        const first = await serializeSceneGltfDocument(input, {scenePath: 'assets/main.scene.gltf'})
        const second = await serializeSceneGltfDocument(input, {scenePath: 'assets/main.scene.gltf'})

        expect(first.gltf).toEqual(second.gltf)
        expect(new TextDecoder().decode(first.gltf)).not.toContain('data:')
        expect(first.document.nodes).toEqual(input.nodes)
        expect(first.document.buffers).toEqual([{byteLength: 6, uri: 'main.scene.bin'}])
        expect(first.document.bufferViews).toEqual([
            {buffer: 0, byteLength: 2, byteOffset: 0},
            {buffer: 0, byteLength: 2, byteOffset: 4},
        ])
        expect(first.files.map(({path}) => path)).toEqual([
            'assets/main.scene.bin',
            'assets/textures/4c4b6a3be1314ab8.png',
        ])
        expect(first.document.images).toEqual([
            {mimeType: 'image/png', uri: 'textures/4c4b6a3be1314ab8.png'},
            {uri: 'textures/project.png'},
        ])
    })

    it('does not create a bin for a reference-only scene', async () => {
        const serialized = await serializeSceneGltfDocument({
            asset: {version: '2.0'},
            scene: 0,
            scenes: [{nodes: [0]}],
            nodes: [{name: 'Reference', extras: {rootPath: '/blitz/@prop/f.gltf'}}],
        })

        expect(serialized.files).toEqual([])
        expect(serialized.document).not.toHaveProperty('buffers')
    })
})
