import {describe, expect, it, vi} from 'vitest'

vi.hoisted(() => {
    Object.assign(globalThis, {
        ImageData: class ImageData {},
        window: {location: {href: 'https://example.test/'}, addEventListener() {}, removeEventListener() {}},
    })
})
import {
    BoxGeometry,
    DirectionalLight2,
    Group,
    Mesh,
    MeshStandardMaterial,
    PerspectiveCamera,
    Scene,
    SpotLight2,
    TorusGeometry,
} from 'threepipe'
import {
    RuntimeObjectOwner,
    getAuthoringMetadata,
    setAuthoringMetadata,
} from '../../src/authoring.ts'
import {
    authoringQualityReport,
    persistenceReport,
    runtimeCleanupReport,
    semanticSceneSnapshot,
} from '../../src/authoringValidation.ts'
import {markGenerated} from '../../src/plugins/GeneratorComponent.ts'

describe('authoring validation fixture matrix', () => {
    it('passes a direct authored room', () => {
        const fixture = createFixture()
        addDirectRoom(fixture.modelRoot)

        expect(authoringQualityReport(fixture.viewer)).toMatchObject({ok: true, status: 'pass'})
    })

    it('passes a template spawner, propagates material edits, and preserves its source on cleanup', () => {
        const fixture = createFixture()
        addDirectRoom(fixture.modelRoot)
        const template = box('Enemy Template', 0x334455)
        setAuthoringMetadata(template, {role: 'template', id: 'enemy-template'})
        template.visible = false
        fixture.modelRoot.add(template)
        const runtimeRoot = new Group()
        runtimeRoot.name = 'Enemies (Runtime)'
        const owner = new RuntimeObjectOwner('enemy-spawner')
        owner.attachRuntimeRoot(runtimeRoot, fixture.scene, template)

        const first = owner.cloneFrom(template)
        ;(first.material as MeshStandardMaterial).color.set(0xff0000)
        expect((template.material as MeshStandardMaterial).color.getHex()).toBe(0x334455)
        owner.cleanup()
        ;(template.material as MeshStandardMaterial).color.set(0x8899aa)
        const nextOwner = new RuntimeObjectOwner('enemy-spawner-next')
        const nextRoot = new Group()
        nextOwner.attachRuntimeRoot(nextRoot, fixture.scene, template)
        const next = nextOwner.cloneFrom(template)
        expect((next.material as MeshStandardMaterial).color.getHex()).toBe(0x8899aa)
        expect(getAuthoringMetadata(next)).toMatchObject({role: 'template', sourceId: 'enemy-template'})
        expect(authoringQualityReport(fixture.viewer).issues).not.toContainEqual(expect.objectContaining({
            code: 'RUNTIME_SOURCE_DRIFT',
        }))

        nextOwner.cleanup()
        expect(template.parent).toBe(fixture.modelRoot)
        expect(runtimeCleanupReport(fixture.viewer)).toMatchObject({ok: true, trackedObjectCount: 0})
    })

    it('rejects owner/ancestor runtime roots and disposes owned effect resources', () => {
        const fixture = createFixture()
        const source = box('Source', 0x334455)
        setAuthoringMetadata(source, {role: 'template', id: 'source'})
        fixture.modelRoot.add(source)
        const owner = new RuntimeObjectOwner('effects')
        expect(() => owner.attachRuntimeRoot(source, fixture.scene, source)).toThrow('cannot be its authored owner')
        const ancestor = new Group()
        ancestor.add(source)
        fixture.modelRoot.add(ancestor)
        expect(() => owner.attachRuntimeRoot(ancestor, fixture.scene, source)).toThrow('ancestor')
        expect(() => owner.cloneFrom(source, fixture.modelRoot)).toThrow('outside modelRoot')
        const authoredEffect = box('Misplaced Effect', 0xffaa00)
        fixture.modelRoot.add(authoredEffect)
        expect(() => owner.trackEffect(authoredEffect, source)).toThrow('outside modelRoot')

        const effect = box('Effect', 0xffaa00)
        const geometryDispose = vi.spyOn(effect.geometry, 'dispose')
        const materialDispose = vi.spyOn(effect.material as MeshStandardMaterial, 'dispose')
        fixture.scene.add(effect)
        owner.trackEffect(effect, source)
        owner.cleanup()

        expect(effect.parent).toBeNull()
        expect(geometryDispose).toHaveBeenCalledOnce()
        expect(materialDispose).toHaveBeenCalledOnce()
    })

    it('passes a generator with one bounded preview and preserves its transform semantically', () => {
        const before = createFixture()
        const generator = addGenerator(before.modelRoot, -4)
        const firstPreview = generator.children[0]
        markGenerated(firstPreview, 'track-generator')
        const first = semanticSceneSnapshot(before.viewer)

        const after = createFixture()
        const reloadedGenerator = addGenerator(after.modelRoot, -4)
        markGenerated(reloadedGenerator.children[0], 'track-generator')
        const second = semanticSceneSnapshot(after.viewer)

        expect(authoringQualityReport(before.viewer)).toMatchObject({ok: true, status: 'pass'})
        expect(persistenceReport(first, second)).toMatchObject({ok: true})
        expect(reloadedGenerator.children).toHaveLength(1)
        expect(reloadedGenerator.children[0].position.z).toBe(-4)
    })

    it('rejects a controller-only scene with no generator preview', () => {
        const fixture = createFixture()
        const controller = new Group()
        setAuthoringMetadata(controller, {role: 'generator', id: 'world-generator'})
        controller.name = 'World Controller'
        controller.userData.EntityComponentPlugin = {
            controller: {type: 'WorldController', state: {seed: 7}},
        }
        fixture.modelRoot.add(controller)

        expect(codes(authoringQualityReport(fixture.viewer))).toEqual(expect.arrayContaining([
            'NO_VISIBLE_AUTHORED_CONTENT',
            'GENERATOR_PREVIEW_MISSING',
        ]))
    })

    it('warns but passes when a new scene has no authored nodes', () => {
        const fixture = createFixture()

        const report = authoringQualityReport(fixture.viewer)

        expect(report).toMatchObject({ok: true, status: 'pass'})
        expect(report.issues).toContainEqual(expect.objectContaining({
            code: 'NO_VISIBLE_AUTHORED_CONTENT', severity: 'warning',
        }))
        expect(codes(report)).not.toContain('CAMERA_NOT_USEFUL')
    })

    it('rejects a leaked runtime object after Stop', () => {
        const fixture = createFixture()
        addDirectRoom(fixture.modelRoot)
        const leaked = box('Leaked Enemy', 0xff3344)
        fixture.scene.add(leaked)

        expect(codes(runtimeCleanupReport(fixture.viewer))).toContain('RUNTIME_OBJECT_AFTER_STOP')
    })

    it('rejects a runtime instance whose source was deleted', () => {
        const fixture = createFixture()
        addDirectRoom(fixture.modelRoot)
        const orphan = box('Orphan Runtime Copy', 0xff3344)
        orphan.userData.kite3dAuthoring = {role: 'template', id: 'orphan', sourceId: 'deleted-source'}
        orphan.userData.kite3dRuntime = {ownerId: 'spawner', kind: 'clone', sourceId: 'deleted-source'}
        fixture.scene.add(orphan)

        expect(codes(runtimeCleanupReport(fixture.viewer))).toContain('MISSING_AUTHORING_SOURCE')
    })

    it('rejects a stale clone whose source material changed', () => {
        const fixture = createFixture()
        addDirectRoom(fixture.modelRoot)
        const template = box('Editable Template', 0x33cc88)
        setAuthoringMetadata(template, {role: 'template', id: 'editable-template'})
        template.visible = false
        fixture.modelRoot.add(template)
        const stale = template.clone()
        stale.name = 'Stale Runtime Copy'
        stale.visible = true
        stale.material = (template.material as MeshStandardMaterial).clone()
        ;(stale.material as MeshStandardMaterial).color.set(0xcc3388)
        stale.userData.kite3dAuthoring = {role: 'template', id: 'stale', sourceId: 'editable-template'}
        stale.userData.kite3dRuntime = {
            ownerId: 'spawner', kind: 'clone', sourceId: 'editable-template', overrides: ['position', 'rotation', 'visible'],
        }
        fixture.scene.add(stale)

        expect(codes(runtimeCleanupReport(fixture.viewer))).toContain('RUNTIME_SOURCE_DRIFT')
    })

    it('reports save-reload drift at the exact semantic path and normalizes negative zero', () => {
        const before = createFixture()
        const {marker} = addDirectRoom(before.modelRoot)
        marker.position.y = -0
        const first = semanticSceneSnapshot(before.viewer)
        marker.position.x = 3
        marker.position.y = 0
        const report = persistenceReport(first, semanticSceneSnapshot(before.viewer))

        expect(report.ok).toBe(false)
        expect(report.changes).toEqual([{
            path: '/scene/Room/children/Marker/position/x', before: 0, after: 3,
        }])
        expect(report.issues[0]).toMatchObject({code: 'PERSISTENCE_DRIFT'})
    })

    it('uses indexes only when a persisted child has no name', () => {
        const fixture = createFixture()
        const {room, marker} = addDirectRoom(fixture.modelRoot)
        marker.name = ''
        const before = semanticSceneSnapshot(fixture.viewer)
        marker.position.x = 3

        expect(persistenceReport(before, semanticSceneSnapshot(fixture.viewer)).changes).toEqual([{
            path: '/scene/Room/children/1/position/x', before: 0, after: 3,
        }])
        expect(room.name).toBe('Room')
    })

    it('omits excluded directional light targets from persisted semantics', () => {
        const fixture = createFixture()
        const light = new DirectionalLight2()
        light.name = 'KeyLight'
        fixture.modelRoot.add(light)

        expect(light.target.userData.excludeFromExport).toBe(true)
        expect(new SpotLight2().target.userData.excludeFromExport).toBe(true)
        expect(semanticSceneSnapshot(fixture.viewer).scene).toEqual([
            expect.objectContaining({name: 'KeyLight', children: []}),
        ])
    })

    it('rejects a camera inside a solid box', () => {
        const fixture = createFixture([0, 0, 0], [0, 0, -1])
        fixture.modelRoot.add(box('Solid Room', 0x224466, [10, 10, 10]))

        const report = authoringQualityReport(fixture.viewer)
        expect(codes(report)).toContain('CAMERA_NOT_USEFUL')
        expect(report.metrics.cameraInsideRenderableCount).toBe(1)
        expect(report.issues.find(({code}) => code === 'CAMERA_NOT_USEFUL')?.message)
            .toContain('scene.defaultCamera "Saved Camera"')
    })

    it('treats a camera exactly on a mesh face as outside', () => {
        const fixture = createFixture([0, 0, 3], [0, -0.1, 0])
        const floor = box('Floor', 0x224466, [8, 0.25, 8])
        floor.position.y = -0.125
        fixture.modelRoot.add(floor)

        expect(authoringQualityReport(fixture.viewer)).toMatchObject({ok: true, status: 'pass'})
    })

    it('judges the saved default camera instead of the active viewport camera', () => {
        const fixture = createFixture([8, 8, 8], [0, 0, 0])
        fixture.modelRoot.add(box('Solid Room', 0x224466, [10, 10, 10]))
        const viewport = new PerspectiveCamera(50, 1, 0.1, 100)
        viewport.name = 'Edit Viewport'
        viewport.position.set(0, 0, 0)
        viewport.lookAt(0, 0, -1)
        fixture.scene.add(viewport)
        fixture.scene.mainCamera = viewport

        expect(authoringQualityReport(fixture.viewer)).toMatchObject({ok: true, status: 'pass'})
    })

    it('passes a camera beside a rotated floor', () => {
        const fixture = createFixture([2, 0, 3], [0, 0.5, 0])
        const {floor} = addDirectRoom(fixture.modelRoot)
        floor.rotation.z = Math.PI / 4

        expect(authoringQualityReport(fixture.viewer)).toMatchObject({ok: true})
    })

    it('passes a camera in a torus hole with a containment advisory', () => {
        const fixture = createFixture([0, 0, 0], [3, 0, 0])
        const ring = new Mesh(new TorusGeometry(3, 0.2, 8, 24), new MeshStandardMaterial({color: 0x72e0a5}))
        ring.name = 'Hollow Ring'
        fixture.modelRoot.add(ring)

        const report = authoringQualityReport(fixture.viewer)
        expect(report.ok).toBe(true)
        expect(report.issues).toContainEqual(expect.objectContaining({
            code: 'CAMERA_CONTAINMENT_UNVERIFIED', severity: 'warning',
        }))
    })

    it('rejects authored content outside the camera view', () => {
        const fixture = createFixture([8, 8, 8], [0, 0, 0])
        addDirectRoom(fixture.modelRoot)
        fixture.camera.far = 2
        fixture.camera.updateProjectionMatrix()

        expect(codes(authoringQualityReport(fixture.viewer))).toContain('CAMERA_NOT_USEFUL')
    })
})

