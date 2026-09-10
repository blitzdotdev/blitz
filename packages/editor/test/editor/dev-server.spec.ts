import {expect, test} from '@playwright/test'
import {mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {initProject, publishFromDisk, runDev} from '../../../blitz/src/commands.ts'
import {checkProject} from '../../../blitz/src/check.ts'
import {createDevServer, type DevServer} from '../../../blitz/src/server.ts'
import {startMockBackend, type MockBackend} from '../../../blitz/test/mockBackend.ts'

let root: string
let server: DevServer
let backend: MockBackend

test.beforeAll(async () => {
    root = await mkdtemp(resolve(tmpdir(), 'blitz-editor-e2e-'))
    await initProject(root)

    const packagePath = resolve(root, 'package.json')
    const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as {
        blitz: {plugins?: string[], scripts?: string[]}
    }
    packageJson.blitz.plugins = ['./Hot.plugin.js:HotPlugin']
    packageJson.blitz.scripts = [
        './Hot.script.js',
        './reload/Reexport.script.js',
        './reload/Cycle.script.js',
        './reload/Dynamic.script.js',
    ]
    await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)
    await writeFile(resolve(root, 'main.js'), `
export async function main({viewer}) {
    window.__blitzMainRuns = (window.__blitzMainRuns || 0) + 1
    window.__blitzLoopTicks = 0
    window.__blitzRuntimeViewer = viewer
    viewer.addEventListener('preFrame', () => { window.__blitzLoopTicks += 1 })
}
`)
    await writeFile(resolve(root, 'Hot.script.js'), hotScript('v1'))
    await writeFile(resolve(root, 'Hot.plugin.js'), hotPlugin('v1'))
    await mkdir(resolve(root, 'reload'), {recursive: true})
    await writeFile(resolve(root, 'reload/Reexport.script.js'), "export {TransitiveScript} from './transitive-helper.js'\n")
    await writeFile(resolve(root, 'reload/transitive-helper.js'), transitiveHelper('v1'))
    await writeFile(resolve(root, 'reload/Cycle.script.js'), [
        "export {CycleScriptA} from './cycle-a.js'",
        "export {CycleScriptB} from './cycle-b.js'",
        '',
    ].join('\n'))
    await writeFile(resolve(root, 'reload/cycle-a.js'), cycleModuleA('a1'))
    await writeFile(resolve(root, 'reload/cycle-b.js'), cycleModuleB('b1'))
    await writeFile(resolve(root, 'reload/Dynamic.script.js'), dynamicScript())
    await writeFile(resolve(root, 'reload/dynamic-helper.js'), "export const dynamicVersion = 'v1'\n")
    await writeFile(resolve(root, 'Unlisted.script.js'), `
import {Object3DComponent} from 'threepipe'
export class UnlistedComponent extends Object3DComponent { static ComponentType = 'UnlistedComponent' }
`)
    await writeFile(resolve(root, 'Generator.js'), generatorModule('Tree', 0))

    const scenePath = resolve(root, 'assets/main.scene.gltf')
    const scene = JSON.parse(await readFile(scenePath, 'utf8')) as {
        scenes: Array<{nodes: number[]}>
        nodes: Array<Record<string, unknown>>
        [key: string]: unknown
    }
    scene.nodes.push({
        name: 'Hot reload target',
        extras: {EntityComponentPlugin: {'hot-component': {type: 'HotScript', state: {}}}},
    })
    scene.nodes.push({
        name: 'RoundTripObject',
        mesh: 0,
        extras: {
            EntityComponentPlugin: {
                'round-trip-generator': {
                    type: 'Generator',
                    state: {module: 'Generator.js', params: {count: 2}},
                },
            },
        },
    })
    scene.nodes.push({
        name: 'Transitive reload target',
        extras: {EntityComponentPlugin: {'transitive-component': {type: 'TransitiveScript', state: {}}}},
    })
    scene.nodes.push({
        name: 'Cycle A reload target',
        extras: {EntityComponentPlugin: {'cycle-a-component': {type: 'CycleScriptA', state: {}}}},
    })
    scene.nodes.push({
        name: 'Cycle B reload target',
        extras: {EntityComponentPlugin: {'cycle-b-component': {type: 'CycleScriptB', state: {}}}},
    })
    scene.nodes.push({
        name: 'Dynamic reload target',
        extras: {EntityComponentPlugin: {'dynamic-component': {type: 'DynamicScript', state: {}}}},
    })
    scene.scenes[0].nodes.push(0, 1, 2, 3, 4, 5)
    scene.buffers = [{
        byteLength: 36,
        uri: 'data:application/octet-stream;base64,Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/',
    }]
    scene.bufferViews = [{buffer: 0, byteOffset: 0, byteLength: 36, target: 34962}]
    scene.accessors = [{bufferView: 0, componentType: 5126, count: 3, type: 'VEC3'}]
    scene.meshes = [{primitives: [{attributes: {POSITION: 0}}]}]
    await writeFile(scenePath, `${JSON.stringify(scene, null, 2)}\n`)

    const engineRoot = fileURLToPath(new URL('../../../engine/', import.meta.url))
    await mkdir(resolve(root, 'node_modules/@blitzdev/engine/dist'), {recursive: true})
    await writeFile(resolve(root, 'node_modules/@blitzdev/engine/package.json'), await readFile(resolve(engineRoot, 'package.json')))
    await writeFile(resolve(root, 'node_modules/@blitzdev/engine/dist/runtime.js'), await readFile(resolve(engineRoot, 'dist/runtime.js')))
    await symlink(resolve(engineRoot, '../../node_modules/threepipe'), resolve(root, 'node_modules/threepipe'))
    backend = await startMockBackend()
    server = await runDev({projectRoot: root, port: 0, noOpen: true, backendUrl: backend.url})
})

