import {expect, test} from '@playwright/test'
import {mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {initProject, publishFromDisk, runDev} from '../../../kite3d/src/commands.ts'
import {checkProject} from '../../../kite3d/src/check.ts'
import {createDevServer, type DevServer} from '../../../kite3d/src/server.ts'
import {startMockBackend, type MockBackend} from '../../../kite3d/test/mockBackend.ts'
import {FIXTURE_PLUGIN_NAME, installPackedFixturePlugin} from '../../../kite3d/test/pluginFixture.ts'
import {closeFixtureSteps} from './fixtureClose.ts'

let root: string
let server: DevServer
let backend: MockBackend
const googleScriptUrl = 'https://accounts.google.com/gsi/client'

test.beforeAll(async () => {
    root = await mkdtemp(resolve(tmpdir(), 'kite3d-editor-e2e-'))
    await initProject(root)

    const packagePath = resolve(root, 'package.json')
    const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as {
        kite3d: {plugins?: string[], scripts?: string[], viewer?: Record<string, unknown>}
    }
    packageJson.kite3d.plugins = ['Hot.plugin.js:HotPlugin']
    packageJson.kite3d.scripts = [
        'Hot.script.js',
        'reload/Reexport.script.js',
        'reload/Cycle.script.js',
        'reload/Dynamic.script.js',
    ]
    packageJson.kite3d.viewer = {
        backgroundColor: '#224466',
        camera: {position: [0, 5, 17], target: [0, 0, 0]},
    }
    await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)
    await writeFile(resolve(root, 'main.js'), `
export async function main({viewer}) {
    window.__kite3dMainRuns = (window.__kite3dMainRuns || 0) + 1
    window.__kite3dLoopTicks = 0
    window.__kite3dRuntimeViewer = viewer
    viewer.addEventListener('preFrame', () => { window.__kite3dLoopTicks += 1 })
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
    await writeFile(resolve(root, 'FloorGenerator.js'), `
export default function generate({node, engine}) {
    const floor = new engine.Mesh(
        new engine.BoxGeometry(40, 1, 40),
        new engine.MeshStandardMaterial({color: 0x6688aa}),
    )
    floor.name = 'Floor Preview'
    floor.position.y = -0.5
    node.add(floor)
}
`)

    const scenePath = resolve(root, 'assets/main.scene.gltf')
    const scene = JSON.parse(await readFile(scenePath, 'utf8')) as {
        scenes: Array<{nodes: number[]}>
        nodes: Array<Record<string, unknown>>
        [key: string]: unknown
    }
    scene.nodes.push({
        name: 'Hot reload target',
        mesh: 0,
        extras: {EntityComponentPlugin: {'hot-component': {type: 'HotScript', state: {}}}},
    })
    scene.nodes.push({
        name: 'RoundTripObject',
        mesh: 0,
        extras: {
            EntityComponentPlugin: {
                'round-trip-generator': {
                    type: 'Generator',
                    state: {module: 'Generator.js', params: {count: 2, markers: true, legacyMode: 'classic'}},
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
    scene.nodes.push({
        name: 'Floor Generator',
        extras: {EntityComponentPlugin: {'floor-generator': {
            type: 'Generator', state: {module: 'FloorGenerator.js', params: {width: 40}},
        }}},
    })
    scene.nodes.push({
        name: 'Directional Key',
        extensions: {KHR_lights_punctual: {light: 0}},
    })
    scene.scenes[0].nodes.push(0, 1, 2, 3, 4, 5, 6, 7)
    scene.extensionsUsed = ['KHR_lights_punctual']
    scene.extensions = {KHR_lights_punctual: {lights: [{type: 'directional', color: [1, 0.95, 0.85], intensity: 2}]}}
    scene.buffers = [{
        byteLength: 36,
        uri: 'data:application/octet-stream;base64,Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/',
    }]
    scene.bufferViews = [{buffer: 0, byteOffset: 0, byteLength: 36, target: 34962}]
    scene.accessors = [{
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [0, 0, 0],
        max: [1, 1, 1],
    }]
    scene.meshes = [{primitives: [{attributes: {POSITION: 0}}]}]
    await writeFile(scenePath, `${JSON.stringify(scene, null, 2)}\n`)

    const engineRoot = fileURLToPath(new URL('../../../engine/', import.meta.url))
    await mkdir(resolve(root, 'node_modules/@kite3d/engine/dist'), {recursive: true})
    await writeFile(resolve(root, 'node_modules/@kite3d/engine/package.json'), await readFile(resolve(engineRoot, 'package.json')))
    await writeFile(resolve(root, 'node_modules/@kite3d/engine/dist/runtime.js'), await readFile(resolve(engineRoot, 'dist/runtime.js')))
    await symlink(resolve(engineRoot, '../../node_modules/threepipe'), resolve(root, 'node_modules/threepipe'))
    backend = await startMockBackend()
    server = await runDev({projectRoot: root, port: 0, noOpen: true, backendUrl: backend.url})
})

test.afterAll(async () => {
    try {
        await closeFixtureSteps([
            {name: 'shared editor dev server', close: () => server.close()},
            {name: 'shared editor mock backend', close: () => backend.close()},
        ])
    } finally {
        await rm(root, {recursive: true, force: true})
    }
})

test.beforeEach(async ({page}) => {
    await page.route(googleScriptUrl, async (route) => {
        await route.fulfill({
            contentType: 'text/javascript',
            body: `window.google = {accounts: {id: {
  initialize() {},
  renderButton(parent) {
    const button = document.createElement('button')
    button.textContent = 'Continue with Google'
    parent.replaceChildren(button)
  },
  prompt() {},
}}}`,
        })
    })
})

test('caps the stopped editor frame loop and renders immediately on demand', async ({page}) => {
    await page.goto(server.url)
    await expect(page.getByText('Project loaded')).toBeVisible({timeout: 20_000})
    await page.bringToFront()
    await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe('visible')

    const idle = await page.evaluate(async () => {
        const viewer = (window as unknown as {viewer: {
            addEventListener(type: string, listener: () => void): void
            removeEventListener(type: string, listener: () => void): void
        }}).viewer
        await new Promise((resolve) => setTimeout(resolve, 250))
        let frames = 0
        let renders = 0
        const onFrame = () => { frames += 1 }
        const onRender = () => { renders += 1 }
        viewer.addEventListener('postFrame', onFrame)
        viewer.addEventListener('postRender', onRender)
        const started = performance.now()
        await new Promise((resolve) => setTimeout(resolve, 1_200))
        const durationMs = performance.now() - started
        viewer.removeEventListener('postFrame', onFrame)
        viewer.removeEventListener('postRender', onRender)
        return {durationMs, frames, renders}
    })
    expect(idle.frames * 1000 / idle.durationMs).toBeGreaterThan(5)
    expect(idle.frames * 1000 / idle.durationMs).toBeLessThan(20)
    expect(idle.renders).toBe(0)

    const renderDelay = await page.evaluate(async () => {
        const viewer = (window as unknown as {viewer: {
            addEventListener(type: string, listener: () => void): void
            removeEventListener(type: string, listener: () => void): void
            setDirty(): void
        }}).viewer
        const started = performance.now()
        return new Promise<number>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Timed out waiting for an on-demand render.')), 500)
            const onRender = () => {
                clearTimeout(timeout)
                viewer.removeEventListener('postRender', onRender)
                resolve(performance.now() - started)
            }
            viewer.addEventListener('postRender', onRender)
            viewer.setDirty()
        })
    })
    expect(renderDelay).toBeLessThan(100)
})

test('runs Playable, Editable, and Persisted checks through the connected editor', async ({page}) => {
    test.setTimeout(90_000)
    const loadWarnings: string[] = []
    page.on('console', (message) => {
        if (message.type() === 'warning' && !message.text().includes('GPU stall due to ReadPixels')) {
            loadWarnings.push(message.text())
        }
    })
    await page.goto(server.url)
    await expect(page.getByText('Project loaded')).toBeVisible({timeout: 20_000})
    const cameraPose = await page.evaluate(() => {
        const scene = (window as unknown as {viewer: {scene: {
            backgroundColor: {getHexString(): string} | null
            defaultCamera: {position: {toArray(): number[]}}
            mainCamera: {position: {toArray(): number[]}, target: {toArray(): number[]}}
        }}}).viewer.scene
        return {
            background: scene.backgroundColor?.getHexString(),
            camera: scene.defaultCamera.position.toArray(),
            viewportCamera: scene.mainCamera.position.toArray(),
            viewportTarget: scene.mainCamera.target.toArray(),
        }
    })
    expect(cameraPose.background).toBe('224466')
    expect(cameraPose.camera).toEqual([0, 5, 17])
    for (const [actual, expected] of cameraPose.viewportCamera.map((value, index) => [value, cameraPose.camera[index]])) {
        expect(actual).toBeCloseTo(expected)
    }
    for (const [actual, expected] of cameraPose.viewportTarget.map((value, index) => [value, [0, 0, 0][index]])) {
        expect(actual).toBeCloseTo(expected)
    }
    expect(loadWarnings).toEqual([])
    await expect.poll(async () => JSON.parse(await readFile(resolve(root, '.kite3d/state.json'), 'utf8')).dirty).toBe(false)
    await expect(page.getByTestId('save-scene')).toBeDisabled()
    const sceneBeforeCheck = await readFile(resolve(root, 'assets/main.scene.gltf'))

    const check = page.getByTestId('check-game')
    const checkPlacement = await page.evaluate(() => {
        const play = document.querySelector('[data-testid="play"]')
        const open = document.querySelector('[data-testid="open-game"]')
        const checkButton = document.querySelector('[data-testid="check-game"]')
        const buttons = [...(play?.closest('.bp5-button-group')?.querySelectorAll('button') || [])]
        return {
            buttonCount: buttons.length,
            sameGroup: play?.closest('.bp5-button-group') === checkButton?.closest('.bp5-button-group'),
            immediatelyAfterOpen: buttons.indexOf(checkButton as HTMLButtonElement)
                === buttons.indexOf(open as HTMLButtonElement) + 1,
        }
    })
    expect(checkPlacement).toEqual({buttonCount: 5, sameGroup: true, immediatelyAfterOpen: true})
    await expect(check).toHaveText('')
    await expect(check.locator('.bp5-icon-tick')).toBeVisible()
    await expect(check.locator('.kite3d-check-badge')).toHaveCount(0)
    await check.hover()
    await expect(page.getByText('Check the game: Playable, Editable, Persisted', {exact: true})).toBeVisible()
    await expect(page.getByTestId('check-results')).toHaveCount(0)
    await page.mouse.move(0, 200)

    await check.click()
    await expect(check).toBeDisabled()
    await expect(check).toHaveClass(/bp5-loading/)
    await expect(check).toHaveAttribute('data-check-status', 'pass', {timeout: 45_000})
    await expect(check.locator('.kite3d-check-badge')).toHaveClass(/kite3d-check-badge-success/)
    await page.mouse.move(0, 200)
    await check.hover()
    const results = page.getByTestId('check-results')
    await expect(results).toBeVisible()
    await expect(results.getByRole('heading', {name: 'Check', exact: true})).toBeVisible()
    await expect(results.getByTestId('check-relative-time')).toHaveText(/^(just now|\d+ (second|minute)s? ago)$/)
    for (const outcomeName of ['Playable', 'Editable', 'Persisted']) {
        const outcome = results.getByTestId(`check-outcome-${outcomeName.toLowerCase()}`)
        await expect(outcome).toContainText(outcomeName)
        await expect(outcome.locator('.kite3d-check-status-success')).toBeVisible()
        await expect(outcome.locator('.kite3d-check-summary')).not.toHaveText('')
    }
    await expect.poll(async () => JSON.parse(await readFile(resolve(root, '.kite3d/state.json'), 'utf8')).dirty).toBe(false)
    await expect(page.getByTestId('save-scene')).toBeDisabled()
    expect(await readFile(resolve(root, 'assets/main.scene.gltf'))).toEqual(sceneBeforeCheck)

    const written = JSON.parse(await readFile(resolve(root, '.kite3d/check.json'), 'utf8')) as {
        ok: boolean
        mode: string
        outcomes: Array<{name: string, status: string, report?: unknown}>
    }
    expect(written).toMatchObject({ok: true, mode: 'editor'})
    expect(written.outcomes).toEqual([
        expect.objectContaining({
            name: 'Playable',
            status: 'pass',
            report: expect.objectContaining({projectValidation: expect.objectContaining({status: 'pass'})}),
        }),
        expect.objectContaining({name: 'Editable', status: 'pass'}),
        expect.objectContaining({name: 'Persisted', status: 'pass'}),
    ])
    expect(await readFile(resolve(root, '.kite3d/console.log'), 'utf8')).toContain('[kite3d check] Playable=pass Editable=pass Persisted=pass')

    await page.mouse.move(0, 200)
    await page.evaluate(() => {
        const viewer = (window as unknown as {viewer: {scene: {modelRoot: {
            children: Array<{userData: Record<string, unknown>}>
        }}}}).viewer
        viewer.scene.modelRoot.children[0].userData.kite3dAuthoring = {
            role: 'generator', id: 'orphan-preview', sourceId: 'missing-generator',
        }
    })
    await check.click()
    await expect(check).toHaveAttribute('data-check-status', 'fail', {timeout: 45_000})
    await expect(check.locator('.kite3d-check-badge')).toHaveClass(/kite3d-check-badge-danger/)
    await page.mouse.move(0, 200)
    await check.hover()
    const failingOutcome = results.locator('[data-status="fail"]').first()
    await expect(failingOutcome).toBeVisible()
    await expect(failingOutcome.locator('.kite3d-check-codes'))
        .toContainText(/MISSING_AUTHORING_SOURCE|PERSISTENCE_DRIFT/)

    const cliResult = await checkProject(root)
    expect(cliResult).toMatchObject({ok: true, mode: 'editor'})
})

test('loads a packed dependency plugin with its worker and sidecar', async ({page}) => {
    const pluginProject = await mkdtemp(resolve(tmpdir(), 'kite3d-editor-plugin-'))
    let pluginServer: DevServer | undefined
    try {
        await initProject(pluginProject, {git: false})
        await installPackedFixturePlugin(pluginProject)
        const packagePath = resolve(pluginProject, 'package.json')
        const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as {
            kite3d: {plugins?: string[]}
        }
        packageJson.kite3d.plugins = [FIXTURE_PLUGIN_NAME]
        await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)
        pluginServer = await createDevServer({projectRoot: pluginProject, port: 0})

        await page.goto(pluginServer.url)
        await expect(page.getByText('Project loaded')).toBeVisible({timeout: 20_000})
        await expect.poll(() => page.evaluate(() => (window as unknown as {viewer: {
            getPlugin(type: string): {sidecarByte?: number} | undefined
        }}).viewer.getPlugin('PackedFixturePlugin')?.sidecarByte)).toBe(42)
    } finally {
        await pluginServer?.close()
        await rm(pluginProject, {recursive: true, force: true})
    }
})

test('writes byte-identical unchanged saves across editor sessions', async ({page}) => {
    test.setTimeout(90_000)
    const saveWithoutEdit = async () => {
        await page.goto(server.url)
        await expect(page.getByText('Project loaded')).toBeVisible({timeout: 20_000})
        await page.evaluate(() => {
            const scene = (window as unknown as {viewer: {scene: {
                modelRoot: {name: string, setDirty(event: {change: string}): void}
            }}}).viewer.scene
            const originalName = scene.modelRoot.name
            scene.modelRoot.name = 'Temporary name'
            scene.modelRoot.setDirty({change: 'name'})
            scene.modelRoot.name = originalName
            scene.modelRoot.setDirty({change: 'name'})
        })
        await expect(page.getByTestId('save-scene')).toBeEnabled()
        await page.getByTestId('save-scene').click()
        await expect(page.getByText('Scene saved')).toBeVisible({timeout: 20_000})
        return readFile(resolve(root, 'assets/main.scene.gltf'))
    }

    const first = await saveWithoutEdit()
    const second = await saveWithoutEdit()

    expect(first.toString()).not.toMatch(/"uuid"\s*:/)
    expect(second).toEqual(first)
})

test('registers a dropped GLB as an asset and loads it from the published project', async ({page}) => {
    test.setTimeout(90_000)
    const fixture = await startPublishEditor()
    try {
        await page.goto(fixture.server.url)
        await expect(page.getByText('Project loaded')).toBeVisible({timeout: 20_000})
        await page.evaluate(() => {
            const target = window as unknown as {
                viewer: {assetManager: {importer: {import(path: string, options?: unknown): Promise<unknown>}}}
                __assetLoadPaths?: string[]
            }
            const importer = target.viewer.assetManager.importer
            const load = importer.import.bind(importer)
            target.__assetLoadPaths = []
            importer.import = async (path, options) => {
                target.__assetLoadPaths!.push(path)
                return load(path, options)
            }
        })

        const glb = minimalTriangleGlb('Fixture mesh')
        await page.locator('.editorCanvasContainer').dispatchEvent('drop', {
            dataTransfer: await page.evaluateHandle(({bytes}) => {
                const transfer = new DataTransfer()
                transfer.items.add(new File([Uint8Array.from(bytes)], 'gate-model.glb', {type: 'model/gltf-binary'}))
                return transfer
            }, {bytes: [...glb]}),
        })

        await expect(page.getByText('Imported gate-model.glb')).toBeVisible({timeout: 20_000})
        const assets = JSON.parse(await readFile(resolve(fixture.root, 'assets.json'), 'utf8')) as {
            files: Record<string, {path: string}>
        }
        expect(assets.files).toEqual({'gate-model': {path: 'assets/imports/gate-model.glb'}})
        expect(await readFile(resolve(fixture.root, 'assets/imports/gate-model.glb'))).toEqual(glb)
        expect(await page.evaluate(() => (
            window as unknown as {__assetLoadPaths: string[]}
        ).__assetLoadPaths)).toContain('/kite3d/@gate-model/f.glb')
        await expect(page.getByTestId('scene-hierarchy')).toContainText('gate-model.glb')

        await page.getByTestId('save-scene').click()
        await expect(page.getByText('Scene saved')).toBeVisible({timeout: 20_000})
        const expectReferenceOnlyScene = async () => {
            const scene = JSON.parse(await readFile(resolve(fixture.root, 'assets/main.scene.gltf'), 'utf8')) as {
                nodes: Array<{children?: number[], extras?: {rootPath?: string}, mesh?: number}>
                meshes?: unknown[]
            }
            const wrapper = scene.nodes.find((node) => node.extras?.rootPath === '/kite3d/@gate-model/f.glb')
            expect(wrapper).toBeDefined()
            expect(wrapper?.children || []).toEqual([])
            expect(scene.nodes.filter((node) => node.mesh !== undefined)).toEqual([])
            expect(scene.meshes || []).toEqual([])
        }
        await expectReferenceOnlyScene()

        await page.reload()
        await expect(page.getByText('Project loaded')).toBeVisible({timeout: 20_000})
        const firstReloadMeshCount = await page.evaluate(() => {
            const wrapper = (window as unknown as {
                viewer: {scene: {modelRoot: {getObjectByName(name: string): {
                    traverse(callback: (object: {isMesh?: boolean}) => void): void
                } | undefined}}}
            }).viewer.scene.modelRoot.getObjectByName('gate-model.glb')
            let meshCount = 0
            wrapper?.traverse((object) => {
                if (object.isMesh) meshCount += 1
            })
            return wrapper ? meshCount : undefined
        })
        if (firstReloadMeshCount === 0) {
            await page.reload()
            await expect(page.getByText('Project loaded')).toBeVisible({timeout: 20_000})
        }
        await expect.poll(() => page.evaluate(() => {
            const wrapper = (window as unknown as {
                viewer: {scene: {modelRoot: {getObjectByName(name: string): {
                    children: Array<{isMesh?: boolean, userData: {excludeFromExport?: boolean}}>
                    traverse(callback: (object: {isMesh?: boolean}) => void): void
                } | undefined}}}
            }).viewer.scene.modelRoot.getObjectByName('gate-model.glb')
            if (!wrapper) return undefined
            let meshCount = 0
            wrapper.traverse((object) => {
                if (object.isMesh) meshCount += 1
            })
            const state = {
                meshCount,
                excluded: wrapper.children.every((child) => child.userData.excludeFromExport === true),
            }
            return state
        }), {timeout: 20_000}).toEqual({meshCount: 1, excluded: true})
        await page.evaluate(() => {
            const wrapper = (window as unknown as {
                viewer: {scene: {modelRoot: {getObjectByName(name: string): {
                    name: string
                    setDirty(event: {change: string}): void
                } | undefined}}}
            }).viewer.scene.modelRoot.getObjectByName('gate-model.glb')
            if (!wrapper) throw new Error('The reloaded scene is missing gate-model.glb')
            wrapper.name = 'Temporary asset name'
            wrapper.setDirty({change: 'name'})
            wrapper.name = 'gate-model.glb'
            wrapper.setDirty({change: 'name'})
        })
        await expect(page.getByTestId('save-scene')).toBeEnabled()
        await page.getByTestId('save-scene').click()
        await expect(page.getByText('Scene saved')).toBeVisible({timeout: 20_000})
        await expectReferenceOnlyScene()

        await page.getByTestId('open-game').click()
        await expect(page.getByText('Available', {exact: true})).toBeVisible()
        const popupPromise = page.waitForEvent('popup')
        await page.getByTestId('create-live-game').click()
        const popup = await popupPromise
        const slug = await page.locator('#publish-slug').inputValue()
        await expect(page.getByTestId('live-url')).toBeVisible({timeout: 30_000})
        await expect.poll(() => popup.evaluate(() => Boolean((window as unknown as {viewer?: unknown}).viewer)), {
            timeout: 30_000,
        }).toBe(true)
        await expect.poll(() => fixture.backend.requests.some(({method, path}) =>
            method === 'GET' && path === `/preview/${slug}/assets/imports/gate-model.glb`), {timeout: 30_000}).toBe(true)
        await expect.poll(() => popup.evaluate(() => {
            const wrapper = (window as unknown as {
                viewer?: {scene: {modelRoot: {getObjectByName(name: string): {children: unknown[]} | undefined}}}
            }).viewer?.scene.modelRoot.getObjectByName('gate-model.glb')
            return wrapper?.children.length || 0
        }), {timeout: 30_000}).toBeGreaterThan(0)
        await popup.close()
    } finally {
        await page.close()
        await fixture.close()
    }
})

test('persists a dropped library glTF with its buffer and texture', async ({page}) => {
    test.setTimeout(90_000)
    const fixture = await startPublishEditor()
    const libraryRootUrl = 'https://library.example.test/assets/mock-textured/mock-textured.gltf'
    const libraryRequests: Array<{method: string, url: string, status?: number}> = []
    const consoleErrors: string[] = []
    const pageErrors: string[] = []
    const httpErrors: Array<{status: number, url: string}> = []
    const library = await routeMockLibrary(page)
    await writeFile(resolve(fixture.root, '.kite3d/console.log'), '')
    await writeFile(resolve(fixture.root, '.kite3d/check.json'), '{}\n')
    page.on('request', (request) => {
        if (request.url().startsWith('https://library.example.test/') || request.url().includes('/files/assets/imports/mock-textured/')) {
            libraryRequests.push({method: request.method(), url: request.url()})
        }
    })
    page.on('response', (response) => {
        if (response.status() >= 400) httpErrors.push({status: response.status(), url: response.url()})
        const request = libraryRequests.findLast(({method, url, status}) =>
            status === undefined && method === response.request().method() && url === response.url())
        if (request) request.status = response.status()
    })
    page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('pageerror', (error) => pageErrors.push(error.message))
    try {
        await page.goto(fixture.server.url)
        await expect(page.getByText('Project loaded')).toBeVisible({timeout: 20_000})
        await page.getByRole('tab', {name: 'Library'}).click()
        await page.getByRole('tab', {name: '3D Models'}).click()
        const item = page.getByTitle(libraryRootUrl)
        await expect(item).toBeVisible()
        await expect(item).toHaveAttribute('draggable', 'true')

        const transfer = await page.evaluateHandle(() => new DataTransfer())
        await item.dispatchEvent('dragstart', {dataTransfer: transfer})
        await expect.poll(() => libraryRequests.filter(({method, url}) =>
            method === 'GET' && url.startsWith('https://library.example.test/')).length, {
            timeout: 20_000,
        }).toBe(3)
        await expect.poll(() => page.locator('.native-spinner').evaluate((element) =>
            getComputedStyle(element).display)).toBe('none')
        const canvas = page.locator('.editorCanvasContainer canvas').first()
        const bounds = await canvas.boundingBox()
        expect(bounds).not.toBeNull()
        const position = {clientX: bounds!.x + bounds!.width / 2, clientY: bounds!.y + bounds!.height / 2}
        await canvas.dispatchEvent('dragover', {...position, dataTransfer: transfer})
        await canvas.dispatchEvent('drop', {...position, dataTransfer: transfer})
        await item.dispatchEvent('dragend', {dataTransfer: transfer})

        const dialog = page.getByTestId('library-drop-dialog')
        await expect(dialog).toBeVisible()
        await expect(dialog).toContainText('Mock Textured Triangle')
        await expect(dialog.getByText('Add at the scene root')).toBeVisible()
        await dialog.getByTestId('library-drop-apply').click()

        await expect(page.getByTestId('scene-hierarchy')).toContainText('Mock Textured Triangle')
        const expectedAsset = {
            path: 'assets/imports/mock-textured/f.gltf',
            files: {
                'f.gltf': 'assets/imports/mock-textured/f.gltf',
                'mesh.bin': 'assets/imports/mock-textured/mesh.bin',
                'textures/pixel.png': 'assets/imports/mock-textured/textures/pixel.png',
            },
        }
        await expect.poll(async () => JSON.parse(await readFile(resolve(fixture.root, 'assets.json'), 'utf8')))
            .toEqual({version: 1, files: {'mock-textured': expectedAsset}})
        expect(await readFile(resolve(fixture.root, expectedAsset.files['f.gltf']), 'utf8')).toContain('mesh.bin')
        expect(await readFile(resolve(fixture.root, expectedAsset.files['mesh.bin']))).toEqual(library.binary)
        expect(await readFile(resolve(fixture.root, expectedAsset.files['textures/pixel.png']))).toEqual(library.texture)

        await expect.poll(() => texturedObjectState(page)).toEqual({meshCount: 1, positionCount: 3, textureWidth: 96})
        await expect(page.getByTestId('save-scene')).toBeEnabled()
        await page.getByTestId('save-scene').click()
        await expect(page.getByText('Scene saved')).toBeVisible({timeout: 20_000})
        const savedScene = JSON.parse(await readFile(resolve(fixture.root, 'assets/main.scene.gltf'), 'utf8')) as {
            nodes: Array<{extras?: {rootPath?: string}}>
        }
        expect(savedScene.nodes.some(({extras}) => extras?.rootPath === '/kite3d/@mock-textured/f.gltf')).toBe(true)

        await page.reload()
        await expect(page.getByText('Project loaded')).toBeVisible({timeout: 20_000})
        await expect.poll(() => texturedObjectState(page)).toEqual({meshCount: 1, positionCount: 3, textureWidth: 96})

        await page.getByTestId('check-game').click()
        await expect(page.getByTestId('check-game')).toBeDisabled()
        await expect(page.getByTestId('check-game')).toHaveAttribute('data-check-status', 'pass', {timeout: 45_000})
        await expect(page.getByTestId('check-game')).toBeEnabled()
        const check = JSON.parse(await readFile(resolve(fixture.root, '.kite3d/check.json'), 'utf8')) as {
            outcomes: Array<{name: string, status: string}>
        }
        expect(check.outcomes).toContainEqual(expect.objectContaining({name: 'Persisted', status: 'pass'}))

        await page.reload()
        await expect(page.getByText('Project loaded')).toBeVisible({timeout: 20_000})
        await expect.poll(() => texturedObjectState(page)).toEqual({meshCount: 1, positionCount: 3, textureWidth: 96})
        expect(libraryRequests.map(({method, url, status}) => ({method, path: new URL(url).pathname, status})))
            .toEqual(expect.arrayContaining([
                {method: 'GET', path: '/assets/mock-textured/mock-textured.gltf', status: 200},
                {method: 'GET', path: '/assets/mock-textured/mesh.bin', status: 200},
                {method: 'GET', path: '/assets/mock-textured/textures/pixel.png', status: 200},
                {method: 'PUT', path: '/files/assets/imports/mock-textured/f.gltf', status: 201},
                {method: 'PUT', path: '/files/assets/imports/mock-textured/mesh.bin', status: 201},
                {method: 'PUT', path: '/files/assets/imports/mock-textured/textures/pixel.png', status: 201},
                {method: 'GET', path: '/files/assets/imports/mock-textured/f.gltf', status: 200},
                {method: 'GET', path: '/files/assets/imports/mock-textured/mesh.bin', status: 200},
                {method: 'GET', path: '/files/assets/imports/mock-textured/textures/pixel.png', status: 200},
            ]))
        expect({consoleErrors, httpErrors}).toEqual({consoleErrors: [], httpErrors: []})
        expect(pageErrors).toEqual([])
    } finally {
        await page.close()
        await fixture.close()
    }
})

test('prompts for library drop actions, remembers choices, resets prompts, and supports undo', async ({page}) => {
    test.setTimeout(120_000)
    const screenshotDirectory = fileURLToPath(new URL('../../test-results/library-drop-dialog/', import.meta.url))
    const fixture = await startPublishEditor({}, async (projectRoot) => {
        await writeFile(resolve(projectRoot, 'assets/main.scene.gltf'), `${libraryDropSceneGltf()}\n`)
    })
    const library = await routeMockLibrary(page)
    const consoleErrors: string[] = []
    const pageErrors: string[] = []
    page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('pageerror', (error) => pageErrors.push(error.message))

    const selectObject = async (name: string) => {
        await page.evaluate((objectName) => {
            const viewer = (window as unknown as {viewer: {scene: {
                defaultCamera: {name: string, dispatchEvent(event: Record<string, unknown>): void}
                modelRoot: {getObjectByName(name: string): {
                    name: string
                    dispatchEvent(event: Record<string, unknown>): void
                } | undefined}
            }}}).viewer
            const object = objectName === 'Default Camera'
                ? viewer.scene.defaultCamera
                : viewer.scene.modelRoot.getObjectByName(objectName)
            if (!object) {
                const names: string[] = []
                ;(viewer.scene.modelRoot as unknown as {traverse(callback: (value: {name: string}) => void): void})
                    .traverse((value) => names.push(value.name))
                throw new Error(`Missing scene object: ${objectName}. Loaded: ${names.join(', ')}`)
            }
            object.dispatchEvent({type: 'select', value: object, object, ui: true, bubbleToParent: true})
        }, name)
    }
    const dropAsset = async (url: string) => {
        const item = page.getByTitle(url)
        await expect(item).toBeVisible()
        const transfer = await page.evaluateHandle(() => new DataTransfer())
        await item.dispatchEvent('dragstart', {dataTransfer: transfer})
        await expect.poll(() => page.locator('.native-spinner').evaluate((element) =>
            getComputedStyle(element).display), {timeout: 20_000}).toBe('none')
        const canvas = page.locator('.editorCanvasContainer canvas').first()
        const bounds = await canvas.boundingBox()
        expect(bounds).not.toBeNull()
        const position = {clientX: bounds!.x + bounds!.width / 2, clientY: bounds!.y + bounds!.height / 2}
        await canvas.dispatchEvent('dragover', {...position, dataTransfer: transfer})
        await canvas.dispatchEvent('drop', {...position, dataTransfer: transfer})
        await item.dispatchEvent('dragend', {dataTransfer: transfer})
    }
    const modelCountUnderGroup = () => page.evaluate(() => {
        const group = (window as unknown as {viewer: {scene: {modelRoot: {getObjectByName(name: string): {
            children: Array<{name: string}>
        } | undefined}}}}).viewer.scene.modelRoot.getObjectByName('Drop_Target_Group')
        return group?.children.filter(({name}) => name === 'Mock Textured Triangle').length || 0
    })

    try {
        await mkdir(screenshotDirectory, {recursive: true})
        await page.setViewportSize({width: 1400, height: 900})
        await page.goto(fixture.server.url)
        await expect(page.getByText('Project loaded')).toBeVisible({timeout: 20_000})
        await selectObject('Drop_Target_Group')
        await page.getByRole('tab', {name: 'Library'}).click()
        const libraryPanel = page.getByRole('tabpanel', {name: 'Library'})
        await libraryPanel.getByRole('tab', {name: '3D Models'}).click()
        await dropAsset(library.modelUrl)

        const dialog = page.getByTestId('library-drop-dialog')
        await expect(dialog).toBeVisible()
        await expect(dialog).toContainText('Drop_Target_Group')
        await expect(dialog.getByText('The selected hierarchy object was used.')).toBeVisible()
        await expect(dialog.getByText('Add under Drop_Target_Group')).toBeVisible()
        await page.waitForTimeout(350)
        await page.screenshot({path: resolve(screenshotDirectory, 'model-dialog.png')})
        await dialog.getByRole('checkbox', {name: 'Remember my choice for model'}).check({force: true})
        await dialog.getByTestId('library-drop-apply').click()
        await expect.poll(modelCountUnderGroup).toBe(1)

        await selectObject('Drop_Target_Group')
        await dropAsset(library.modelUrl)
        await expect(dialog).toHaveCount(0)
        await expect.poll(modelCountUnderGroup).toBe(2)
        await page.keyboard.press('Meta+z')
        await expect.poll(modelCountUnderGroup).toBe(1)
        await expect(page.getByTestId('save-scene')).toBeEnabled()
        await page.getByTestId('save-scene').click()
        await expect(page.getByText('Scene saved')).toBeVisible({timeout: 20_000})
        const savedAfterModel = JSON.parse(await readFile(resolve(fixture.root, 'assets/main.scene.gltf'), 'utf8')) as {
            nodes: Array<{name?: string, children?: number[]}>
        }
        const groupNode = savedAfterModel.nodes.find(({name}) => name === 'Drop_Target_Group')
        expect(groupNode?.children?.some((index) => savedAfterModel.nodes[index]?.name === 'Mock Textured Triangle')).toBe(true)

        await page.getByRole('button', {name: 'Settings'}).click()
        const settings = page.getByTestId('editor-settings-popover')
        await expect(settings).toBeVisible()
        await settings.getByTestId('reset-drop-prompts').scrollIntoViewIfNeeded()
        await page.screenshot({path: resolve(screenshotDirectory, 'reset-drop-prompts.png')})
        await settings.getByTestId('reset-drop-prompts').click()
        await page.keyboard.press('Escape')

        await selectObject('Drop_Target_Group')
        await dropAsset(library.modelUrl)
        await expect(dialog).toBeVisible()
        const modelCountBeforeCancel = await modelCountUnderGroup()
        const errorsBeforeCancel = [...consoleErrors]
        await dialog.getByRole('button', {name: 'Cancel'}).click()
        await expect.poll(modelCountUnderGroup).toBe(modelCountBeforeCancel)
        await page.waitForTimeout(100)
        expect(consoleErrors).toEqual(errorsBeforeCancel)
        await expect.poll(async () => Object.keys(
            (JSON.parse(await readFile(resolve(fixture.root, 'assets.json'), 'utf8')) as {
                files: Record<string, unknown>
            }).files,
        )).toContain('mock-textured-2')

        await selectObject('Texture_Target')
        await libraryPanel.getByRole('tab', {name: 'Textures'}).click()
        await expect(page.getByTitle(library.textureUrl)).toHaveAttribute('draggable', 'true')
        await dropAsset(library.textureUrl)
        await expect(dialog).toBeVisible()
        await expect(dialog).toContainText('Texture_Target')
        await expect(dialog.getByTestId('library-drop-slot').locator('option')).toHaveText([
            'Base color', 'Normal', 'Roughness', 'Metalness', 'Emissive', 'Occlusion',
        ])
        await dialog.getByTestId('library-drop-slot').selectOption('normalMap')
        await page.waitForTimeout(350)
        await page.screenshot({path: resolve(screenshotDirectory, 'texture-slot-dialog.png')})
        await dialog.getByRole('checkbox', {name: 'Remember my choice for texture'}).check({force: true})
        await dialog.getByTestId('library-drop-apply').click()
        const firstNormalMap = await page.evaluate(() => {
            const target = (window as unknown as {viewer: {scene: {modelRoot: {getObjectByName(name: string): {
                material?: {normalMap?: {uuid?: string, name?: string}}
            } | undefined}}}}).viewer.scene.modelRoot.getObjectByName('Texture_Target')
            return target?.material?.normalMap
                ? {uuid: target.material.normalMap.uuid, name: target.material.normalMap.name}
                : null
        })
        expect(firstNormalMap?.name).toBe('Mock Normal Texture')
        await page.getByTestId('save-scene').click()
        await expect(page.getByText('Scene saved')).toBeVisible({timeout: 20_000})

        await selectObject('Texture_Target')
        await dropAsset(library.textureUrl)
        await expect(dialog).toHaveCount(0)
        await expect.poll(() => page.evaluate(() => {
            const target = (window as unknown as {viewer: {scene: {modelRoot: {getObjectByName(name: string): {
                material?: {normalMap?: {uuid?: string}}
            } | undefined}}}}).viewer.scene.modelRoot.getObjectByName('Texture_Target')
            return target?.material?.normalMap?.uuid
        })).not.toBe(firstNormalMap?.uuid)
        await page.keyboard.press('Meta+z')
        await expect.poll(() => page.evaluate(() => {
            const target = (window as unknown as {viewer: {scene: {modelRoot: {getObjectByName(name: string): {
                material?: {normalMap?: {uuid?: string}}
            } | undefined}}}}).viewer.scene.modelRoot.getObjectByName('Texture_Target')
            return target?.material?.normalMap?.uuid
        })).toBe(firstNormalMap?.uuid)

        await libraryPanel.getByRole('tab', {name: 'Environment Maps'}).click()
        await page.getByTitle(library.environmentUrl).dblclick()
        await expect(dialog).toBeVisible()
        await dialog.getByRole('radio', {name: 'Both'}).check({force: true})
        await page.keyboard.press('Enter')
        await expect.poll(() => page.evaluate(() => {
            const scene = (window as unknown as {viewer: {scene: {
                environment?: {name?: string}
                background?: {name?: string}
            }}}).viewer.scene
            return {
                same: scene.environment === scene.background,
                environment: scene.environment?.name,
                background: scene.background?.name,
            }
        })).toEqual({same: true, environment: 'Mock Studio HDR', background: 'Mock Studio HDR'})

        await selectObject('Drop_Target_Group')
        await libraryPanel.getByRole('tab', {name: 'Materials'}).click()
        await page.getByTitle(library.materialUrl).dblclick()
        await expect(dialog).toBeVisible()
        await expect(dialog).toContainText(/Apply to the 2 meshes under Drop_Target_Group/)
        await dialog.getByTestId('library-drop-apply').click()
        await expect.poll(() => page.evaluate(() => {
            const group = (window as unknown as {viewer: {scene: {modelRoot: {getObjectByName(name: string): {
                traverse(callback: (object: {isMesh?: boolean, material?: {name?: string}}) => void): void
            } | undefined}}}}).viewer.scene.modelRoot.getObjectByName('Drop_Target_Group')
            const materials: string[] = []
            group?.traverse((object) => {
                if (object.isMesh) materials.push(object.material?.name || '')
            })
            return materials
        })).toEqual(['Mock Red Material', 'Mock Red Material'])

        await selectObject('Default Camera')
        await libraryPanel.getByRole('tab', {name: 'Textures'}).click()
        await page.getByTitle(library.textureUrl).dblclick()
        await expect(dialog).toBeVisible()
        await expect(dialog.getByTestId('library-drop-target')).toContainText('Default Camera')
        await expect(dialog.getByText('Import into the project only')).toBeVisible()
        await expect(dialog.getByTestId('library-drop-reason')).toContainText('has no material')
        const errorsBeforeEscape = [...consoleErrors]
        await page.keyboard.press('Escape')
        await expect(dialog).toHaveCount(0)
        await page.waitForTimeout(100)
        expect(consoleErrors).toEqual(errorsBeforeEscape)

        await page.getByTestId('save-scene').click()
        await expect(page.getByText('Scene saved')).toBeVisible({timeout: 20_000})
        expect(pageErrors).toEqual([])
    } finally {
        await page.close()
        await fixture.close()
    }
})

test('creates a missing assets.json registry when the first asset is dropped', async ({page}) => {
    test.setTimeout(90_000)
    const fixture = await startPublishEditor()
    try {
        await rm(resolve(fixture.root, 'assets.json'))
        await page.goto(fixture.server.url)
        await expect(page.getByText('Project loaded')).toBeVisible({timeout: 20_000})

        const glb = minimalTriangleGlb('Missing registry fixture')
        await page.locator('.editorCanvasContainer').dispatchEvent('drop', {
            dataTransfer: await page.evaluateHandle(({bytes}) => {
                const transfer = new DataTransfer()
                transfer.items.add(new File(
                    [Uint8Array.from(bytes)],
                    'missing-registry.glb',
                    {type: 'model/gltf-binary'},
                ))
                return transfer
            }, {bytes: [...glb]}),
        })

        const assetsUrl = new URL('/files/assets.json', fixture.server.url)
        await expect.poll(async () => {
            const response = await fetch(assetsUrl, {headers: {'X-Kite3D-Token': fixture.server.token}})
            if (!response.ok) return undefined
            const assets = await response.json() as {
                files: Record<string, {path: string}>
            }
            return assets.files
        }, {timeout: 30_000}).toEqual({'missing-registry': {path: 'assets/imports/missing-registry.glb'}})
        expect(JSON.parse(await readFile(resolve(fixture.root, 'assets.json'), 'utf8'))).toEqual({
            files: {'missing-registry': {path: 'assets/imports/missing-registry.glb'}},
            version: 1,
        })
    } finally {
        await page.close()
        await fixture.close()
    }
})

test('reports leaked runtime content after Stop in a toast and the console log', async ({page}) => {
    await page.goto(server.url)
    await expect(page.getByText('Project loaded')).toBeVisible({timeout: 20_000})
    await page.getByTestId('play').click()
    await expect(page.getByText('Playing')).toBeVisible({timeout: 20_000})
    await page.evaluate(async () => {
        const {BoxGeometry, Mesh, MeshStandardMaterial} = await import('@kite3d/engine')
        const leaked = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial())
        leaked.name = 'Leaked Play object'
        ;(window as unknown as {__kite3dRuntimeViewer: {scene: {add(object: unknown): void}}}).__kite3dRuntimeViewer.scene.add(leaked)
    })
    await page.getByTestId('play').click()

    await expect(page.getByText(/Runtime cleanup failed: RUNTIME_OBJECT_AFTER_STOP/)).toBeVisible()
    await expect.poll(async () => (await readFile(resolve(root, '.kite3d/console.log'), 'utf8')))
        .toContain('runtime cleanup failed: RUNTIME_OBJECT_AFTER_STOP')
})

test('edits generator params with declared and inferred controls', async ({page}) => {
    test.setTimeout(90_000)
    await page.setViewportSize({width: 1400, height: 900})
    await page.goto(server.url)
    await expect(page.getByText('Project loaded')).toBeVisible({timeout: 20_000})
    await page.getByRole('tab', {name: 'Inspector'}).click()
    await page.getByRole('button', {name: 'RoundTripObject'}).click()

    const inspector = page.getByTestId('generator-inspector')
    await expect(inspector.getByText('Shading', {exact: true})).toBeVisible()
    await expect(inspector.getByText('Spawn markers', {exact: true})).toBeVisible()
    await expect(inspector.getByText('Tree count', {exact: true})).toBeVisible()
    await expect(inspector.getByText('Tree height', {exact: true})).toBeVisible()
    await expect(inspector.getByText('Legacy mode', {exact: true})).toBeVisible()
    await expect(inspector.getByTestId('generator-param-detail')).toHaveValue('0')
    await expect(inspector.getByRole('checkbox', {name: 'Spawn markers'})).toBeChecked()
    await expect(inspector.getByLabel('Tree count')).toHaveValue('2')
    await expect(inspector.getByLabel('Tree height')).toHaveValue('3')
    await expect(inspector.locator('.generator-param-row').filter({hasText: 'Tree height'})).toContainText('default')
    await expect(inspector.getByTestId('generator-param-legacyMode')).toHaveValue('classic')
    await expect(page.getByTestId('generator-params-1')).toBeHidden()

    await mkdir(resolve(import.meta.dirname, '../../test-results/generator-params'), {recursive: true})
    await inspector.scrollIntoViewIfNeeded()
    await page.screenshot({path: resolve(import.meta.dirname, '../../test-results/generator-params/declared-params.png')})

    const beforeRuns = await page.evaluate(() => (window as unknown as {__generatorRuns: number}).__generatorRuns)
    await inspector.getByTestId('generator-param-detail').selectOption({label: 'Full shaders'})
    await expect.poll(async () => (await readGeneratorState('RoundTripObject')).params.detail).toBe('full')
    await expect.poll(() => page.evaluate(() => (window as unknown as {__generatorRuns: number}).__generatorRuns))
        .toBeGreaterThan(beforeRuns)

    await inspector.locator('.generator-param-row').filter({hasText: 'Spawn markers'})
        .locator('.bp5-control-indicator').click()
    await expect.poll(async () => (await readGeneratorState('RoundTripObject')).params.markers).toBe(false)

    const beforeInvalidNumber = await readFile(resolve(root, 'assets/main.scene.gltf'), 'utf8')
    await inspector.getByLabel('Tree count').fill('9')
    await inspector.getByLabel('Tree count').blur()
    await expect(inspector.getByRole('alert')).toContainText('Tree count must be at most 5.')
    expect(await readFile(resolve(root, 'assets/main.scene.gltf'), 'utf8')).toBe(beforeInvalidNumber)

    await inspector.getByLabel('Tree count').fill('3')
    await writeFile(resolve(root, 'Generator.js'), generatorModule('Tree', 0, 'Render style'))
    await expect(page.getByText('Generator.js regenerated')).toBeVisible({timeout: 20_000})
    await expect(inspector.getByText('Render style', {exact: true})).toBeVisible()
    await expect(inspector.getByLabel('Tree count')).toHaveValue('3')
    await inspector.getByLabel('Tree count').fill('2')
    await inspector.getByLabel('Tree count').blur()
    await expect.poll(async () => (await readGeneratorState('RoundTripObject')).params.count).toBe(2)

    await inspector.getByText('Edit as JSON').click()
    const beforeInvalidJson = await readFile(resolve(root, 'assets/main.scene.gltf'), 'utf8')
    await page.getByTestId('generator-params-1').fill('{"count":')
    await inspector.getByRole('button', {name: 'Apply', exact: true}).click()
    await expect(inspector.locator('.generator-json-error')).toContainText('JSON')
    expect(await readFile(resolve(root, 'assets/main.scene.gltf'), 'utf8')).toBe(beforeInvalidJson)
    await page.screenshot({path: resolve(import.meta.dirname, '../../test-results/generator-params/json-error.png')})

    await page.getByRole('button', {name: 'Floor_Generator'}).click()
    const inferredInspector = page.getByTestId('generator-inspector')
    await expect(inferredInspector.getByText('Width', {exact: true})).toBeVisible()
    await expect(inferredInspector.getByLabel('Width')).toHaveValue('40')
    await expect(inferredInspector.getByText('Shading', {exact: true})).toHaveCount(0)
    await expect(inferredInspector.getByText('Edit as JSON')).toBeVisible()
    await page.screenshot({path: resolve(import.meta.dirname, '../../test-results/generator-params/inferred-params.png')})
})

test('loads the restored panels, watches generators, and saves text glTF without echo reload', async ({page}) => {
    test.setTimeout(90_000)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('https://blitz-asset-library-proxy.blitzapp.workers.dev/assets/v1/list', async (route) => {
        await route.fulfill({json: {assets: [{
            id: '@polyhaven/rock',
            name: 'Polyhaven Rock',
            type: 'model',
            fileUrl: 'https://assets.example.test/polyhaven-rock.glb',
            thumbnailUrl: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
        }]}})
    })
    await page.route('**/api/files', async (route) => {
        const response = await fetch(`http://127.0.0.1:${server.port}/api/files`, {
            headers: {'X-Kite3D-Token': server.token},
        })
        const files = await response.json() as Array<Record<string, unknown>>
        await route.fulfill({json: [
            ...files,
            {path: '.kite3d/deploys.json', size: 1, sha256: 'a'.repeat(64), mtime: 0},
            {path: '.kite3d/dev.json', size: 1, sha256: 'b'.repeat(64), mtime: 0},
        ]})
    })
    await page.goto(server.url)

    await expect(page.getByRole('heading', {name: 'kite3d-editor-e2e-'})).toBeVisible()
    await expect(page.getByText('Project loaded')).toBeVisible({timeout: 20_000})
    for (const panel of ['Objects', 'Materials', 'Textures', 'Geometries', 'Scene', 'Inspector', 'Project', 'Files', 'Library', 'Timeline']) {
        await expect(page.getByRole('tab', {name: panel})).toBeVisible()
    }
    await expect(page.getByTestId('project-files').getByRole('button', {name: 'assets/main.scene.gltf'})).toBeVisible()
    await page.getByRole('tab', {name: 'Library'}).click()
    await expect(page.getByTestId('asset-library-item')).toContainText('Polyhaven Rock')
    await page.getByRole('tab', {name: 'Files'}).click()

    const hierarchy = page.getByTestId('scene-hierarchy')
    await expect(hierarchy).toContainText('RoundTripObject')
    await expect(hierarchy).toContainText(/Tree 0\s*generated/)
    await expect(hierarchy).toContainText(/Tree 1\s*generated/)
    await expect(page.getByTestId('unlisted-script-warning').filter({hasText: 'Unlisted.script.js'})).toBeVisible()
    await expect(page.getByTestId('unlisted-script-warning').filter({hasText: 'samples/Spin.script.js'})).toHaveCount(0)
    await expect(page.getByTestId('project-files')).not.toContainText('.kite3d/deploys.json')
    await expect(page.getByTestId('project-files')).not.toContainText('.kite3d/dev.json')

    await page.getByRole('tab', {name: 'Project'}).click()
    await expect(page.getByTestId('component-types')).toContainText('HotScript')
    await expect(page.getByTestId('component-types')).toContainText('Generator')
    await expect(page.getByTestId('component-types')).not.toContainText('UnlistedComponent')

    await page.getByRole('tab', {name: 'Inspector'}).click()
    await page.getByRole('button', {name: 'Hot_reload_target'}).click()
    const before = await manifestHash('assets/main.scene.gltf')
    await page.locator('#inspector-object-name').fill('Saved target')
    await expect.poll(async () => JSON.parse(await readFile(resolve(root, '.kite3d/state.json'), 'utf8')).dirty).toBe(true)
    await page.getByTestId('save-scene').click()
    await expect(page.getByText('Scene saved')).toBeVisible({timeout: 20_000})
    await expect.poll(async () => JSON.parse(await readFile(resolve(root, '.kite3d/state.json'), 'utf8')).dirty).toBe(false)
    await expect.poll(() => manifestHash('assets/main.scene.gltf')).not.toBe(before)
    await page.waitForTimeout(300)
    await expect(page.getByText('Scene reloaded from disk')).toHaveCount(0)

    await page.getByRole('button', {name: 'RoundTripObject'}).click()
    const rightPanel = page.locator('#right-panel')
    await expect(rightPanel.getByText('Selection', {exact: true})).toHaveCount(0)
    await expect(rightPanel.getByRole('button', {name: 'Round Trip Object', exact: true})).toHaveCount(1)
    const components = rightPanel.getByTestId('components-section')
    await expect(components.getByRole('heading', {name: /Components/})).toBeVisible()
    await expect(components.getByText('Add Comp', {exact: true})).toBeVisible()
    await expect(components.locator('.folder-trigger-text').filter({hasText: /^Generator$/})).toHaveCount(0)
    const generatorInspector = rightPanel.getByTestId('generator-inspector')
    await expect(generatorInspector).toContainText('Generator · RoundTripObject')
    await expect(generatorInspector.getByRole('heading', {name: 'Generator', exact: true})).toHaveCount(1)
    const beforeGeneratorEdit = await manifestHash('assets/main.scene.gltf')
    await generatorInspector.getByText('Edit as JSON').click()
    await page.getByTestId('generator-params-1').fill('{"count": 3}')
    await generatorInspector.getByRole('button', {name: 'Apply', exact: true}).click()
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
    expect(savedScene).not.toContain('kite3dGenerated')

    const journal = (await readFile(resolve(root, '.kite3d/journal.jsonl'), 'utf8'))
        .split('\n').filter(Boolean).map((line) => JSON.parse(line) as {client: string})
    expect(journal.some(({client}) => client !== 'external')).toBe(true)

    await writeFile(resolve(root, 'Generator.js'), generatorModule('Reloaded tree', 1))
    await expect(page.getByText('Generator.js regenerated')).toBeVisible({timeout: 20_000})
    await expect(hierarchy).toContainText(/Reloaded tree 3\s*generated/)

    await page.getByTestId('bake-1').click()
    await expect(page.getByText('Baked RoundTripObject')).toBeVisible({timeout: 20_000})
    const bakedSceneText = await readFile(resolve(root, 'assets/main.scene.gltf'), 'utf8')
    const bakedScene = JSON.parse(bakedSceneText) as {
        nodes: Array<{name?: string, children?: number[], extras?: {
            EntityComponentPlugin?: Record<string, {type?: string}>
            [key: string]: unknown
        }}>
    }
    const bakedRoot = bakedScene.nodes.find(({name}) => name === 'RoundTripObject')
    expect(bakedRoot?.children).toHaveLength(4)
    expect(bakedRoot?.extras).toHaveProperty('kite3dBakedFrom')
    expect(bakedSceneText).not.toContain('kite3dGenerated')
    expect(bakedSceneText).not.toContain('excludeFromExport')
    expect(Object.values(bakedRoot?.extras?.EntityComponentPlugin || {}).map(({type}) => type))
        .not.toContain('Generator')
    expect(errors).toEqual([])
})

