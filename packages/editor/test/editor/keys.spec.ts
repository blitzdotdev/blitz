import {expect, test, type Page} from '@playwright/test'
import {mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {initProject, runDev} from '../../../kite3d/src/commands.ts'
import {type DevServer} from '../../../kite3d/src/server.ts'
import {closeFixtureSteps} from './fixtureClose.ts'

let root: string
let server: DevServer

test.beforeAll(async () => {
    root = await mkdtemp(resolve(tmpdir(), 'kite3d-editor-keys-'))
    await initProject(root)
    await writeFile(resolve(root, 'assets/main.scene.gltf'), `${JSON.stringify(keysScene(), null, 2)}\n`)

    const engineRoot = fileURLToPath(new URL('../../../engine/', import.meta.url))
    await mkdir(resolve(root, 'node_modules/@kite3d/engine/dist'), {recursive: true})
    await writeFile(resolve(root, 'node_modules/@kite3d/engine/package.json'), await readFile(resolve(engineRoot, 'package.json')))
    await writeFile(resolve(root, 'node_modules/@kite3d/engine/dist/runtime.js'), await readFile(resolve(engineRoot, 'dist/runtime.js')))
    await symlink(resolve(engineRoot, '../../node_modules/threepipe'), resolve(root, 'node_modules/threepipe'))
    server = await runDev({projectRoot: root, port: 0, noOpen: true})
})

test.afterAll(async () => {
    try {
        await closeFixtureSteps([{name: 'keys editor dev server', close: () => server.close()}])
    } finally {
        await rm(root, {recursive: true, force: true})
    }
})

test('persists bracket-key camera speed and shows the viewport label', async ({page}) => {
    await openEditor(page)
    await page.evaluate(() => localStorage.removeItem('kite3d.editor.wasdMovementSpeed'))

    await page.keyboard.press(']')
    await page.keyboard.press(']')
    expect(await cameraSpeed(page), 'the ] shortcut should double camera speed twice').toBe(4)

    await page.keyboard.press('[')
    expect(await cameraSpeed(page), 'the [ shortcut should halve camera speed').toBe(2)
    await expect(page.getByTestId('camera-speed-chip'), 'the speed shortcut should show its viewport label').toHaveText('SPEED 2')

    await page.reload()
    await expect(page.getByText('Project loaded')).toBeVisible({timeout: 20_000})
    expect(await cameraSpeed(page), 'camera speed should survive a page reload').toBe(2)

    await page.evaluate(() => {
        const input = document.createElement('input')
        input.dataset.testid = 'shortcut-input'
        document.body.append(input)
        input.focus()
    })
    await page.keyboard.press(']')
    expect(await cameraSpeed(page), 'speed shortcuts should be ignored while typing').toBe(2)
    await page.getByTestId('shortcut-input').evaluate(element => element.remove())

    for (let index = 0; index < 6; index += 1) await page.keyboard.press(']')
    expect(await cameraSpeed(page), 'camera speed should clamp at 64').toBe(64)
    for (let index = 0; index < 11; index += 1) await page.keyboard.press('[')
    expect(await cameraSpeed(page), 'camera speed should clamp at 0.0625').toBe(0.0625)
})

test('isolates every picked object and restores visibility without changing the scene file', async ({page}) => {
    await openEditor(page)
    const scenePath = resolve(root, 'assets/main.scene.gltf')
    const before = await readFile(scenePath)
    await selectObjects(page, ['Mesh_A', 'Mesh_B'])

    await page.keyboard.press('/')
    expect(await objectVisibility(page), 'the / shortcut should hide objects outside the selected set').toEqual({
        Mesh_A: true,
        Mesh_B: true,
        Mesh_C: false,
        Key_Light: true,
    })
    await expect(page.getByTestId('isolated-chip'), 'isolate should show its viewport chip').toHaveText('ISOLATED')

    await clearSelection(page)
    await expect(page.getByTestId('isolated-chip'), 'deselecting should keep isolate active').toBeVisible()
    await page.keyboard.press('/')
    expect(await objectVisibility(page), 'exiting isolate should restore every previous visibility value').toEqual({
        Mesh_A: true,
        Mesh_B: false,
        Mesh_C: true,
        Key_Light: true,
    })
    await expect(page.getByTestId('isolated-chip')).toHaveCount(0)
    await page.waitForTimeout(250)
    expect(await readFile(scenePath), 'isolate should leave the scene file byte-identical').toEqual(before)

    await page.keyboard.press('/')
    await expect(page.getByTestId('isolated-chip'), 'an empty selection should not enter isolate').toHaveCount(0)
})

test('isolates the captured hierarchy node subtree from its context menu', async ({page}) => {
    await openEditor(page)

    await page.locator('.bp5-tree-node-label', {hasText: 'Isolate_Group'}).click({button: 'right'})
    await expect(page.getByText('Isolate', {exact: true}), 'the hierarchy menu should include Isolate').toBeVisible()
    await page.getByText('Isolate', {exact: true}).click()
    expect(await objectVisibility(page), 'the hierarchy Isolate action should keep only that node subtree visible').toEqual({
        Mesh_A: false,
        Mesh_B: true,
        Mesh_C: false,
        Key_Light: true,
    })
    await expect(page.getByTestId('isolated-chip')).toBeVisible()

    await page.locator('.bp5-tree-node-label', {hasText: 'Isolate_Group'}).click({button: 'right'})
    await expect(page.getByText('Exit Isolate', {exact: true}), 'the menu should offer Exit Isolate while active').toBeVisible()
    await page.getByText('Exit Isolate', {exact: true}).click()
    await selectObjects(page, ['Mesh_A', 'Mesh_C'])
    await page.locator('.bp5-tree-node-label', {hasText: 'Mesh_A'}).click({button: 'right'})
    await page.getByText('Isolate', {exact: true}).click()
    expect(await objectVisibility(page), 'right-clicking a selected node should isolate the captured multi-selection').toEqual({
        Mesh_A: true,
        Mesh_B: false,
        Mesh_C: true,
        Key_Light: true,
    })
})

test('exits isolate on Play and ignores edit shortcuts while playing', async ({page}) => {
    await openEditor(page)
    await selectObjects(page, ['Mesh_A'])
    await page.keyboard.press('/')
    await expect(page.getByTestId('isolated-chip'), 'the setup isolate should be active before entering Play').toBeVisible()

    const storedSpeed = await page.evaluate(() => localStorage.getItem('kite3d.editor.wasdMovementSpeed'))
    await page.getByTestId('play').click()
    await expect(page.getByTestId('game-canvas')).toBeVisible()
    await expect(page.getByTestId('isolated-chip'), 'entering Play should exit isolate').toHaveCount(0)
    await expect(page.getByText('Playing')).toBeVisible({timeout: 20_000})
    await page.keyboard.press('/')
    await page.keyboard.press(']')
    await expect(page.getByTestId('isolated-chip'), 'the isolate shortcut should be ignored in Play').toHaveCount(0)
    expect(await page.evaluate(() => localStorage.getItem('kite3d.editor.wasdMovementSpeed')), 'the speed shortcut should be ignored in Play').toBe(storedSpeed)
})

async function openEditor(page: Page) {
    await page.goto(server.url)
    await expect(page.getByText('Project loaded')).toBeVisible({timeout: 20_000})
    await expect(page.getByTestId('edit-mode-status')).toBeAttached()
}

async function cameraSpeed(page: Page) {
    return page.evaluate(() => (window as unknown as {
        viewer: {getPlugin(type: string): {wasdMovementSpeed: number} | undefined}
    }).viewer.getPlugin('EditModePlugin')?.wasdMovementSpeed)
}

async function selectObjects(page: Page, names: string[]) {
    await page.evaluate(selectedNames => {
        const viewer = (window as unknown as {
            viewer: {
                scene: {modelRoot: {traverse(callback: (object: {name: string}) => void): void}}
                getPlugin(type: string): {setSelectedObject(objects: unknown[], focus: boolean, trackUndo: boolean): void}
            }
        }).viewer
        const objects: unknown[] = []
        viewer.scene.modelRoot.traverse(object => {
            if (selectedNames.includes(object.name)) objects.push(object)
        })
        viewer.getPlugin('PickingPlugin').setSelectedObject(objects, false, false)
    }, names)
}

async function clearSelection(page: Page) {
    await page.evaluate(() => (window as unknown as {
        viewer: {getPlugin(type: string): {clearSelection(): void}}
    }).viewer.getPlugin('PickingPlugin').clearSelection())
}

async function objectVisibility(page: Page) {
    return page.evaluate(() => {
        const viewer = (window as unknown as {
            viewer: {scene: {modelRoot: {traverse(callback: (object: {name: string, visible: boolean}) => void): void}}}
        }).viewer
        const visibility: Record<string, boolean> = {}
        viewer.scene.modelRoot.traverse(object => {
            if (['Mesh_A', 'Mesh_B', 'Mesh_C', 'Key_Light'].includes(object.name)) visibility[object.name] = object.visible
        })
        return visibility
    })
}

function keysScene() {
    return {
        asset: {version: '2.0', generator: 'Kite3D keys test'},
        scene: 0,
        scenes: [{name: 'Main Scene', nodes: [0, 2, 3, 4]}],
        nodes: [
            {name: 'Isolate Group', children: [1]},
            {name: 'Mesh B', mesh: 0, extensions: {WEBGI_object3d_extras: {visible: false}}},
            {name: 'Mesh A', mesh: 0},
            {name: 'Mesh C', mesh: 0},
            {name: 'Key Light', extensions: {KHR_lights_punctual: {light: 0}}},
        ],
        extensionsUsed: ['KHR_lights_punctual', 'WEBGI_object3d_extras'],
        extensions: {KHR_lights_punctual: {lights: [{type: 'directional', intensity: 2}]}},
        buffers: [{
            byteLength: 36,
            uri: 'data:application/octet-stream;base64,Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/',
        }],
        bufferViews: [{buffer: 0, byteOffset: 0, byteLength: 36, target: 34962}],
        accessors: [{
            bufferView: 0,
            componentType: 5126,
            count: 3,
            type: 'VEC3',
            min: [0, 0, 0],
            max: [1, 1, 1],
        }],
        meshes: [{primitives: [{attributes: {POSITION: 0}}]}],
    }
}