test.afterAll(async () => {
    await server.close()
    await backend.close()
    await rm(root, {recursive: true, force: true})
})

test('runs Playable, Editable, and Persisted checks through the connected editor', async ({page}) => {
    test.setTimeout(90_000)
    await page.goto(server.url)
    await expect(page.getByText('Project loaded')).toBeVisible({timeout: 20_000})

    await page.getByTestId('check-game').click()
    const results = page.getByTestId('check-results')
    await expect(results).toContainText('Playable PASS', {timeout: 45_000})
    await expect(results).toContainText('Editable PASS')
    await expect(results).toContainText('Persisted PASS')

    const written = JSON.parse(await readFile(resolve(root, '.blitz/check.json'), 'utf8')) as {
        ok: boolean
        mode: string
        outcomes: Array<{name: string, status: string}>
    }
    expect(written).toMatchObject({ok: true, mode: 'editor'})
    expect(written.outcomes).toEqual([
        expect.objectContaining({name: 'Playable', status: 'pass'}),
        expect.objectContaining({name: 'Editable', status: 'pass'}),
        expect.objectContaining({name: 'Persisted', status: 'pass'}),
    ])
    expect(await readFile(resolve(root, '.blitz/console.log'), 'utf8')).toContain('[blitz check] Playable=pass Editable=pass Persisted=pass')

    const cliResult = await checkProject(root)
    expect(cliResult).toMatchObject({ok: true, mode: 'editor'})
})

test('reports leaked runtime content after Stop in a toast and the console log', async ({page}) => {
    await page.goto(server.url)
    await expect(page.getByText('Project loaded')).toBeVisible({timeout: 20_000})
    await page.getByTestId('play').click()
    await expect(page.getByText('Playing')).toBeVisible({timeout: 20_000})
    await page.evaluate(async () => {
        const {BoxGeometry, Mesh, MeshStandardMaterial} = await import('@blitzdev/engine')
        const leaked = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial())
        leaked.name = 'Leaked Play object'
        ;(window as unknown as {__blitzRuntimeViewer: {scene: {add(object: unknown): void}}}).__blitzRuntimeViewer.scene.add(leaked)
    })
    await page.getByTestId('play').click()

    await expect(page.getByText(/Runtime cleanup failed: RUNTIME_OBJECT_AFTER_STOP/)).toBeVisible()
    await expect.poll(async () => (await readFile(resolve(root, '.blitz/console.log'), 'utf8')))
        .toContain('runtime cleanup failed: RUNTIME_OBJECT_AFTER_STOP')
})

