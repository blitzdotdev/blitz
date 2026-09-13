import {expect, test, type Page} from '@playwright/test'
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import {checkProject} from '../../../kite3d/src/check.ts'
import {initProject, runDev} from '../../../kite3d/src/commands.ts'
import {startMockBackend} from '../../../kite3d/test/mockBackend.ts'
import {closeFixtureSteps} from './fixtureClose.ts'

let root: string
let server: Awaited<ReturnType<typeof runDev>>
let backend: Awaited<ReturnType<typeof startMockBackend>>

test.beforeAll(async () => {
    root = await mkdtemp(resolve(tmpdir(), 'kite3d-hidden-objects-'))
    await initProject(root)
    const scenePath = resolve(root, 'assets/main.scene.gltf')
    const scene = JSON.parse(await readFile(scenePath, 'utf8'))
    scene.scenes[0].nodes = [0, 1, 2]
    scene.nodes = [
        {name: 'Left Wall', mesh: 0, translation: [-2, 0, 0]},
        {name: 'Hidden Wall', mesh: 0},
        {name: 'Right Wall', mesh: 0, translation: [2, 0, 0]},
    ]
    scene.buffers = [{
        byteLength: 36,
        uri: 'data:application/octet-stream;base64,AABAvwAAQL8AAAAAAABAPwAAQL8AAAAAAAAAAAAAQD8AAAAA',
    }]
    scene.bufferViews = [{buffer: 0, byteOffset: 0, byteLength: 36, target: 34962}]
    scene.accessors = [{
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [-0.75, -0.75, 0],
        max: [0.75, 0.75, 0],
    }]
    scene.meshes = [{primitives: [{attributes: {POSITION: 0}}]}]
    await writeFile(scenePath, `${JSON.stringify(scene, null, 2)}\n`)
    backend = await startMockBackend()
    server = await runDev({projectRoot: root, port: 0, noOpen: true, backendUrl: backend.url})
})

test.afterAll(async () => {
    try {
        await closeFixtureSteps([
            {name: 'hidden objects editor server', close: () => server.close()},
            {name: 'hidden objects mock backend', close: () => backend.close()},
        ])
    } finally {
        await rm(root, {recursive: true, force: true})
    }
})

// Guards the owner's report: saving deleted objects hidden in the hierarchy.
test('Save Scene keeps a hierarchy-hidden mesh across reloads', async ({page}) => {
    const scenePath = resolve(root, 'assets/main.scene.gltf')
    await page.goto(server.url)
    await expect(page.getByText('Project loaded')).toBeVisible({timeout: 20_000})
    let hiddenRow = page.getByRole('button', {name: /Hidden_Wall/})
    await hiddenRow.hover()
    await hiddenRow.locator('.kite3d-hierarchy-status .bp5-icon').click()
    await expect(hiddenRow.locator('.bp5-icon-eye-off')).toBeVisible()
    await page.getByTestId('save-scene').click()
    await expect(page.getByText('Scene saved')).toBeVisible({timeout: 20_000})

    let saved = JSON.parse(await readFile(scenePath, 'utf8')) as {
        nodes: Array<{name?: string, extensions?: {WEBGI_object3d_extras?: {visible?: boolean}}}>
    }
    const hiddenNode = saved.nodes.find((node) => node.name === 'Hidden_Wall')
    expect(hiddenNode, 'Save Scene keeps the hidden authored node').toBeDefined()
    expect(hiddenNode).toMatchObject({extensions: {WEBGI_object3d_extras: {visible: false}}})
    const check = await checkProject(root)
    expect(check.ok).toBe(true)
    expect(check.outcomes.find(({name}) => name === 'Persisted')).toMatchObject({status: 'pass', codes: []})

    await page.reload()
    await expect(page.getByText('Project loaded')).toBeVisible({timeout: 20_000})
    hiddenRow = page.getByRole('button', {name: /Hidden_Wall/})
    await hiddenRow.hover()
    await expect(hiddenRow.locator('.bp5-icon-eye-off')).toBeVisible()
    await expect.poll(() => visibleMeshCount(page)).toBe(2)

    await hiddenRow.locator('.kite3d-hierarchy-status .bp5-icon').click()
    await expect(hiddenRow.locator('.bp5-icon-eye-open')).toBeVisible()
    await page.getByTestId('save-scene').click()
    await expect(page.getByText('Scene saved')).toBeVisible({timeout: 20_000})
    saved = JSON.parse(await readFile(scenePath, 'utf8'))
    expect(saved.nodes.find((node) => node.name === 'Hidden_Wall')?.extensions)
        .not.toHaveProperty('WEBGI_object3d_extras.visible')

    await page.reload()
    await expect(page.getByText('Project loaded')).toBeVisible({timeout: 20_000})
    hiddenRow = page.getByRole('button', {name: /Hidden_Wall/})
    await hiddenRow.hover()
    await expect(hiddenRow.locator('.bp5-icon-eye-open')).toBeVisible()
    await expect.poll(() => visibleMeshCount(page)).toBe(3)
})

async function visibleMeshCount(page: Page): Promise<number> {
    return page.evaluate(() => {
        const modelRoot = (window as unknown as {viewer: {scene: {modelRoot: {
            traverse(callback: (object: {isMesh?: boolean, visible: boolean}) => void): void
        }}}}).viewer.scene.modelRoot
        let count = 0
        modelRoot.traverse((object) => {
            if (object.isMesh && object.visible) count += 1
        })
        return count
    })
}
