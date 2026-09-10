import {expect, test} from '@playwright/test'
import {mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {initProject, runDev} from '../../../blitz/src/commands.ts'
import type {DevServer} from '../../../blitz/src/server.ts'
import {startMockBackend, type MockBackend} from '../../../blitz/test/mockBackend.ts'

let root: string
let server: DevServer
let backend: MockBackend

test.beforeAll(async () => {
    root = await mkdtemp(resolve(tmpdir(), 'blitz-editor-e2e-'))
    await initProject(root)
    const packagePath = resolve(root, 'package.json')
    const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as {
        blitz: {plugins: string[], scripts: string[]}
    }
    packageJson.blitz.plugins = ['./Hot.plugin.js:HotPlugin']
    packageJson.blitz.scripts = ['./Hot.script.js']
    await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)
    await writeFile(resolve(root, 'main.js'), `
export async function main({viewer}) {
    window.__blitzMainRan = true
    window.__blitzLoopTicks = 0
    viewer.addEventListener('preFrame', () => { window.__blitzLoopTicks += 1 })
}
`)
    await writeFile(resolve(root, 'Hot.script.js'), hotScript('v1'))
    await writeFile(resolve(root, 'Hot.plugin.js'), hotPlugin('v1'))
    const scenePath = resolve(root, 'assets/main.scene.gltf')
    const scene = JSON.parse(await readFile(scenePath, 'utf8')) as {
        scenes: Array<{nodes: number[]}>
        nodes: Array<Record<string, unknown>>
    }
    scene.nodes.push({
        name: 'Hot reload target',
        extras: {EntityComponentPlugin: {'hot-component': {type: 'HotScript', state: {}}}},
    })
    scene.scenes[0].nodes.push(0)
    await writeFile(scenePath, `${JSON.stringify(scene, null, 2)}\n`)
    const engineRoot = fileURLToPath(new URL('../../../engine/', import.meta.url))
    await mkdir(resolve(root, 'node_modules/@blitzdev/engine/dist'), {recursive: true})
    await writeFile(resolve(root, 'node_modules/@blitzdev/engine/package.json'), await readFile(resolve(engineRoot, 'package.json')))
    await writeFile(resolve(root, 'node_modules/@blitzdev/engine/dist/runtime.js'), await readFile(resolve(engineRoot, 'dist/runtime.js')))
    backend = await startMockBackend()
    server = await runDev({projectRoot: root, port: 0, noOpen: true, backendUrl: backend.url})
})

test.afterAll(async () => {
    await server.close()
    await backend.close()
    await rm(root, {recursive: true, force: true})
})