test('loads the restored panels, watches generators, and saves text glTF without echo reload', async ({page}) => {
    test.setTimeout(90_000)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('**/api/files', async (route) => {
        const response = await route.fetch()
        const files = await response.json() as Array<Record<string, unknown>>
        await route.fulfill({response, json: [
            ...files,
            {path: '.blitz/deploys.json', size: 1, sha256: 'a'.repeat(64), mtime: 0},
            {path: '.blitz/dev.json', size: 1, sha256: 'b'.repeat(64), mtime: 0},
        ]})
    })
    await page.goto(server.url)

    await expect(page.getByRole('heading', {name: 'blitz-editor-e2e-'})).toBeVisible()
    await expect(page.getByText('Project loaded')).toBeVisible({timeout: 20_000})
    for (const panel of ['Objects', 'Materials', 'Textures', 'Geometries', 'Scene', 'Inspector', 'Settings', 'Project', 'Files', 'Timeline']) {
        await expect(page.getByRole('tab', {name: panel})).toBeVisible()
    }
    await expect(page.getByTestId('project-files').getByRole('button', {name: 'assets/main.scene.gltf'})).toBeVisible()

    const hierarchy = page.getByTestId('scene-hierarchy')
    await expect(hierarchy).toContainText('RoundTripObject')
    await expect(hierarchy).toContainText(/Tree 0\s*generated/)
    await expect(hierarchy).toContainText(/Tree 1\s*generated/)
    await expect(page.getByTestId('unlisted-script-warning').filter({hasText: 'Unlisted.script.js'})).toBeVisible()
    await expect(page.getByTestId('project-files')).not.toContainText('.blitz/deploys.json')
    await expect(page.getByTestId('project-files')).not.toContainText('.blitz/dev.json')

    await page.getByRole('tab', {name: 'Project'}).click()
    await expect(page.getByTestId('component-types')).toContainText('HotScript')
    await expect(page.getByTestId('component-types')).toContainText('Generator')
    await expect(page.getByTestId('component-types')).not.toContainText('UnlistedComponent')

    await page.getByRole('tab', {name: 'Inspector'}).click()
    await page.getByRole('button', {name: 'Hot_reload_target'}).click()
    const before = await manifestHash('assets/main.scene.gltf')
    await page.locator('#inspector-object-name').fill('Saved target')
    await expect.poll(async () => JSON.parse(await readFile(resolve(root, '.blitz/state.json'), 'utf8')).dirty).toBe(true)
    await page.getByTestId('save-scene').click()
    await expect(page.getByText('Scene saved')).toBeVisible({timeout: 20_000})
    await expect.poll(async () => JSON.parse(await readFile(resolve(root, '.blitz/state.json'), 'utf8')).dirty).toBe(false)
    await expect.poll(() => manifestHash('assets/main.scene.gltf')).not.toBe(before)
    await page.waitForTimeout(300)
    await expect(page.getByText('Scene reloaded from disk')).toHaveCount(0)

    await page.getByRole('button', {name: 'RoundTripObject'}).click()
    await expect(page.getByTestId('generator-inspector')).toContainText('Generator · RoundTripObject')
    const beforeGeneratorEdit = await manifestHash('assets/main.scene.gltf')
    await page.getByTestId('generator-params-1').fill('{"count": 3}')
    await page.getByTestId('generator-params-1').blur()
    await expect(hierarchy).toContainText(/Tree 2\s*generated/, {timeout: 20_000})
    await expect.poll(() => manifestHash('assets/main.scene.gltf')).not.toBe(beforeGeneratorEdit)
    await expect.poll(async () => (await readFile(resolve(root, 'assets/main.scene.gltf'), 'utf8')).includes('"count": 3')).toBe(true)
    await expect(page.getByText('Scene saved')).toBeVisible()

    const savedScene = await readFile(resolve(root, 'assets/main.scene.gltf'), 'utf8')
    const savedDocument = JSON.parse(savedScene) as {asset: unknown, buffers?: Array<{uri?: string}>}
    expect(savedScene.startsWith('{')).toBe(true)
    expect(savedDocument.asset).toBeTruthy()
    expect(savedDocument.buffers).toEqual([{byteLength: 36, uri: 'main.scene.bin'}])
    expect((await readFile(resolve(root, 'assets/main.scene.bin'))).byteLength).toBe(36)
    expect(savedScene).toContain('Saved target')
    expect(savedScene).not.toContain('data:')
    expect(savedScene).not.toContain('Tree 0')
    expect(savedScene).not.toContain('blitzGenerated')

    const journal = (await readFile(resolve(root, '.blitz/journal.jsonl'), 'utf8'))
        .split('\n').filter(Boolean).map((line) => JSON.parse(line) as {client: string})
    expect(journal.some(({client}) => client !== 'external')).toBe(true)

    await writeFile(resolve(root, 'Generator.js'), generatorModule('Reloaded tree', 1))
    await expect(page.getByText('Generator.js regenerated')).toBeVisible({timeout: 20_000})
    await expect(hierarchy).toContainText(/Reloaded tree 3\s*generated/)

    await page.getByTestId('bake-1').click()
    await expect(page.getByText('Baked RoundTripObject')).toBeVisible({timeout: 20_000})
    const bakedSceneText = await readFile(resolve(root, 'assets/main.scene.gltf'), 'utf8')
    const bakedScene = JSON.parse(bakedSceneText) as {
        nodes: Array<{name?: string, children?: number[], extras?: Record<string, unknown>}>
    }
    const bakedRoot = bakedScene.nodes.find(({name}) => name === 'RoundTripObject')
    expect(bakedRoot?.children).toHaveLength(4)
    expect(bakedRoot?.extras).toHaveProperty('blitzBakedFrom')
    expect(bakedSceneText).not.toContain('blitzGenerated')
    expect(bakedSceneText).not.toContain('excludeFromExport')
    expect(bakedSceneText).not.toContain('"type": "Generator"')
    expect(errors).toEqual([])
})

