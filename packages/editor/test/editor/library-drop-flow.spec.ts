import {expect, test, type Page} from '@playwright/test'
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import {initProject, runDev} from '../../../kite3d/src/commands.ts'
import type {DevServer} from '../../../kite3d/src/server.ts'

const catalogUrl = 'https://blitz-asset-library-proxy.blitzapp.workers.dev/assets/v1/list'
const modelUrl = 'https://library.example.test/slow-model.gltf'
const failedDropUrl = 'https://library.example.test/failed-drop.gltf'
const failedDoubleClickUrl = 'https://library.example.test/failed-double-click.gltf'
const materialUrl = 'https://library.example.test/red-material.pmat'

// Guards the owner's report: a slow library drop completed before its import finished.
test('waits for a slow library import before completing the drop', async ({page}) => {
    test.setTimeout(60_000)
    const fixture = await startEditor()
    await routeLibrary(page, {slowModel: true})
    try {
        await openLibrary(page, fixture.server)
        const item = page.getByTitle(modelUrl)
        await dropImmediately(page, item)

        await expect(page.locator('.native-spinner'), 'slow drop keeps its spinner while the import is pending')
            .toHaveCSS('display', 'block')
        const dialog = page.getByTestId('library-drop-dialog')
        await expect(dialog, 'slow drop waits for the pending import').toBeVisible({timeout: 20_000})
        await expect(page.locator('.native-spinner')).toHaveCSS('display', 'none')
        await dialog.getByRole('radio', {name: 'Add at the scene root'}).check({force: true})
        await dialog.getByTestId('library-drop-apply').click()

        await expect(page.getByTestId('scene-hierarchy'), 'slow drop adds the model node after import')
            .toContainText('Slow Test Model')
        await expect(page.getByTestId('save-scene'), 'slow model drop marks the scene as needing save').toBeEnabled()
    } finally {
        await fixture.close()
    }
})

// Guards the owner's report: a failed library drop was silent and left partial scene state.
test('shows an error and leaves the scene clean when a library drop import fails', async ({page}) => {
    const fixture = await startEditor()
    await routeLibrary(page)
    try {
        await openLibrary(page, fixture.server)
        const hierarchyBefore = await page.getByTestId('scene-hierarchy').textContent()
        await dropImmediately(page, page.getByTitle(failedDropUrl))

        const toast = page.locator('.bp5-toast').filter({hasText: 'Unable to import Failed Drop Model'})
        await expect(toast, 'failed drop reports the asset name').toBeVisible()
        await expect(toast).toContainText('500')
        await expect(page.getByTestId('scene-hierarchy')).toHaveText(hierarchyBefore || '')
        await expect(page.getByTestId('save-scene')).toBeDisabled()
    } finally {
        await fixture.close()
    }
})

// Guards the owner's report: an applied library material was not marked dirty or saved.
test('marks a material drop dirty and saves the applied material', async ({page}) => {
    const fixture = await startEditor()
    await routeLibrary(page)
    try {
        await openLibrary(page, fixture.server)
        await selectObject(page, 'Material_Target')
        const libraryPanel = page.getByRole('tabpanel', {name: 'Library'})
        await libraryPanel.getByRole('tab', {name: 'Materials'}).click()
        await dropImmediately(page, page.getByTitle(materialUrl))
        const dialog = page.getByTestId('library-drop-dialog')
        await expect(dialog).toBeVisible()
        await dialog.getByTestId('library-drop-apply').click()

        await expect(page.getByTestId('save-scene'), 'material drop marks the scene as needing save').toBeEnabled()
        await page.getByTestId('save-scene').click()
        await expect(page.getByTestId('save-scene')).toBeDisabled({timeout: 20_000})

        await expect.poll(async () => {
            const saved = JSON.parse(await readFile(fixture.scenePath, 'utf8')) as {
                nodes: Array<{name?: string, mesh?: number}>
                meshes: Array<{primitives: Array<{material?: number}>}>
                materials: Array<{name?: string}>
            }
            const target = saved.nodes.find(({name}) => name === 'Material_Target')
            const materialIndex = target?.mesh === undefined
                ? undefined
                : saved.meshes[target.mesh].primitives[0].material
            return materialIndex === undefined ? undefined : saved.materials[materialIndex].name
        }).toBe('Test Red Material')
    } finally {
        await fixture.close()
    }
})

async function startEditor(): Promise<{scenePath: string, server: DevServer, close(): Promise<void>}> {
    const root = await mkdtemp(resolve(tmpdir(), 'kite3d-library-drop-'))
    await initProject(root, {git: false})
    const scenePath = resolve(root, 'assets/main.scene.gltf')
    await writeFile(scenePath, `${targetScene()}\n`)
    const server = await runDev({projectRoot: root, port: 0, noOpen: true})
    return {
        scenePath,
        server,
        async close() {
            try {
                await server.close()
            } finally {
                await rm(root, {recursive: true, force: true})
            }
        },
    }
}