test('uses two right-panel tabs, flagged Memory, editor settings, Scripts, and one scroll owner', async ({page}) => {
    await page.setViewportSize({width: 1280, height: 600})
    await page.goto(server.url)
    await expect(page.getByText('Project loaded')).toBeVisible({timeout: 20_000})

    const rightPanel = page.locator('#right-panel')
    const tabs = rightPanel.getByRole('tab')
    await expect(tabs).toHaveCount(2)
    await expect(tabs).toHaveText(['Inspector', 'Project'])
    await expect(rightPanel.getByRole('tab', {name: 'Settings'})).toHaveCount(0)
    await expect(rightPanel.getByRole('tab', {name: 'Memory'})).toHaveCount(0)

    await page.getByRole('button', {name: 'Settings', exact: true}).click()
    const settings = page.getByTestId('editor-settings-popover')
    await expect(settings.getByRole('heading', {name: 'Editor settings'})).toBeVisible()
    await expect(settings.getByText('Rendering', {exact: true})).toBeVisible()
    await expect(settings.getByText('Timeline', {exact: true})).toBeVisible()
    await expect(settings.getByRole('heading', {name: 'Modes'})).toBeVisible()
    await expect(settings.getByRole('heading', {name: 'Import'})).toBeVisible()
    await expect(settings.getByRole('heading', {name: 'Preview'})).toBeVisible()
    await expect(settings.getByText('Edit', {exact: true})).toHaveCount(0)
    const settingsScroll = settings.getByTestId('editor-settings-scroll')
    const scrollMetrics = await settingsScroll.evaluate((element) => ({
        clientHeight: element.clientHeight,
        overflowY: getComputedStyle(element).overflowY,
        scrollHeight: element.scrollHeight,
        scrollTop: element.scrollTop,
    }))
    expect(scrollMetrics.overflowY).toBe('auto')
    expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight)
    await settingsScroll.evaluate((element) => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => settingsScroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
    await expect(settings.getByRole('heading', {name: 'Preview'})).toBeInViewport()
    await page.mouse.click(10, 300)
    await expect(settings).toBeHidden()

    await rightPanel.getByRole('tab', {name: 'Project'}).click()
    await expect(rightPanel.getByRole('heading', {name: /Scripts/})).toBeVisible()
    await expect(rightPanel.getByText('Loaded', {exact: true}).first()).toBeVisible()
    await expect(rightPanel.getByText('Resolved', {exact: true})).toBeVisible()
    const dependencies = rightPanel.locator('.kite3d-project-section').filter({hasText: 'Dependencies'})
    const kite3dDependency = dependencies.locator('.kite3d-project-row').filter({hasText: /^kite3ddev/})
    await expect(kite3dDependency).toContainText('dev')
    const scrollOwners = await rightPanel.evaluate((panel) => {
        const activeBody = [...panel.querySelectorAll<HTMLElement>('.bp5-tab-panel')]
            .find((element) => element.getBoundingClientRect().height > 0)
        if (!activeBody) return []
        activeBody.style.height = '120px'
        activeBody.style.maxHeight = '120px'
        activeBody.style.flex = '0 0 120px'
        return [...panel.querySelectorAll<HTMLElement>('*')].filter((element) => {
            const style = getComputedStyle(element)
            const visible = element.getBoundingClientRect().height > 0
            return visible && /^(auto|scroll)$/.test(style.overflowY)
                && element.scrollHeight > element.clientHeight
        }).map((element) => element.className)
    })
    expect(scrollOwners).toHaveLength(1)

    const flaggedUrl = new URL(server.url)
    flaggedUrl.searchParams.set('memory', '1')
    await page.goto(flaggedUrl.href)
    await expect(page.getByText('Project loaded')).toBeVisible({timeout: 20_000})
    await expect(page.locator('#right-panel').getByRole('tab', {name: 'Memory'})).toBeVisible()
})