test('creates a checkpoint beside Check and restores the last checkpoint from Settings', async ({page}) => {
    await page.goto(server.url)
    await expect(page.getByText('Project loaded')).toBeVisible({timeout: 20_000})
    await expect(page.locator('[data-testid="check-game"] + [data-testid="checkpoint-game"]')).toBeVisible()

    const mainPath = resolve(root, 'main.js')
    const checkpointContents = await readFile(mainPath, 'utf8')
    await page.getByTestId('checkpoint-game').click()
    await expect(page.getByText(/Checkpoint [a-f\d]+ created\./)).toBeVisible({timeout: 10_000})

    await writeFile(mainPath, 'export async function main() { window.__restored = false }\n')
    await expect.poll(() => readFile(mainPath, 'utf8')).not.toBe(checkpointContents)
    await page.getByRole('button', {name: 'Settings', exact: true}).click()
    await expect(page.getByTestId('restore-checkpoint')).toHaveText('Restore last checkpoint')
    await page.getByTestId('restore-checkpoint').click()

    await expect(page.getByText(/Restored checkpoint [a-f\d]+\./)).toBeVisible({timeout: 10_000})
    await expect.poll(() => readFile(mainPath, 'utf8')).toBe(checkpointContents)
})

test('queues Play during project load and keeps one overlay update loop through reload and Stop', async ({page}) => {
    test.setTimeout(90_000)
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
    await expect(page.getByTestId('game-canvas')).toBeVisible()
    await expect(page.getByText('Playing')).toBeVisible({timeout: 20_000})
    expect(await page.evaluate(() => (window as unknown as {
        __blitzRuntimeViewer?: {getPlugin(type: string): {hasComponentType(type: string): boolean} | undefined}
    }).__blitzRuntimeViewer?.getPlugin('EntityComponentPlugin')?.hasComponentType('UnlistedComponent'))).toBe(false)
    await expect.poll(async () => JSON.parse(await readFile(resolve(root, '.blitz/state.json'), 'utf8')).playState).toBe('playing')
    const agentState = JSON.parse(await readFile(resolve(root, '.blitz/state.json'), 'utf8')) as Record<string, unknown>
    expect(agentState).toMatchObject({projectLoaded: true, playState: 'playing'})
    expect(agentState.clientId).toEqual(expect.any(String))
    expect(agentState.updatedAt).toEqual(expect.any(String))
    const firstUpdatedAt = agentState.updatedAt
    await expect.poll(async () => JSON.parse(await readFile(resolve(root, '.blitz/state.json'), 'utf8')).updatedAt, {
        timeout: 10_000,
    }).not.toBe(firstUpdatedAt)
    await expect.poll(() => page.evaluate(() => (window as unknown as {__blitzLoopTicks?: number}).__blitzLoopTicks || 0)).toBeGreaterThan(10)

    const editViewerUuid = await page.evaluate(() => (window as unknown as {viewer: {scene: {uuid: string}}}).viewer.scene.uuid)
    const firstRuns = await page.evaluate(() => (window as unknown as {__blitzMainRuns?: number}).__blitzMainRuns || 0)
    await expect.poll(() => page.evaluate(() => (window as unknown as {__hotScriptVersion?: string}).__hotScriptVersion)).toBe('v1')
    await expect.poll(() => page.evaluate(() => (window as unknown as {__hotPluginVersion?: string}).__hotPluginVersion)).toBe('v1')

    await writeFile(resolve(root, 'Hot.script.js'), hotScript('v2'))
    await expect(page.getByText('Hot.script.js reloaded')).toBeVisible({timeout: 20_000})
    await expect.poll(() => page.evaluate(() => (window as unknown as {__hotScriptVersion?: string}).__hotScriptVersion)).toBe('v2')
    await expect.poll(() => page.evaluate(() => (window as unknown as {__blitzMainRuns?: number}).__blitzMainRuns || 0)).toBeGreaterThan(firstRuns)
    await expect(page.getByTestId('game-canvas')).toBeVisible()
    expect(await page.evaluate(() => (window as unknown as {viewer: {scene: {uuid: string}}}).viewer.scene.uuid)).toBe(editViewerUuid)

    const moduleUrls = await page.evaluate(() => performance.getEntriesByType('resource').map(({name}) => name))
    expect(moduleUrls.some((url) => /\/files\/Hot\.script\.js\?v=[a-f\d]{64}(?:&r=\d+)?$/.test(url))).toBe(true)
    expect(moduleUrls.some((url) => /\/files\/Hot\.plugin\.js\?v=[a-f\d]{64}(?:&r=\d+)?$/.test(url))).toBe(true)

    await page.evaluate(() => {
        console.warn('[warn-forwarding-check] visible')
        for (let index = 0; index < 30; index += 1) console.error(`[rate-limit-check] ${index}`)
    })
    await expect.poll(async () => (await readFile(resolve(root, '.blitz/console.log'), 'utf8').catch(() => '')).includes('[HotScript] v2')).toBe(true)
    await expect.poll(async () => (await readFile(resolve(root, '.blitz/console.log'), 'utf8').catch(() => '')).includes('[rate-limit-check] 0')).toBe(true)
    const consoleLog = await readFile(resolve(root, '.blitz/console.log'), 'utf8')
    expect(consoleLog.split('\n')[0]).toMatch(/^# Blitz play log started .*; levels: console\.warn, console\.error, uncaught errors$/)
    expect(consoleLog).toContain('[console.warn] [warn-forwarding-check] visible')
    expect(consoleLog.match(/\[rate-limit-check\]/g)?.length || 0).toBeLessThanOrEqual(20)

    await page.getByTestId('play').click()
    await expect(page.getByText('Stopped')).toBeVisible()
    await expect(page.getByTestId('game-canvas')).toHaveCount(0)
    const stoppedAt = await page.evaluate(() => (window as unknown as {__blitzLoopTicks: number}).__blitzLoopTicks)
    await page.waitForTimeout(200)
    expect(await page.evaluate(() => (window as unknown as {__blitzLoopTicks: number}).__blitzLoopTicks)).toBe(stoppedAt)
    expect(await page.evaluate(() => (window as unknown as {viewer: {scene: {uuid: string}}}).viewer.scene.uuid)).toBe(editViewerUuid)
})

test('reloads a component re-exported through an unchanged entry module', async ({page}) => {
    await page.goto(server.url)
    await expect(page.getByText('Project loaded')).toBeVisible({timeout: 20_000})
    const pageIdentity = await page.evaluate(() => {
        const identity = crypto.randomUUID()
        ;(window as unknown as {__reloadPageIdentity?: string}).__reloadPageIdentity = identity
        return identity
    })
    await page.getByTestId('play').click()
    await expect(page.getByText('Playing')).toBeVisible({timeout: 20_000})
    await expect.poll(() => page.evaluate(() => (
        window as unknown as {__transitiveVersion?: string}
    ).__transitiveVersion)).toBe('v1')

    await writeFile(resolve(root, 'reload/transitive-helper.js'), transitiveHelper('v2'))

    await expect(page.getByText('reload/transitive-helper.js reloaded')).toBeVisible({timeout: 20_000})
    await expect.poll(() => page.evaluate(() => (
        window as unknown as {__transitiveVersion?: string}
    ).__transitiveVersion)).toBe('v2')
    expect(await page.evaluate(() => (
        window as unknown as {__reloadPageIdentity?: string}
    ).__reloadPageIdentity)).toBe(pageIdentity)
})

test('reloads both sides of a cyclic module graph without looping', async ({page}) => {
    await page.goto(server.url)
    await expect(page.getByText('Project loaded')).toBeVisible({timeout: 20_000})
    await page.getByTestId('play').click()
    await expect(page.getByText('Playing')).toBeVisible({timeout: 20_000})
    await expect.poll(() => page.evaluate(() => [
        (window as unknown as {__cycleA?: string}).__cycleA,
        (window as unknown as {__cycleB?: string}).__cycleB,
    ])).toEqual(['a1:b1', 'b1:a1'])
    const evaluations = await page.evaluate(() => [
        (window as unknown as {__cycleAEvaluations?: number}).__cycleAEvaluations || 0,
        (window as unknown as {__cycleBEvaluations?: number}).__cycleBEvaluations || 0,
    ])

    await writeFile(resolve(root, 'reload/cycle-a.js'), cycleModuleA('a2'))

    await expect(page.getByText('reload/cycle-a.js reloaded')).toBeVisible({timeout: 20_000})
    await expect.poll(() => page.evaluate(() => [
        (window as unknown as {__cycleA?: string}).__cycleA,
        (window as unknown as {__cycleB?: string}).__cycleB,
    ])).toEqual(['a2:b1', 'b1:a2'])
    await expect.poll(() => page.evaluate(() => [
        (window as unknown as {__cycleAEvaluations?: number}).__cycleAEvaluations || 0,
        (window as unknown as {__cycleBEvaluations?: number}).__cycleBEvaluations || 0,
    ])).toEqual([evaluations[0] + 1, evaluations[1] + 1])
})

test('reloads a literal dynamic import behind an unchanged component module', async ({page}) => {
    await page.goto(server.url)
    await expect(page.getByText('Project loaded')).toBeVisible({timeout: 20_000})
    await page.getByTestId('play').click()
    await expect(page.getByText('Playing')).toBeVisible({timeout: 20_000})
    await expect.poll(() => page.evaluate(() => (
        window as unknown as {__dynamicVersion?: string}
    ).__dynamicVersion)).toBe('v1')

    await writeFile(resolve(root, 'reload/dynamic-helper.js'), "export const dynamicVersion = 'v2'\n")

    await expect(page.getByText('reload/dynamic-helper.js reloaded')).toBeVisible({timeout: 20_000})
    await expect.poll(() => page.evaluate(() => (
        window as unknown as {__dynamicVersion?: string}
    ).__dynamicVersion)).toBe('v2')
})

test('writes stopped state on pagehide while playing', async ({page}) => {
    await page.goto(server.url)
    await expect(page.getByText('Project loaded')).toBeVisible({timeout: 20_000})
    await page.getByTestId('play').click()
    await expect(page.getByText('Playing')).toBeVisible({timeout: 20_000})
    await expect.poll(async () => JSON.parse(await readFile(resolve(root, '.blitz/state.json'), 'utf8')).playState).toBe('playing')

    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))

    await expect.poll(async () => JSON.parse(await readFile(resolve(root, '.blitz/state.json'), 'utf8')).playState).toBe('stopped')
})

