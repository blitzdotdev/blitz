import {expect, test} from '@playwright/test'
import {mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {initProject, publishFromDisk, runDev} from '../../../kite3d/src/commands.ts'
import {checkProject} from '../../../kite3d/src/check.ts'
import {createDevServer, type DevServer} from '../../../kite3d/src/server.ts'
import {startMockBackend, type MockBackend} from '../../../kite3d/test/mockBackend.ts'
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
        kite3d: {viewer?: Record<string, unknown>}
    }
    packageJson.kite3d.viewer = {
        backgroundColor: '#224466',
        camera: {position: [0, 5, 17], target: [0, 0, 0]},
    }
    await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)
    await writeFile(resolve(root, 'main.js'), 'export async function main() {}\n')
    const scenePath = resolve(root, 'assets/main.scene.gltf')
    const scene = JSON.parse(await readFile(scenePath, 'utf8')) as {
        scenes: Array<{nodes: number[]}>
        nodes: Array<Record<string, unknown>>
        [key: string]: unknown
    }
    const meshNode = scene.nodes.length
    scene.nodes.push({name: 'Check target', mesh: 0})
    scene.nodes.push({name: 'RoundTripObject', mesh: 0})
    scene.scenes[0].nodes.push(meshNode, meshNode + 1)
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

// Guards the core manual workflow: all three checks run through the connected editor.
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
            role: 'template', id: 'orphan-copy', sourceId: 'missing-template',
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

// Guards the owner's report: a dropped GLB was not registered in assets.json.
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

// Guards the owner's library drop reports: downloads failed or saved incomplete model resources.
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

async function startPublishEditor() {
    const projectRoot = await mkdtemp(resolve(tmpdir(), 'kite3d-editor-publish-'))
    await initProject(projectRoot)
    const engineRoot = fileURLToPath(new URL('../../../engine/', import.meta.url))
    const installedEngine = resolve(projectRoot, 'node_modules/@kite3d/engine')
    await mkdir(resolve(installedEngine, 'dist'), {recursive: true})
    await writeFile(resolve(installedEngine, 'package.json'), await readFile(resolve(engineRoot, 'package.json')))
    await writeFile(resolve(installedEngine, 'dist/runtime.js'), await readFile(resolve(engineRoot, 'dist/runtime.js')))
    const mockBackend = await startMockBackend()
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
    const binary = texturedTriangleBuffer()
    const texture = await readFile(fileURLToPath(new URL('../../public/favicon-96x96.png', import.meta.url)))

    await page.route('https://blitz-asset-library-proxy.blitzapp.workers.dev/assets/v1/list', async (route) => {
        const thumbnailUrl = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>'
        await route.fulfill({json: {assets: [
            {id: '@mock/mock-textured', name: 'Mock Textured Triangle', type: 'model', fileUrl: modelUrl, thumbnailUrl},
        ]}})
    })
    await page.route('https://library.example.test/**', async (route) => {
        const path = new URL(route.request().url()).pathname
        if (path.endsWith('/mock-textured.gltf')) {
            await route.fulfill({status: 200, contentType: 'model/gltf+json', body: texturedTriangleGltf()})
        } else if (path.endsWith('/mesh.bin')) {
            await route.fulfill({status: 200, contentType: 'application/octet-stream', body: binary})
        } else if (path.endsWith('/textures/pixel.png')) {
            await route.fulfill({status: 200, contentType: 'image/png', body: texture})
        } else {
            await route.fulfill({status: 404, body: 'Not found'})
        }
    })

    return {modelUrl, binary, texture}
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