test('loads, watches scripts, saves the scene without echo reload, and plays main.js', async ({page}) => {
    test.setTimeout(90_000)
    const errors: string[] = []
    const consoleMessages: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => consoleMessages.push(message.text()))
    await page.goto(server.url)
    await expect(page.getByRole('heading', {name: 'blitz-editor-e2e-'})).toBeVisible()
    await expect(page.getByText('Project loaded')).toBeVisible({timeout: 15_000})

    await writeFile(resolve(root, 'Live.script.js'), `
import {Object3DComponent} from 'threepipe'
export class LiveComponent extends Object3DComponent { static ComponentType = 'LiveComponent' }
`)
    await writeFile(resolve(root, 'Generator.js'), `
export default function generate({node, params, engine}) {
    for (let index = 0; index < params.count; index += 1) {
        const child = new engine.Group()
        child.name = 'Tree ' + index
        node.add(child)
    }
}
`)
    await expect(page.getByTestId('component-types')).toContainText('LiveComponent', {timeout: 10_000})

    const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as {mainScene: string}
    expect(packageJson.mainScene).toBe('assets/main.scene.gltf')
    await expect(page.locator('label[for="scene"]')).toContainText(packageJson.mainScene)

    const before = await manifestHash(packageJson.mainScene)
    const scene = JSON.parse(await readFile(resolve(root, packageJson.mainScene), 'utf8')) as {
        scenes: Array<{nodes: number[]}>
        nodes: Array<{name?: string, mesh?: number, extras?: Record<string, unknown>}>
        [key: string]: unknown
    }
    scene.nodes.push({name: 'RoundTripObject'})
    scene.scenes[0].nodes.push(scene.nodes.length - 1)
    scene.buffers = [{byteLength: 36, uri: 'data:application/octet-stream;base64,Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/'}]
    scene.bufferViews = [{buffer: 0, byteOffset: 0, byteLength: 36, target: 34962}]
    scene.accessors = [{bufferView: 0, componentType: 5126, count: 3, type: 'VEC3'}]
    scene.meshes = [{primitives: [{attributes: {POSITION: 0}}]}]
    scene.nodes[scene.nodes.length - 1].mesh = 0
    scene.nodes[scene.nodes.length - 1].extras = {
        EntityComponentPlugin: {
            'round-trip-generator': {
                type: 'Generator',
                state: {module: 'Generator.js', params: {count: 2}},
            },
        },
    }
    scene.images = [{uri: 'data:image/png;base64,iVBORw0KGgo='}]
    await page.getByTestId('scene-source').fill(JSON.stringify(scene))
    await expect(page.getByTestId('scene-objects')).toContainText('RoundTripObject')
    await page.getByTestId('scene-source').blur()
    await expect(page.getByText('Scene saved')).toBeVisible()
    await expect.poll(() => manifestHash(packageJson.mainScene)).not.toBe(before)
    await expect.poll(async () => (await readFile(resolve(root, packageJson.mainScene), 'utf8')).includes('RoundTripObject')).toBe(true)
    const savedScene = await readFile(resolve(root, packageJson.mainScene), 'utf8')
    expect(savedScene.startsWith('{')).toBe(true)
    expect(JSON.parse(savedScene)).toHaveProperty('asset')
    expect(savedScene).toContain('RoundTripObject')
    expect(savedScene).not.toContain('data:')
    expect(JSON.parse(savedScene)).toMatchObject({buffers: [{uri: 'main.scene.bin'}]})
    expect((await readFile(resolve(root, 'assets/main.scene.bin'))).byteLength).toBe(36)
    expect((await readdir(resolve(root, 'assets/textures'))).length).toBe(1)
    await expect(page.getByText('Scene saved')).toBeVisible()
    const journal = (await readFile(resolve(root, '.blitz/journal.jsonl'), 'utf8'))
        .split('\n').filter(Boolean).map((line) => JSON.parse(line) as {
            client: string
            summary: {nodesAdded: Array<{name?: string}>}
        })
    expect(journal[0].client).not.toBe('external')
    expect(journal[0].summary.nodesAdded).toContainEqual({name: 'RoundTripObject'})

    await page.reload()
    await expect(page.getByText('Project loaded')).toBeVisible({timeout: 15_000})
    await expect(page.getByTestId('scene-objects')).toContainText('RoundTripObject')

    await page.getByTestId('play').click()
    await expect(page.getByText('Playing')).toBeVisible({timeout: 20_000})
    await expect.poll(() => page.evaluate(() => Boolean((window as unknown as {__blitzMainRan?: boolean}).__blitzMainRan))).toBe(true)
    await expect.poll(() => page.evaluate(() => (window as unknown as {__hotScriptVersion?: string}).__hotScriptVersion)).toBe('v1')
    await expect.poll(() => page.evaluate(() => (window as unknown as {__hotPluginVersion?: string}).__hotPluginVersion)).toBe('v1')
    await expect(page.getByTestId('scene-hierarchy')).toContainText('Tree 0 generated')
    await expect(page.getByTestId('scene-hierarchy')).toContainText('Tree 1 generated')
    expect(await readFile(resolve(root, packageJson.mainScene), 'utf8')).not.toContain('Tree 0')

    await page.getByTestId('generator-params-1').fill('{"count": 3}')
    await page.getByTestId('generator-params-1').blur()
    await expect(page.getByTestId('scene-hierarchy')).toContainText('Tree 2 generated')

    await writeFile(resolve(root, 'Generator.js'), `
export default function generate({node, params, engine}) {
    for (let index = 0; index < params.count + 1; index += 1) {
        const child = new engine.Group()
        child.name = 'Reloaded tree ' + index
        node.add(child)
    }
}
`)
    await expect(page.getByText('Generator.js regenerated')).toBeVisible({timeout: 15_000})
    await expect(page.getByTestId('scene-hierarchy')).toContainText('Reloaded tree 3 generated')

    await writeFile(resolve(root, 'Hot.script.js'), hotScript('v2'))
    await expect(page.getByText('Hot.script.js reloaded')).toBeVisible({timeout: 15_000})
    await expect.poll(() => page.evaluate(() => (window as unknown as {__hotScriptVersion?: string}).__hotScriptVersion)).toBe('v2')
    await writeFile(resolve(root, 'Hot.plugin.js'), hotPlugin('v2'))
    await expect(page.getByText('Hot.plugin.js reloaded')).toBeVisible({timeout: 15_000})
    await expect.poll(() => page.evaluate(() => (window as unknown as {__hotPluginVersion?: string}).__hotPluginVersion)).toBe('v2')
    const moduleUrls = await page.evaluate(() => performance.getEntriesByType('resource').map(({name}) => name))
    expect(moduleUrls.some((url) => /\/files\/Hot\.script\.js\?v=[a-f\d]{64}$/.test(url))).toBe(true)
    expect(moduleUrls.some((url) => /\/files\/Hot\.plugin\.js\?v=[a-f\d]{64}$/.test(url))).toBe(true)

    await page.evaluate(() => {
        for (let index = 0; index < 30; index += 1) console.error(`[rate-limit-check] ${index}`)
    })
    await expect.poll(async () => (await readFile(resolve(root, '.blitz/console.log'), 'utf8').catch(() => '')).includes('[HotScript] v2')).toBe(true)
    await expect.poll(async () => (await readFile(resolve(root, '.blitz/console.log'), 'utf8').catch(() => '')).includes('[rate-limit-check] 0')).toBe(true)
    const consoleLog = await readFile(resolve(root, '.blitz/console.log'), 'utf8')
    expect(consoleLog).toContain('[rate-limit-check] 0')
    expect(consoleLog.match(/\[rate-limit-check\]/g)?.length || 0).toBeLessThanOrEqual(20)

    await page.getByTestId('bake-1').click()
    await expect(page.getByText('Baked RoundTripObject')).toBeVisible({timeout: 20_000})
    const bakedSceneText = await readFile(resolve(root, packageJson.mainScene), 'utf8')
    const bakedScene = JSON.parse(bakedSceneText) as {
        nodes: Array<{name?: string, children?: number[], extras?: Record<string, unknown>}>
    }
    const bakedRoot = bakedScene.nodes.find(({name}) => name === 'RoundTripObject')
    expect(bakedRoot?.children).toHaveLength(4)
    expect(bakedRoot?.extras).toHaveProperty('blitzBakedFrom')
    expect(bakedSceneText).not.toContain('blitzGenerated')
    expect(bakedSceneText).not.toContain('excludeFromExport')
    expect(bakedSceneText).not.toContain('"type": "Generator"')

    await writeFile(resolve(root, 'Live.script.js'), `
import {Object3DComponent} from 'threepipe'
export class UpdatedComponent extends Object3DComponent { static ComponentType = 'UpdatedComponent' }
`)
    await expect(page.getByTestId('component-types')).toContainText('UpdatedComponent', {timeout: 15_000})
    await expect.poll(async () => Boolean(await readFile(resolve(root, '.blitz/state.json'), 'utf8'))).toBe(true)
    expect(consoleMessages.some((message) => message.includes('Multiple instances of Three.js'))).toBe(false)
    expect(errors).toEqual([])
})