test('places Open game beside Play and checkpoints and restores from the Save Scene menu', async ({page}) => {
    await page.goto(server.url)
    await expect(page.getByText('Project loaded')).toBeVisible({timeout: 20_000})
    const openGame = page.getByTestId('open-game')
    const placement = await page.evaluate(() => {
        const play = document.querySelector('[data-testid="play"]')
        const open = document.querySelector('[data-testid="open-game"]')
        const buttons = [...(play?.closest('.bp5-button-group')?.querySelectorAll('button') || [])]
        return {
            sameGroup: play?.closest('.bp5-button-group') === open?.closest('.bp5-button-group'),
            immediatelyAfter: buttons.indexOf(open as HTMLButtonElement) === buttons.indexOf(play as HTMLButtonElement) + 1,
        }
    })
    expect(placement).toEqual({sameGroup: true, immediatelyAfter: true})
    await expect(openGame).toHaveText('')
    await expect(openGame.locator('.bp5-icon-open-application')).toBeVisible()
    await openGame.hover()
    await expect(page.getByText('Open game in a new tab', {exact: true})).toBeVisible()
    await expect(page.locator('.bp5-navbar > .kite3d-toolbar-controls')).toHaveCount(0)

    const saveGroup = page.getByTestId('save-scene').locator('..')
    const saveMenuButton = saveGroup.getByRole('button').filter({has: page.locator('.bp5-icon-caret-down')})
    await saveMenuButton.click()
    const saveMenu = page.getByRole('menu').filter({has: page.getByRole('menuitem', {name: 'Save and Close'})})
    await expect(saveMenu).toBeVisible()
    const menuItems = saveMenu.getByRole('menuitem')
    await expect(menuItems).toHaveCount(5)
    await expect(menuItems.nth(0)).toContainText('Save Scene')
    await expect(menuItems.nth(1)).toContainText('Checkpoint...')
    await expect(menuItems.nth(2)).toContainText('Restore last checkpoint')
    await expect(menuItems.nth(3)).toHaveText('Save and Close')
    await expect(menuItems.nth(4)).toHaveText('Close Project')

    const mainPath = resolve(root, 'main.js')
    const checkpointContents = await readFile(mainPath, 'utf8')
    await page.getByTestId('checkpoint-game').click()
    const checkpointPopover = page.getByTestId('checkpoint-popover')
    await expect(checkpointPopover).toBeVisible()
    await checkpointPopover.getByPlaceholder('Label (optional)').fill('before menu restore')
    await checkpointPopover.getByRole('button', {name: 'Create', exact: true}).click()
    const checkpointToast = page.getByText(/Checkpoint [a-f\d]+ before menu restore created\./)
    await expect(checkpointToast).toBeVisible({timeout: 10_000})
    const checkpointHash = (await checkpointToast.textContent())?.match(/Checkpoint ([a-f\d]+)/)?.[1]
    expect(checkpointHash).toBeTruthy()

    await writeFile(mainPath, 'export async function main() { window.__restored = false }\n')
    await expect.poll(() => readFile(mainPath, 'utf8')).not.toBe(checkpointContents)
    await saveMenuButton.click()
    await expect(page.getByTestId('restore-checkpoint')).toContainText('Restore last checkpoint')
    await page.getByTestId('restore-checkpoint').click()
    const restorePopover = page.getByTestId('restore-checkpoint-popover')
    await expect(restorePopover).toContainText(`Checkpoint ${checkpointHash}`)
    await expect(restorePopover).toContainText('before menu restore')
    await expect(restorePopover).toContainText('Unsaved changes will be lost.')
    await restorePopover.getByRole('button', {name: 'Restore', exact: true}).click()

    await expect(page.getByText(/Restored checkpoint [a-f\d]+\./)).toBeVisible({timeout: 10_000})
    await expect.poll(() => readFile(mainPath, 'utf8')).toBe(checkpointContents)
    await page.getByRole('button', {name: 'Settings', exact: true}).click()
    await expect(page.getByTestId('restore-checkpoint')).toHaveCount(0)
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
        __kite3dRuntimeViewer?: {getPlugin(type: string): {hasComponentType(type: string): boolean} | undefined}
    }).__kite3dRuntimeViewer?.getPlugin('EntityComponentPlugin')?.hasComponentType('UnlistedComponent'))).toBe(false)
    await expect.poll(async () => JSON.parse(await readFile(resolve(root, '.kite3d/state.json'), 'utf8')).playState).toBe('playing')
    const agentState = JSON.parse(await readFile(resolve(root, '.kite3d/state.json'), 'utf8')) as Record<string, unknown>
    expect(agentState).toMatchObject({projectLoaded: true, playState: 'playing'})
    expect(agentState.clientId).toEqual(expect.any(String))
    expect(agentState.updatedAt).toEqual(expect.any(String))
    const firstUpdatedAt = agentState.updatedAt
    await expect.poll(async () => JSON.parse(await readFile(resolve(root, '.kite3d/state.json'), 'utf8')).updatedAt, {
        timeout: 10_000,
    }).not.toBe(firstUpdatedAt)
    await expect.poll(() => page.evaluate(() => (window as unknown as {__kite3dLoopTicks?: number}).__kite3dLoopTicks || 0)).toBeGreaterThan(10)

    const editViewerUuid = await page.evaluate(() => (window as unknown as {viewer: {scene: {uuid: string}}}).viewer.scene.uuid)
    const firstRuns = await page.evaluate(() => (window as unknown as {__kite3dMainRuns?: number}).__kite3dMainRuns || 0)
    await expect.poll(() => page.evaluate(() => (window as unknown as {__hotScriptVersion?: string}).__hotScriptVersion)).toBe('v1')
    await expect.poll(() => page.evaluate(() => (window as unknown as {__hotPluginVersion?: string}).__hotPluginVersion)).toBe('v1')

    await writeFile(resolve(root, 'Hot.script.js'), hotScript('v2'))
    await expect(page.getByText('Hot.script.js reloaded')).toBeVisible({timeout: 20_000})
    await expect.poll(() => page.evaluate(() => (window as unknown as {__hotScriptVersion?: string}).__hotScriptVersion)).toBe('v2')
    await expect.poll(() => page.evaluate(() => (window as unknown as {__kite3dMainRuns?: number}).__kite3dMainRuns || 0)).toBeGreaterThan(firstRuns)
    await expect(page.getByTestId('game-canvas')).toBeVisible()
    expect(await page.evaluate(() => (window as unknown as {viewer: {scene: {uuid: string}}}).viewer.scene.uuid)).toBe(editViewerUuid)

    const moduleUrls = await page.evaluate(() => performance.getEntriesByType('resource').map(({name}) => name))
    expect(moduleUrls.some((url) => /\/files\/Hot\.script\.js\?v=[a-f\d]{64}(?:&r=\d+)?$/.test(url))).toBe(true)
    expect(moduleUrls.some((url) => /\/files\/Hot\.plugin\.js\?v=[a-f\d]{64}(?:&r=\d+)?$/.test(url))).toBe(true)

    await page.evaluate(() => {
        console.warn('[warn-forwarding-check] visible')
        for (let index = 0; index < 30; index += 1) console.error(`[rate-limit-check] ${index}`)
    })
    await expect.poll(async () => (await readFile(resolve(root, '.kite3d/console.log'), 'utf8').catch(() => '')).includes('[HotScript] v2')).toBe(true)
    await expect.poll(async () => (await readFile(resolve(root, '.kite3d/console.log'), 'utf8').catch(() => '')).includes('[rate-limit-check] 0')).toBe(true)
    const consoleLog = await readFile(resolve(root, '.kite3d/console.log'), 'utf8')
    expect(consoleLog.split('\n')[0]).toMatch(/^# Kite3D play log started .*; levels: console\.warn, console\.error, uncaught errors$/)
    expect(consoleLog).toContain('[console.warn] [warn-forwarding-check] visible')
    expect(consoleLog.match(/\[rate-limit-check\]/g)?.length || 0).toBeLessThanOrEqual(20)

    await page.getByTestId('play').click()
    await expect(page.getByText('Stopped')).toBeVisible()
    await expect(page.getByTestId('game-canvas')).toHaveCount(0)
    const stoppedAt = await page.evaluate(() => (window as unknown as {__kite3dLoopTicks: number}).__kite3dLoopTicks)
    await page.waitForTimeout(200)
    expect(await page.evaluate(() => (window as unknown as {__kite3dLoopTicks: number}).__kite3dLoopTicks)).toBe(stoppedAt)
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
    await expect.poll(async () => JSON.parse(await readFile(resolve(root, '.kite3d/state.json'), 'utf8')).playState).toBe('playing')

    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))

    await expect.poll(async () => JSON.parse(await readFile(resolve(root, '.kite3d/state.json'), 'utf8')).playState).toBe('stopped')
})