function createFixture(position: [number, number, number] = [8, 8, 8], target: [number, number, number] = [0, 0, 0]) {
    const scene = new Scene() as Scene & {
        modelRoot: Group
        mainCamera: PerspectiveCamera
        defaultCamera: PerspectiveCamera
    }
    const modelRoot = new Group()
    modelRoot.name = 'Scene'
    const camera = new PerspectiveCamera(50, 1, 0.1, 100)
    camera.name = 'Saved Camera'
    camera.position.set(...position)
    camera.lookAt(...target)
    scene.add(modelRoot, camera)
    scene.modelRoot = modelRoot
    scene.mainCamera = camera
    scene.defaultCamera = camera
    scene.updateMatrixWorld(true)
    return {scene, modelRoot, camera, viewer: {scene} as unknown as {scene: Scene}}
}

function addDirectRoom(modelRoot: Group) {
    const room = new Group()
    setAuthoringMetadata(room, {role: 'direct', id: 'room'})
    room.name = 'Room'
    const floor = box('Floor', 0x2a3c52, [8, 0.25, 8])
    floor.position.y = -0.125
    const marker = box('Marker', 0x72e0a5)
    marker.position.set(0, 0.5, 0)
    room.add(floor, marker)
    modelRoot.add(room)
    return {room, floor, marker}
}

function addGenerator(modelRoot: Group, previewZ: number) {
    const generator = new Group()
    setAuthoringMetadata(generator, {role: 'generator', id: 'track-generator'})
    generator.name = 'Track Generator'
    generator.userData.EntityComponentPlugin = {
        generator: {type: 'Generator', state: {module: 'generators/track.js', params: {segments: 1}}},
    }
    const preview = box('Track Preview', 0x4ad6d6, [3, 0.2, 3])
    preview.position.z = previewZ
    generator.add(preview)
    modelRoot.add(generator)
    return generator
}

function box(name: string, color: number, size: [number, number, number] = [1, 1, 1]): Mesh {
    const object = new Mesh(new BoxGeometry(...size), new MeshStandardMaterial({color, roughness: 0.65}))
    object.name = name
    return object
}

function codes(report: {issues: Array<{code: string}>}): string[] {
    return report.issues.map(({code}) => code)
}