test('keeps the upstream viewport chrome and Default Camera on an empty project', async ({page}) => {
    const emptyRoot = await mkdtemp(resolve(tmpdir(), 'blitz-editor-empty-'))
    await initProject(emptyRoot)
    const emptyServer = await runDev({projectRoot: emptyRoot, port: 0, noOpen: true})
    try {
        await page.goto(emptyServer.url)
        await expect(page.getByText('Project loaded')).toBeVisible({timeout: 20_000})
        await expect(page.getByTitle('Transform controls')).toBeVisible()
        await expect(page.getByTitle('Edit mode')).toBeVisible()
        await expect(page.getByTitle('Preview mode')).toBeVisible()
        await expect(page.getByTitle('Snapshot')).toBeVisible()
        await expect(page.getByTitle('Fullscreen')).toBeVisible()
        await page.getByTitle('Select camera').click()
        await expect(page.getByRole('menuitem', {name: 'Default Camera'})).toBeVisible()
        await expect(page.getByTestId('scene-hierarchy')).toContainText('Default Camera')
    } finally {
        await emptyServer.close()
        await rm(emptyRoot, {recursive: true, force: true})
    }
})

test('reports a corrupt scene in the editor and console log', async ({page}) => {
    await page.goto(server.url)
    await expect(page.getByText('Project loaded')).toBeVisible({timeout: 20_000})
    const scenePath = 'assets/main.scene.gltf'
    const valid = await readFile(resolve(root, scenePath), 'utf8')
    await writeFile(resolve(root, scenePath), '{not gltf')

    await expect(page.getByRole('alert')).toContainText('JSON', {timeout: 10_000})
    await expect.poll(async () => (await readFile(resolve(root, '.blitz/console.log'), 'utf8').catch(() => '')).includes('JSON')).toBe(true)

    await writeFile(resolve(root, scenePath), valid)
})