test('keeps the upstream viewport chrome and Default Camera on an empty project', async ({page}) => {
    const emptyRoot = await mkdtemp(resolve(tmpdir(), 'kite3d-editor-empty-'))
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
        await expect(page.getByTestId('scene-summary').getByText('Camera', {exact: true})).toHaveCount(0)
    } finally {
        await emptyServer.close()
        await rm(emptyRoot, {recursive: true, force: true})
    }
})

test('shows the camera stored in the scene instead of the edit camera', async ({page}) => {
    const cameraRoot = await mkdtemp(resolve(tmpdir(), 'kite3d-editor-camera-'))
    await initProject(cameraRoot)
    const scenePath = resolve(cameraRoot, 'assets/main.scene.gltf')
    const scene = JSON.parse(await readFile(scenePath, 'utf8')) as {
        scenes: Array<{nodes: number[]}>
        nodes: Array<Record<string, unknown>>
        cameras?: Array<Record<string, unknown>>
    }
    scene.cameras = [{type: 'perspective', perspective: {yfov: 0.7, znear: 0.1}}]
    scene.nodes.push({name: 'Scene File Camera', camera: 0})
    scene.scenes[0].nodes.push(scene.nodes.length - 1)
    await writeFile(scenePath, `${JSON.stringify(scene, null, 2)}\n`)
    const cameraServer = await runDev({projectRoot: cameraRoot, port: 0, noOpen: true})
    try {
        await page.goto(cameraServer.url)
        await expect(page.getByText('Project loaded')).toBeVisible({timeout: 20_000})
        const summary = page.getByTestId('scene-summary')
        await expect(summary).toContainText('Scene File Camera')
        await expect(summary).not.toContainText('EditMode Perspective Camera')
    } finally {
        await cameraServer.close()
        await rm(cameraRoot, {recursive: true, force: true})
    }
})

