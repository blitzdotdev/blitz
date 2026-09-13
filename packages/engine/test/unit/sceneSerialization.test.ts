import {describe, expect, it, vi} from 'vitest'

vi.hoisted(() => {
    Object.assign(globalThis, {
        ImageData: class ImageData {},
        window: {location: {href: 'https://example.test/'}, addEventListener() {}, removeEventListener() {}},
    })
})
import {
    BufferGeometry,
    DirectionalLight2,
    GLTFExporter2,
    GLTFObject3DExtrasExtension,
    Group,
    Mesh,
    MeshStandardMaterial,
    PerspectiveCamera,
} from 'threepipe'
import {serializeSceneGltf, serializeSceneGltfDocument} from '../../src/sceneSerialization.ts'

describe('scene serialization', () => {
    it('keeps a hidden authored mesh and excludes an editor helper', async () => {
        const modelRoot = new Group()
        modelRoot.userData.rootSceneModelRoot = true
        const hiddenMesh = new Mesh(new BufferGeometry(), new MeshStandardMaterial())
        hiddenMesh.name = 'Hidden Wall'
        hiddenMesh.visible = false
        const editorHelper = new Group() as Group & {isWidget: true, assetType: 'widget'}
        editorHelper.name = 'Editor Helper'
        editorHelper.visible = false
        editorHelper.isWidget = true
        editorHelper.assetType = 'widget'
        modelRoot.add(hiddenMesh, editorHelper)
        const exporter = new GLTFExporter2().register(GLTFObject3DExtrasExtension.Export)

        const serialized = await serializeSceneGltf({
            exportScene: (options) => exporter.parseAsync(modelRoot, options),
        })
        const nodes = serialized.document.nodes as Array<{
            name?: string
            extensions?: {WEBGI_object3d_extras?: {visible?: boolean}}
        }>

        expect(nodes.find((node) => node.name === 'Hidden Wall')).toMatchObject({
            extensions: {WEBGI_object3d_extras: {visible: false}},
        })
        expect(nodes.some((node) => node.name === 'Editor Helper')).toBe(false)
    })

    it('preserves hidden hierarchy and authored object type edges', async () => {
        const modelRoot = new Group()
        modelRoot.userData.rootSceneModelRoot = true

        const hiddenGroup = new Group()
        hiddenGroup.name = 'Hidden Group'
        hiddenGroup.visible = false
        const visibleChild = new Group()
        visibleChild.name = 'Visible Child'
        hiddenGroup.add(visibleChild)

        const visibleGroup = new Group()
        visibleGroup.name = 'Visible Group'
        const hiddenChild = new Group()
        hiddenChild.name = 'Hidden Child'
        hiddenChild.visible = false
        visibleGroup.add(hiddenChild)

        const nestedInstance = new Group()
        nestedInstance.name = 'Hidden Nested Asset'
        nestedInstance.visible = false
        nestedInstance.userData.rootPath = '/kite3d/@wall/f.gltf'
        const nestedInternal = new Group()
        nestedInternal.name = 'Nested Internal'
        nestedInternal.userData.excludeFromExport = true
        nestedInstance.add(nestedInternal)

        const hiddenLight = new DirectionalLight2()
        hiddenLight.name = 'Hidden Light'
        hiddenLight.visible = false
        hiddenLight.target.name = 'Hidden Light Target'
        const hiddenCamera = new PerspectiveCamera()
        hiddenCamera.name = 'Hidden Camera'
        hiddenCamera.visible = false
        const deletedObject = new Group()
        deletedObject.name = 'Deleted Object'
        deletedObject.visible = false

        modelRoot.add(hiddenGroup, visibleGroup, nestedInstance, hiddenLight, hiddenCamera, deletedObject)
        deletedObject.removeFromParent()
        const exporter = new GLTFExporter2().register(GLTFObject3DExtrasExtension.Export)
        const serialized = await serializeSceneGltf({
            exportScene: (options) => exporter.parseAsync(modelRoot, options),
        })
        const nodes = serialized.document.nodes as Array<{
            name?: string
            extensions?: {WEBGI_object3d_extras?: {visible?: boolean}}
        }>
        const byName = Object.fromEntries(nodes.map((node) => [node.name, node]))

        expect(byName['Hidden Group']?.extensions?.WEBGI_object3d_extras?.visible).toBe(false)
        expect(byName['Visible Child']).toBeDefined()
        expect(byName['Hidden Child']?.extensions?.WEBGI_object3d_extras?.visible).toBe(false)
        expect(byName['Hidden Nested Asset']?.extensions?.WEBGI_object3d_extras?.visible).toBe(false)
        expect(byName['Nested Internal']).toBeUndefined()
        expect(byName['Hidden Light']?.extensions?.WEBGI_object3d_extras?.visible).toBe(false)
        expect(byName['Hidden Light Target']).toBeUndefined()
        expect(byName['Hidden Camera']?.extensions?.WEBGI_object3d_extras?.visible).toBe(false)
        expect(byName['Deleted Object']).toBeUndefined()
    })

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
            nodes: [{name: 'Reference', extras: {rootPath: '/kite3d/@prop/f.gltf'}}],
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

    it('drops generated UUIDs that are not used as references', async () => {
        const serialized = await serializeSceneGltfDocument({
            asset: {version: '2.0'},
            scene: 0,
            scenes: [{
                nodes: [0],
                extensions: {WEBGI_viewer: {
                    plugins: {CannonPhysicsPlugin: {defaultMaterial: {uuid: 'unused-cannon-material'}}},
                    resources: {materials: {'referenced-material': {}}},
                }},
            }],
            nodes: [{
                name: 'KeyLight',
                extensions: {WEBGI_light_extras: {shadow: {camera: {uuid: 'unused-shadow-camera'}}}},
            }],
            materials: [
                {name: 'Floor', extras: {uuid: 'unused-material'}},
                {name: 'Shared', extras: {uuid: 'referenced-material'}},
            ],
        })

        expect(serialized.document).not.toHaveProperty('materials.0.extras.uuid')
        expect(serialized.document).not.toHaveProperty(
            'nodes.0.extensions.WEBGI_light_extras.shadow.camera.uuid',
        )
        expect(serialized.document).not.toHaveProperty(
            'scenes.0.extensions.WEBGI_viewer.plugins.CannonPhysicsPlugin.defaultMaterial.uuid',
        )
        expect(serialized.document).toHaveProperty('materials.1.extras.uuid', 'referenced-material')
    })
})