test('opens the game dialog, publishes, updates, and claims a live game', async ({page}) => {
    await page.goto(server.url)
    await expect(page.getByText('Project loaded')).toBeVisible({timeout: 20_000})
    await page.getByTestId('open-game').click()
    await expect(page.getByRole('dialog', {name: 'Open game'})).toBeVisible()
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
    await page.locator('#claim-email').fill('editor@example.com')
    await page.locator('#claim-password').fill('password123')
    await page.getByTestId('claim-game').click()
    await expect(page.getByTestId('claimed-notice')).toContainText('does not expire')
    expect(backend.games.get(slug)?.claimed).toBe(true)
})

test('returns a raced slug conflict to the field and copies a secret-free agent prompt', async ({page, context}) => {
    const fixture = await startPublishEditor()
    try {
        await context.grantPermissions(['clipboard-read', 'clipboard-write'], {origin: new URL(fixture.server.url).origin})
        await page.goto(fixture.server.url)
        await expect(page.getByText('Project loaded')).toBeVisible({timeout: 20_000})
        await page.getByTestId('open-game').click()
        const slugInput = page.locator('#publish-slug')
        const slug = await slugInput.inputValue()
        await expect(page.getByText('Available', {exact: true})).toBeVisible()
        await page.getByRole('button', {name: 'Copy prompt'}).click()
        const prompt = await page.evaluate(() => navigator.clipboard.readText())
        expect(prompt).toContain(`Use the slug "${slug}"`)
        expect(prompt).not.toContain('tp_')
        expect(prompt).not.toContain('claim_secret')
        await fetch(`${fixture.backend.url}/api/v1/new-game/${slug}`, {method: 'POST'})

        const popupPromise = page.waitForEvent('popup')
        await page.getByTestId('create-live-game').click()
        const popup = await popupPromise

        await expect(page.getByText('Taken. Choose another slug.')).toBeVisible()
        await expect(slugInput).toBeFocused()
        await expect.poll(() => popup.isClosed()).toBe(true)
        await expect(page.getByTestId('google-sign-in')).toHaveCount(0)
    } finally {
        await page.close()
        await fixture.close()
    }
})