test('queues Play during project load and keeps one stable update loop across three starts', async ({page}) => {
    let delayedManifest = false
    await page.route('**/api/files', async (route) => {
        if (!delayedManifest) {
            delayedManifest = true
            await new Promise((resolveDelay) => setTimeout(resolveDelay, 500))
        }
        await route.continue()
    })
    await page.goto(server.url)
    await expect(page.getByText('Loading project…')).toBeVisible()
    await page.getByTestId('play').click()
    await page.getByTestId('play').click()
    await expect(page.getByText('Playing')).toBeVisible({timeout: 20_000})
    await expect.poll(async () => JSON.parse(await readFile(resolve(root, '.blitz/state.json'), 'utf8')).playState).toBe('playing')

    const counts: number[] = []
    for (let start = 0; start < 3; start += 1) {
        if (start > 0) {
            await page.getByTestId('play').click()
            await expect(page.getByText('Playing')).toBeVisible({timeout: 20_000})
        }
        await page.evaluate(() => { (window as unknown as {__blitzLoopTicks: number}).__blitzLoopTicks = 0 })
        await page.waitForTimeout(600)
        counts.push(await page.evaluate(() => (window as unknown as {__blitzLoopTicks: number}).__blitzLoopTicks))
        expect(await page.evaluate(() => ((window as unknown as {threeViewers?: unknown[]}).threeViewers || []).length)).toBe(1)
        await page.getByTestId('play').click()
        await expect(page.getByText('Stopped')).toBeVisible()
        const stoppedAt = await page.evaluate(() => (window as unknown as {__blitzLoopTicks: number}).__blitzLoopTicks)
        await page.waitForTimeout(150)
        expect(await page.evaluate(() => (window as unknown as {__blitzLoopTicks: number}).__blitzLoopTicks)).toBe(stoppedAt)
        expect(await page.evaluate(() => ((window as unknown as {threeViewers?: unknown[]}).threeViewers || []).length)).toBe(0)
    }
    expect(Math.min(...counts)).toBeGreaterThan(10)
    expect(Math.max(...counts) / Math.min(...counts)).toBeLessThan(1.5)
})

