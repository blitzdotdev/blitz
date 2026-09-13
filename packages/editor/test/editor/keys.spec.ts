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
    expect(await cameraSpeed(page)).toBe(2)
    await expect(page.getByTestId('camera-speed-chip'), 'the speed shortcut should show its viewport label').toHaveText('SPEED 2')

    await page.reload()
    await expect(page.getByText('Project loaded')).toBeVisible({timeout: 20_000})
    expect(await cameraSpeed(page), 'camera speed should survive a page reload').toBe(2)
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

function keysScene() {
    return {
        asset: {version: '2.0', generator: 'Kite3D keys test'},
        scene: 0,
        scenes: [{name: 'Main Scene', nodes: [0, 2, 3, 4]}],
        nodes: [
            {name: 'Isolate Group', children: [1]},
            {name: 'Mesh B', mesh: 0},
            {name: 'Mesh A', mesh: 0},
            {name: 'Mesh C', mesh: 0},
            {name: 'Key Light', extensions: {KHR_lights_punctual: {light: 0}}},
        ],
        extensionsUsed: ['KHR_lights_punctual'],
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