test('shows a popup fallback and preserves a failed publish for retry', async ({page}) => {
    const releaseStatuses = [503, 503, 503, 503, 503]
    const fixture = await startPublishEditor({releaseStatuses})
    try {
        await page.addInitScript(() => {
            window.open = () => null
        })
        await page.goto(fixture.server.url)
        await expect(page.getByText('Project loaded')).toBeVisible({timeout: 20_000})
        await page.getByTestId('open-game').click()
        await expect(page.getByText('Available', {exact: true})).toBeVisible()
        await page.getByTestId('create-live-game').click()

        await expect(page.getByText('Publishing is temporarily unavailable. Try again in a minute.')).toBeVisible({timeout: 20_000})
        await expect(page.getByRole('link', {name: 'Open the live game'})).toBeVisible()
        expect(releaseStatuses).toHaveLength(0)
        await page.reload()
        await expect(page.getByText('Project loaded')).toBeVisible({timeout: 20_000})
        await page.getByTestId('open-game').click()
        await expect(page.getByText('Publishing is temporarily unavailable. Try again in a minute.')).toBeVisible()
        await expect(page.getByText('Your game is live')).toHaveCount(0)
        await page.getByRole('button', {name: 'Retry'}).click()
        await expect(page.getByTestId('live-url')).toBeVisible({timeout: 20_000})
    } finally {
        await page.close()
        await fixture.close()
    }
})

test('maps a publish quota error to the documented message and allows retry', async ({page}) => {
    const fixture = await startPublishEditor({releaseStatuses: [413]})
    try {
        await page.goto(fixture.server.url)
        await expect(page.getByText('Project loaded')).toBeVisible({timeout: 20_000})
        await page.getByTestId('open-game').click()
        await expect(page.getByText('Available', {exact: true})).toBeVisible()
        const popupPromise = page.waitForEvent('popup')
        await page.getByTestId('create-live-game').click()
        const popup = await popupPromise

        await expect(page.getByText('A file exceeds 100 MiB, or the game exceeds the 500 MiB or 2,000 file limit.')).toBeVisible()
        const retryPopupPromise = page.waitForEvent('popup')
        await page.getByRole('button', {name: 'Retry'}).click()
        const retryPopup = await retryPopupPromise
        await expect(page.getByTestId('live-url')).toBeVisible({timeout: 20_000})
        await popup.close()
        await retryPopup.close()
    } finally {
        await page.close()
        await fixture.close()
    }
})