test('reports a corrupt scene in the editor and console log', async ({page}) => {
    await page.goto(server.url)
    await expect(page.getByText('Project loaded')).toBeVisible({timeout: 15_000})
    const scenePath = 'assets/main.scene.gltf'
    const valid = await readFile(resolve(root, scenePath), 'utf8')
    await writeFile(resolve(root, scenePath), '{not gltf')

    await expect(page.getByRole('alert')).toContainText('JSON', {timeout: 10_000})
    await expect.poll(async () => (await readFile(resolve(root, '.blitz/console.log'), 'utf8').catch(() => '')).includes('JSON')).toBe(true)

    await writeFile(resolve(root, scenePath), valid)
})

test('creates, updates, and claims a live game from the editor dialog', async ({page}) => {
    await page.goto(server.url)
    await expect(page.getByText('Project loaded')).toBeVisible({timeout: 15_000})
    await page.getByTestId('open-game').click()
    await expect(page.getByRole('dialog')).toBeVisible()
    const slugInput = page.locator('#publish-slug')
    const slug = await slugInput.inputValue()
    await expect(page.getByText('Available', {exact: true})).toBeVisible()

    const popupPromise = page.waitForEvent('popup')
    await page.getByTestId('create-live-game').click()
    const popup = await popupPromise
    await expect(page.getByTestId('live-url')).toHaveAttribute('href', `${backend.url}/preview/${slug}/`, {timeout: 20_000})
    await expect.poll(() => backend.releaseCount(slug)).toBe(1)
    await expect(popup).toHaveURL(`${backend.url}/preview/${slug}/`)

    await page.getByTestId('publish-update').click()
    await expect.poll(() => backend.releaseCount(slug)).toBe(2)
    await expect(page.getByTestId('publish-update')).toBeVisible()

    await page.locator('#claim-email').fill('editor@example.com')
    await page.locator('#claim-password').fill('password123')
    await page.getByTestId('claim-game').click()
    await expect(page.getByTestId('claimed-notice')).toContainText('does not expire')
    await expect(page.getByText(/left\. Sign in and claim/)).toHaveCount(0)
    expect(backend.games.get(slug)?.claimed).toBe(true)
})

async function manifestHash(path: string): Promise<string | undefined> {
    const response = await fetch(`http://127.0.0.1:${server.port}/api/files`, {headers: {'X-Blitz-Token': server.token}})
    const manifest = await response.json() as Array<{path: string, sha256: string}>
    return manifest.find((entry) => entry.path === path)?.sha256
}

function hotScript(version: string): string {
    return `
import {Object3DComponent} from 'threepipe'
export class HotScript extends Object3DComponent {
    static ComponentType = 'HotScript'
    start() {
        window.__hotScriptVersion = '${version}'
        console.error('[HotScript] ${version}')
    }
}
`
}

function hotPlugin(version: string): string {
    return `
import {AViewerPluginSync} from 'threepipe'
export class HotPlugin extends AViewerPluginSync {
    static PluginType = 'HotPlugin'
    enabled = true
    onAdded(viewer) {
        super.onAdded(viewer)
        window.__hotPluginVersion = '${version}'
    }
}
`
}