test('reports a corrupt scene in the editor and console log', async ({page}) => {
    await page.goto(server.url)
    await expect(page.getByText('Project loaded')).toBeVisible({timeout: 20_000})
    const scenePath = 'assets/main.scene.gltf'
    const valid = await readFile(resolve(root, scenePath), 'utf8')
    await writeFile(resolve(root, scenePath), '{not gltf')

    await expect(page.getByRole('alert')).toContainText('JSON', {timeout: 10_000})
    await expect.poll(async () => (await readFile(resolve(root, '.kite3d/console.log'), 'utf8').catch(() => '')).includes('JSON')).toBe(true)

    await writeFile(resolve(root, scenePath), valid)
})

test('opens the game dialog, publishes, updates, and claims a live game', async ({page}) => {
    test.setTimeout(90_000)
    await page.goto(server.url)
    await expect(page.getByText('Project loaded')).toBeVisible({timeout: 20_000})
    await page.getByTestId('open-game').click()
    await expect(page.getByRole('dialog', {name: 'Open game'})).toBeVisible()
    const slugInput = page.locator('#publish-slug')
    const slug = await slugInput.inputValue()
    await expect(page.getByText('Available', {exact: true})).toBeVisible()

    const popupPromise = page.waitForEvent('popup')
    const initialResponse = page.waitForResponse((response) =>
        response.url().endsWith('/api/publish') && response.request().method() === 'POST')
    await page.getByTestId('create-live-game').click()
    const popup = await popupPromise
    const initialPublish = await initialResponse
    expect(initialPublish.status()).toBe(200)
    await expect(page.getByTestId('live-url')).toHaveAttribute('href', `${backend.url}/preview/${slug}/`, {timeout: 20_000})
    await expect.poll(() => backend.releaseCount(slug)).toBe(1)
    await expect(popup).toHaveURL(`${backend.url}/preview/${slug}/`)
    await expect.poll(async () => JSON.parse(await readFile(resolve(root, '.kite3d/state.json'), 'utf8')).dirty).toBe(false)
    const updateResponse = page.waitForResponse((response) =>
        response.url().endsWith('/api/publish') && response.request().method() === 'POST')
    await page.getByTestId('publish-update').click()
    const response = await updateResponse
    expect(response.status()).toBe(200)
    await expect.poll(() => backend.releaseCount(slug), {timeout: 20_000}).toBe(2)
    await expect(page.getByTestId('publish-update')).toBeEnabled()
    await expect(page.getByRole('dialog', {name: 'Open game'})).not.toContainText('Publishing could not finish')
    await page.locator('#claim-email').fill('editor@example.com')
    await page.locator('#claim-password').fill('password123')
    await page.getByTestId('claim-game').click()
    await expect(page.getByTestId('claimed-notice')).toContainText('does not expire')
    expect(backend.games.get(slug)?.claimed).toBe(true)
})