test('keeps the publish dialog open for retry after a connection loss during the walk', async ({page}) => {
    const fixture = await startPublishEditor()
    try {
        await page.route('**/api/publish', (route) => route.abort('connectionfailed'), {times: 1})
        await page.goto(fixture.server.url)
        await expect(page.getByText('Project loaded')).toBeVisible({timeout: 20_000})
        await page.getByTestId('open-game').click()
        await expect(page.getByText('Available', {exact: true})).toBeVisible()
        const popupPromise = page.waitForEvent('popup')
        await page.getByTestId('create-live-game').click()
        const popup = await popupPromise

        await expect(page.getByText('The network connection was lost. Check your connection and retry.')).toBeVisible()
        await expect(page.getByRole('button', {name: 'Retry'})).toBeVisible()
        await expect(page.getByRole('dialog', {name: 'Open game'})).toBeVisible()

        const retryPopupPromise = page.waitForEvent('popup')
        await page.getByRole('button', {name: 'Retry'}).click()
        const retryPopup = await retryPopupPromise
        await expect(page.getByTestId('live-url')).toBeVisible({timeout: 20_000})
        await popup.close()
        await retryPopup.close()
    } finally {
        await page.close()
        await fixture.close()
    }
})

async function startPublishEditor(options: Parameters<typeof startMockBackend>[0] = {}) {
    const projectRoot = await mkdtemp(resolve(tmpdir(), 'blitz-editor-publish-'))
    await initProject(projectRoot)
    const engineRoot = fileURLToPath(new URL('../../../engine/', import.meta.url))
    const installedEngine = resolve(projectRoot, 'node_modules/@blitzdev/engine')
    await mkdir(resolve(installedEngine, 'dist'), {recursive: true})
    await writeFile(resolve(installedEngine, 'package.json'), await readFile(resolve(engineRoot, 'package.json')))
    await writeFile(resolve(installedEngine, 'dist/runtime.js'), await readFile(resolve(engineRoot, 'dist/runtime.js')))
    const mockBackend = await startMockBackend(options)
    const devServer = await createDevServer({
        projectRoot,
        port: 0,
        backendUrl: mockBackend.url,
        publish: (publishOptions, emit) => publishFromDisk(projectRoot, {
            ...publishOptions,
            backendUrl: mockBackend.url,
            noCheck: true,
        }, emit),
    })
    return {
        root: projectRoot,
        server: devServer,
        backend: mockBackend,
        async close() {
            await devServer.close()
            await mockBackend.close()
            await rm(projectRoot, {recursive: true, force: true})
        },
    }
}

async function manifestHash(path: string): Promise<string | undefined> {
    const response = await fetch(`http://127.0.0.1:${server.port}/api/files`, {headers: {'X-Blitz-Token': server.token}})
    const manifest = await response.json() as Array<{path: string, sha256: string}>
    return manifest.find((entry) => entry.path === path)?.sha256
}

function generatorModule(prefix: string, extra: number): string {
    return `
export default function generate({node, params, engine}) {
    for (let index = 0; index < params.count + ${extra}; index += 1) {
        const child = new engine.Mesh(
            new engine.BoxGeometry(0.25, 0.25, 0.25),
            new engine.MeshStandardMaterial({color: 0x44ccaa}),
        )
        child.name = '${prefix} ' + index
        node.add(child)
    }
}
`
}

function hotScript(version: string): string {
    return `
import {Object3DComponent} from 'threepipe'
export class HotScript extends Object3DComponent {
    static ComponentType = 'HotScript'
    start() {
        window.__hotScriptVersion = '${version}'
        console.warn('[HotScript] ${version}')
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

function transitiveHelper(version: string): string {
    return `
import {Object3DComponent} from 'threepipe'
export class TransitiveScript extends Object3DComponent {
    static ComponentType = 'TransitiveScript'
    start() { window.__transitiveVersion = '${version}' }
}
`
}

function cycleModuleA(version: string): string {
    return `
import {Object3DComponent} from 'threepipe'
import {cycleBVersion} from './cycle-b.js'
window.__cycleAEvaluations = (window.__cycleAEvaluations || 0) + 1
export const cycleAVersion = '${version}'
export class CycleScriptA extends Object3DComponent {
    static ComponentType = 'CycleScriptA'
    start() { window.__cycleA = cycleAVersion + ':' + cycleBVersion }
}
`
}

function cycleModuleB(version: string): string {
    return `
import {Object3DComponent} from 'threepipe'
import {cycleAVersion} from './cycle-a.js'
window.__cycleBEvaluations = (window.__cycleBEvaluations || 0) + 1
export const cycleBVersion = '${version}'
export class CycleScriptB extends Object3DComponent {
    static ComponentType = 'CycleScriptB'
    start() { window.__cycleB = cycleBVersion + ':' + cycleAVersion }
}
`
}

function dynamicScript(): string {
    return `
import {Object3DComponent} from 'threepipe'
export class DynamicScript extends Object3DComponent {
    static ComponentType = 'DynamicScript'
    start() {
        import('./dynamic-helper.js').then(({dynamicVersion}) => { window.__dynamicVersion = dynamicVersion })
    }
}
`
}