async function routeLibrary(page: Page, options: {slowModel?: boolean} = {}) {
    const thumbnailUrl = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>'
    await page.route(catalogUrl, (route) => route.fulfill({json: {assets: [
        {id: '@test/slow', name: 'Slow Test Model', type: 'model', fileUrl: modelUrl, thumbnailUrl},
        {id: '@test/failed-drop', name: 'Failed Drop Model', type: 'model', fileUrl: failedDropUrl, thumbnailUrl},
        {id: '@test/failed-double', name: 'Failed Double Click Model', type: 'model', fileUrl: failedDoubleClickUrl, thumbnailUrl},
        {id: '@test/red', name: 'Test Red Material', type: 'material', fileUrl: materialUrl, thumbnailUrl},
    ]}}))
    await page.route(modelUrl, async (route) => {
        if (options.slowModel) await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000))
        await route.fulfill({status: 200, contentType: 'model/gltf+json', body: triangleModel()})
    })
    await page.route(failedDropUrl, (route) =>
        route.fulfill({status: 200, contentType: 'model/gltf+json', body: triangleModel()}))
    await page.route(failedDoubleClickUrl, (route) =>
        route.fulfill({status: 200, contentType: 'model/gltf+json', body: triangleModel()}))
    await page.route(/\/files\/assets\/imports\/failed-drop\/f\.gltf(?:\?.*)?$/, (route) =>
        route.fulfill({status: 500, body: 'Drop failed'}))
    await page.route(/\/files\/assets\/imports\/failed-double-click\/f\.gltf(?:\?.*)?$/, (route) =>
        route.fulfill({status: 500, body: 'Double click failed'}))
    await page.route(materialUrl, (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
            metadata: {version: 4.6, type: 'Material', generator: 'Material.toJSON'},
            uuid: '29374416-538f-43ae-9829-e65d536f46d9',
            type: 'MeshStandardMaterial',
            name: 'Test Red Material',
            color: 0xcc3344,
            roughness: 0.35,
            metalness: 0.1,
        }),
    }))
    await page.route('https://accounts.google.com/gsi/client', (route) => route.fulfill({
        contentType: 'text/javascript',
        body: 'window.google={accounts:{id:{initialize(){},renderButton(){},prompt(){}}}}',
    }))
}

async function openLibrary(page: Page, server: DevServer) {
    await page.goto(server.url)
    await page.waitForFunction(
        () => (window as Window & {kite3dProjectLoaded?: boolean}).kite3dProjectLoaded === true,
        undefined,
        {timeout: 20_000},
    )
    await page.getByRole('tab', {name: 'Library'}).click()
    await page.getByRole('tabpanel', {name: 'Library'}).getByRole('tab', {name: '3D Models'}).click()
}

async function dropImmediately(page: Page, item: ReturnType<Page['getByTitle']>) {
    await expect(item).toBeVisible()
    const transfer = await page.evaluateHandle(() => new DataTransfer())
    await item.dispatchEvent('dragstart', {dataTransfer: transfer})
    const canvas = page.locator('.editorCanvasContainer canvas').first()
    const bounds = await canvas.boundingBox()
    expect(bounds).not.toBeNull()
    const position = {clientX: bounds!.x + bounds!.width / 2, clientY: bounds!.y + bounds!.height / 2}
    await canvas.dispatchEvent('dragover', {...position, dataTransfer: transfer})
    await canvas.dispatchEvent('drop', {...position, dataTransfer: transfer})
    await item.dispatchEvent('dragend', {dataTransfer: transfer})
}

async function selectObject(page: Page, name: string) {
    await page.evaluate((objectName) => {
        const viewer = (window as unknown as {viewer: {scene: {modelRoot: {getObjectByName(name: string): {
            dispatchEvent(event: Record<string, unknown>): void
        } | undefined}}}}).viewer
        const object = viewer.scene.modelRoot.getObjectByName(objectName)
        if (!object) throw new Error(`Missing scene object ${objectName}`)
        object.dispatchEvent({type: 'select', value: object, object, ui: true, bubbleToParent: true})
    }, name)
}

function targetScene() {
    return JSON.stringify({
        asset: {version: '2.0'},
        scene: 0,
        scenes: [{nodes: [0]}],
        nodes: [{name: 'Material Target', mesh: 0}],
        meshes: [{primitives: [{attributes: {POSITION: 0}, material: 0}]}],
        materials: [{name: 'Original Material', pbrMetallicRoughness: {baseColorFactor: [0.2, 0.4, 0.8, 1]}}],
        accessors: [{
            bufferView: 0,
            componentType: 5126,
            count: 3,
            type: 'VEC3',
            min: [0, 0, 0],
            max: [1, 1, 0],
        }],
        bufferViews: [{buffer: 0, byteOffset: 0, byteLength: 36, target: 34962}],
        buffers: [{
            byteLength: 36,
            uri: 'data:application/octet-stream;base64,AAAAAAAAAAAAAAAAAACAPwAAAAAAAAAAAAAAAAAAgD8AAAAA',
        }],
    })
}

function triangleModel() {
    return JSON.stringify({
        asset: {version: '2.0'},
        scene: 0,
        scenes: [{nodes: [0]}],
        nodes: [{name: 'Slow Model Mesh', mesh: 0}],
        meshes: [{primitives: [{attributes: {POSITION: 0}}]}],
        accessors: [{
            bufferView: 0,
            componentType: 5126,
            count: 3,
            type: 'VEC3',
            min: [0, 0, 0],
            max: [1, 1, 0],
        }],
        bufferViews: [{buffer: 0, byteOffset: 0, byteLength: 36, target: 34962}],
        buffers: [{
            byteLength: 36,
            uri: 'data:application/octet-stream;base64,AAAAAAAAAAAAAAAAAACAPwAAAAAAAAAAAAAAAAAAgD8AAAAA',
        }],
    })
}