test('signs in with GIS and claims through the documented Google backend route', async ({page}) => {
    test.setTimeout(90_000)
    const fixture = await startPublishEditor()
    await page.unroute(googleScriptUrl)
    await page.route(googleScriptUrl, async (route) => {
        await route.fulfill({
            contentType: 'text/javascript',
            body: `
document.cookie = 'g_csrf_token=gis-csrf; Path=/'
let credentialCallback
window.google = {accounts: {id: {
  initialize(config) {
    window.__googleClientId = config.client_id
    credentialCallback = config.callback
  },
  renderButton(parent) {
    const button = document.createElement('button')
    button.textContent = 'Continue with Google'
    button.addEventListener('click', () => credentialCallback({credential: 'gis-credential', select_by: 'btn'}))
    parent.replaceChildren(button)
  },
  prompt(listener) {
    listener({isNotDisplayed: () => true, getNotDisplayedReason: () => 'unregistered_origin'})
  },
}}}
`,
        })
    })
    try {
        await page.goto(fixture.server.url)
        await expect(page.getByText('Project loaded')).toBeVisible({timeout: 20_000})
        await page.getByTestId('open-game').click()
        await expect(page.getByText('Available', {exact: true})).toBeVisible()
        const slug = await page.locator('#publish-slug').inputValue()
        const popupPromise = page.waitForEvent('popup')
        await page.getByTestId('create-live-game').click()
        const popup = await popupPromise
        await expect(page.getByTestId('live-url')).toBeVisible({timeout: 30_000})

        await expect(page.getByTestId('google-origin-error')).toContainText(
            `Add the editor origin ${new URL(fixture.server.url).origin}`,
        )
        expect(await page.evaluate(() => (window as unknown as {__googleClientId: string}).__googleClientId))
            .toBe('118090436804-rqddo4q5qof92bejmslrrtglnrtb23k1.apps.googleusercontent.com')
        await page.getByTestId('google-sign-in').getByRole('button', {name: 'Continue with Google'}).click()
        await expect(page.getByTestId('claimed-notice')).toContainText('does not expire')
        expect(fixture.backend.games.get(slug)?.claimed).toBe(true)

        const googleRequest = fixture.backend.requests.find(({path}) => path.endsWith('/google-login'))!
        expect(Object.fromEntries(new URLSearchParams((googleRequest.body as Buffer).toString('utf8')))).toEqual({
            credential: 'gis-credential',
            g_csrf_token: 'gis-csrf',
            select_by: 'btn',
        })
        expect(googleRequest.cookie).toBe('g_csrf_token=gis-csrf')
        expect(fixture.backend.requests.findLast(({path}) => path.endsWith('/claim'))?.authorization)
            .toBe('Bearer jwt-google')
        await popup.close()
    } finally {
        await page.close()
        await fixture.close()
    }
})

