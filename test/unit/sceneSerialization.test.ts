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

    it('drops viewer-owned ids while preserving authored object ids', async () => {
        const serialized = await serializeSceneGltfDocument({
            asset: {version: '2.0'},
            scene: 0,
            scenes: [{
                nodes: [0],
                extras: {rootSceneModelRoot: true, gltfUUID: 'volatile-model-root'},
                extensions: {
                    WEBGI_viewer: {
                        scene: {
                            backgroundRotation: {isEuler: true},
                            defaultCamera: {
                                aspect: 1.75,
                                autoAspect: true,
                                object: {
                                    aspect: 1.75,
                                    uuid: 'volatile-default-camera',
                                    name: 'Default Camera',
                                },
                            },
                        },
                    },
                },
            }],
            nodes: [{name: 'Authored', extras: {gltfUUID: 'authored-stable-id'}}],
        })

        expect(serialized.document).not.toHaveProperty('scenes.0.extras.gltfUUID')
        expect(serialized.document).not.toHaveProperty(
            'scenes.0.extensions.WEBGI_viewer.scene.defaultCamera.object.uuid',
        )
        expect(serialized.document).not.toHaveProperty(
            'scenes.0.extensions.WEBGI_viewer.scene.defaultCamera.aspect',
        )
        expect(serialized.document).not.toHaveProperty(
            'scenes.0.extensions.WEBGI_viewer.scene.defaultCamera.object.aspect',
        )
        expect(serialized.document).toHaveProperty(
            'scenes.0.extensions.WEBGI_viewer.scene.backgroundRotation',
            {isEuler: true, order: 'XYZ', x: 0, y: 0, z: 0},
        )
        expect(serialized.document).toHaveProperty('nodes.0.extras.gltfUUID', 'authored-stable-id')
    })
})