test('shows the exact editor origin when the GIS button flow returns 403 without a credential', async ({page}) => {
    test.setTimeout(90_000)
    const fixture = await startPublishEditor()
    await page.unroute(googleScriptUrl)
    await page.route('https://accounts.google.com/gsi/button**', async (route) => {
        await route.fulfill({status: 403, contentType: 'text/html', body: 'Forbidden'})
    })
    await page.route(googleScriptUrl, async (route) => {
        await route.fulfill({
            contentType: 'text/javascript',
            body: `
window.google = {accounts: {id: {
  initialize() {},
  renderButton(parent, options) {
    const button = document.createElement('button')
    button.textContent = 'Continue with Google'
    button.addEventListener('click', options.click_listener)
    const iframe = document.createElement('iframe')
    iframe.hidden = true
    iframe.src = 'https://accounts.google.com/gsi/button?client_id=blocked'
    parent.replaceChildren(button, iframe)
  },
  prompt() {},
}}}
`,
        })
    })
    try {
        const buttonFailure = page.waitForResponse((response) =>
            response.url().startsWith('https://accounts.google.com/gsi/button'))
        await page.goto(fixture.server.url)
        await expect(page.getByText('Project loaded')).toBeVisible({timeout: 20_000})
        await page.getByTestId('open-game').click()
        await expect(page.getByText('Available', {exact: true})).toBeVisible()
        const popupPromise = page.waitForEvent('popup')
        await page.getByTestId('create-live-game').click()
        const popup = await popupPromise
        await expect(page.getByTestId('live-url')).toBeVisible({timeout: 30_000})
        expect((await buttonFailure).status()).toBe(403)

        await page.getByTestId('google-sign-in').getByRole('button', {name: 'Continue with Google'}).click()
        const origin = new URL(fixture.server.url).origin
        await expect(page.getByTestId('google-origin-error')).toHaveText(
            `Add the editor origin ${origin} to the Google OAuth client's authorized JavaScript origins. `
            + 'Listing http://localhost does not cover every port; each editor origin, including its port, must be listed separately.',
            {timeout: 10_000},
        )
        await popup.close()
    } finally {
        await page.close()
        await fixture.close()
    }
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
        const dialog = page.getByRole('dialog', {name: 'Open game'})
        await expect(dialog).toBeVisible()
        await expect(page.getByText('Available', {exact: true})).toBeVisible()
        await expect(page.getByTestId('create-live-game')).toBeEnabled()
        const failedPublish = page.waitForResponse((response) =>
            response.url().endsWith('/api/publish') && response.request().method() === 'POST')
        await page.getByTestId('create-live-game').click()
        expect((await failedPublish).status()).toBe(200)

        await expect(page.getByText('Publishing is temporarily unavailable. Try again in a minute.')).toBeVisible({timeout: 20_000})
        await expect(page.getByRole('link', {name: 'Open the live game'})).toBeVisible()
        await expect(dialog.getByRole('button', {name: 'Retry'})).toBeEnabled()
        expect(releaseStatuses).toHaveLength(0)
        await page.reload()
        await expect(page.getByText('Project loaded')).toBeVisible({timeout: 20_000})
        await page.getByTestId('open-game').click()
        await expect(dialog).toBeVisible()
        await expect(page.getByText('Publishing is temporarily unavailable. Try again in a minute.')).toBeVisible()
        await expect(page.getByText('Your game is live')).toHaveCount(0)
        const retry = dialog.getByRole('button', {name: 'Retry'})
        await expect(retry).toBeEnabled()
        const successfulRetry = page.waitForResponse((response) =>
            response.url().endsWith('/api/publish') && response.request().method() === 'POST')
        await retry.click()
        expect((await successfulRetry).status()).toBe(200)
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

async function startPublishEditor(
    options: Parameters<typeof startMockBackend>[0] = {},
    prepareProject?: (projectRoot: string) => Promise<void>,
) {
    const projectRoot = await mkdtemp(resolve(tmpdir(), 'kite3d-editor-publish-'))
    await initProject(projectRoot)
    await prepareProject?.(projectRoot)
    const engineRoot = fileURLToPath(new URL('../../../engine/', import.meta.url))
    const installedEngine = resolve(projectRoot, 'node_modules/@kite3d/engine')
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
            try {
                await closeFixtureSteps([
                    {name: 'publish editor dev server', close: () => devServer.close()},
                    {name: 'publish editor mock backend', close: () => mockBackend.close()},
                ])
            } finally {
                await rm(projectRoot, {recursive: true, force: true})
            }
        },
    }
}

async function manifestHash(path: string): Promise<string | undefined> {
    const response = await fetch(`http://127.0.0.1:${server.port}/api/files`, {headers: {'X-Kite3D-Token': server.token}})
    const manifest = await response.json() as Array<{path: string, sha256: string}>
    return manifest.find((entry) => entry.path === path)?.sha256
}

async function readGeneratorState(nodeName: string): Promise<{module: string, params: Record<string, unknown>}> {
    const scene = JSON.parse(await readFile(resolve(root, 'assets/main.scene.gltf'), 'utf8')) as {
        nodes: Array<{name?: string, extras?: {EntityComponentPlugin?: Record<string, {
            type?: string
            state?: {module?: string, params?: Record<string, unknown>}
        }>}}>
    }
    const components = scene.nodes.find(({name}) => name === nodeName)?.extras?.EntityComponentPlugin || {}
    const state = Object.values(components).find(({type}) => type === 'Generator')?.state
    if (!state || typeof state.module !== 'string' || !state.params) throw new Error(`Generator state not found: ${nodeName}`)
    return {module: state.module, params: state.params}
}

function generatorModule(prefix: string, extra: number, detailLabel = 'Shading'): string {
    return `
export const params = {
    detail: {
        label: '${detailLabel}',
        help: 'Full builds textured materials. Light is a fast preview.',
        options: [{value: 'light', label: 'Fast preview'}, {value: 'full', label: 'Full shaders'}],
        default: 'light',
    },
    markers: {label: 'Spawn markers', type: 'boolean', default: true},
    count: {label: 'Tree count', type: 'integer', default: 2, min: 1, max: 5, step: 1},
    height: {label: 'Tree height', type: 'number', default: 3, min: 1, max: 10},
}

export default function generate({node, params, engine}) {
    window.__generatorRuns = (window.__generatorRuns || 0) + 1
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

function minimalTriangleGlb(nodeName: string): Buffer {
    const document = Buffer.from(JSON.stringify({
        asset: {version: '2.0'},
        scene: 0,
        scenes: [{nodes: [0]}],
        nodes: [{name: nodeName, mesh: 0}],
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
        buffers: [{byteLength: 36}],
    }))
    const jsonPadding = Buffer.alloc((4 - document.byteLength % 4) % 4, 0x20)
    const binary = Buffer.alloc(36)
    new Float32Array(binary.buffer, binary.byteOffset, 9).set([0, 0, 0, 1, 0, 0, 0, 1, 0])
    const output = Buffer.alloc(12 + 8 + document.byteLength + jsonPadding.byteLength + 8 + binary.byteLength)
    output.writeUInt32LE(0x46546c67, 0)
    output.writeUInt32LE(2, 4)
    output.writeUInt32LE(output.byteLength, 8)
    output.writeUInt32LE(document.byteLength + jsonPadding.byteLength, 12)
    output.writeUInt32LE(0x4e4f534a, 16)
    document.copy(output, 20)
    jsonPadding.copy(output, 20 + document.byteLength)
    const binaryHeader = 20 + document.byteLength + jsonPadding.byteLength
    output.writeUInt32LE(binary.byteLength, binaryHeader)
    output.writeUInt32LE(0x004e4942, binaryHeader + 4)
    binary.copy(output, binaryHeader + 8)
    return output
}

function texturedTriangleGltf(): string {
    return JSON.stringify({
        asset: {version: '2.0'},
        scene: 0,
        scenes: [{nodes: [0]}],
        nodes: [{name: 'Textured Triangle', mesh: 0}],
        meshes: [{primitives: [{attributes: {POSITION: 0, TEXCOORD_0: 1}, material: 0}]}],
        accessors: [{
            bufferView: 0,
            componentType: 5126,
            count: 3,
            type: 'VEC3',
            min: [0, 0, 0],
            max: [1, 1, 0],
        }, {
            bufferView: 1,
            componentType: 5126,
            count: 3,
            type: 'VEC2',
            min: [0, 0],
            max: [1, 1],
        }],
        bufferViews: [
            {buffer: 0, byteOffset: 0, byteLength: 36, target: 34962},
            {buffer: 0, byteOffset: 36, byteLength: 24, target: 34962},
        ],
        buffers: [{byteLength: 60, uri: 'mesh.bin'}],
        images: [{mimeType: 'image/png', uri: 'textures/pixel.png'}],
        samplers: [{}],
        textures: [{sampler: 0, source: 0}],
        materials: [{pbrMetallicRoughness: {baseColorTexture: {index: 0}}}],
    })
}

async function routeMockLibrary(page: import('@playwright/test').Page) {
    const modelUrl = 'https://library.example.test/assets/mock-textured/mock-textured.gltf'
    const textureUrl = 'https://library.example.test/assets/mock-normal/mock-normal.png'
    const environmentUrl = 'https://library.example.test/assets/mock-studio/mock-studio.hdr'
    const materialUrl = 'https://library.example.test/assets/mock-red/mock-red.pmat'
    const binary = texturedTriangleBuffer()
    const texture = await readFile(fileURLToPath(new URL('../../public/favicon-96x96.png', import.meta.url)))
    const material = JSON.stringify({
        metadata: {version: 4.6, type: 'Material', generator: 'Material.toJSON'},
        uuid: '29374416-538f-43ae-9829-e65d536f46d9',
        type: 'MeshStandardMaterial',
        name: 'Mock Red Material',
        color: 0xcc3344,
        roughness: 0.35,
        metalness: 0.1,
    })
    const hdrScanline = Buffer.from([
        2, 2, 0, 16,
        144, 128,
        144, 128,
        144, 128,
        144, 129,
    ])
    const environment = Buffer.concat([
        Buffer.from('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 8 +X 16\n', 'ascii'),
        ...Array.from({length: 8}, () => hdrScanline),
    ])

    await page.route('https://blitz-asset-library-proxy.blitzapp.workers.dev/assets/v1/list', async (route) => {
        const thumbnailUrl = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>'
        await route.fulfill({json: {assets: [
            {id: '@mock/mock-textured', name: 'Mock Textured Triangle', type: 'model', fileUrl: modelUrl, thumbnailUrl},
            {id: '@mock/mock-red', name: 'Mock Red Material', type: 'material', fileUrl: materialUrl, thumbnailUrl},
            {id: '@mock/mock-studio', name: 'Mock Studio HDR', type: 'hdri', fileUrl: environmentUrl, thumbnailUrl},
            {id: '@mock/mock-normal', name: 'Mock Normal Texture', type: 'texture', fileUrl: textureUrl, thumbnailUrl},
        ]}})
    })
    await page.route('https://library.example.test/**', async (route) => {
        const path = new URL(route.request().url()).pathname
        if (path.endsWith('/mock-textured.gltf')) {
            await route.fulfill({status: 200, contentType: 'model/gltf+json', body: texturedTriangleGltf()})
        } else if (path.endsWith('/mesh.bin')) {
            await route.fulfill({status: 200, contentType: 'application/octet-stream', body: binary})
        } else if (path.endsWith('/textures/pixel.png') || path.endsWith('/mock-normal.png')) {
            await route.fulfill({status: 200, contentType: 'image/png', body: texture})
        } else if (path.endsWith('/mock-studio.hdr')) {
            await route.fulfill({status: 200, contentType: 'image/vnd.radiance', body: environment})
        } else if (path.endsWith('/mock-red.pmat')) {
            await route.fulfill({status: 200, contentType: 'application/json', body: material})
        } else {
            await route.fulfill({status: 404, body: 'Not found'})
        }
    })

    return {modelUrl, textureUrl, environmentUrl, materialUrl, binary, texture}
}

function libraryDropSceneGltf(): string {
    return JSON.stringify({
        asset: {version: '2.0'},
        scene: 0,
        scenes: [{name: 'Main Scene', nodes: [0]}],
        nodes: [{name: 'Drop Target Group', children: [1]}, {name: 'Texture Target', mesh: 0}],
        meshes: [{primitives: [{attributes: {POSITION: 0}, material: 0}]}],
        materials: [{name: 'Target Material', pbrMetallicRoughness: {baseColorFactor: [0.2, 0.4, 0.8, 1]}}],
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

function texturedTriangleBuffer(): Buffer {
    const values = [
        0, 0, 0,
        1, 0, 0,
        0, 1, 0,
        0, 0,
        1, 0,
        0, 1,
    ]
    const buffer = Buffer.alloc(values.length * 4)
    values.forEach((value, index) => buffer.writeFloatLE(value, index * 4))
    return buffer
}

async function texturedObjectState(page: import('@playwright/test').Page) {
    return page.evaluate(() => {
        const modelRoot = (window as unknown as {viewer: {scene: {modelRoot: {
            getObjectByName(name: string): {traverse(callback: (object: {
                isMesh?: boolean
                geometry?: {attributes?: {position?: {count?: number}}}
                material?: {map?: {image?: {width?: number}}}
            }) => void): void
        } | undefined}}}}).viewer.scene.modelRoot
        const wrapper = modelRoot.getObjectByName('Mock Textured Triangle')
        let meshCount = 0
        let positionCount = 0
        let textureWidth = 0
        wrapper?.traverse((object) => {
            if (!object.isMesh) return
            meshCount += 1
            positionCount += object.geometry?.attributes?.position?.count || 0
            textureWidth = object.material?.map?.image?.width || textureWidth
        })
        return {meshCount, positionCount, textureWidth}
    })
}
