import {expect, test} from '@playwright/test'
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import {initProject, runDev} from '../../../blitz/src/commands.ts'
import type {DevServer} from '../../../blitz/src/server.ts'

let root: string
let server: DevServer

test.beforeAll(async () => {
    root = await mkdtemp(resolve(tmpdir(), 'blitz-editor-e2e-'))
    await initProject(root)
    await writeFile(resolve(root, 'main.js'), `export async function main(){ window.__blitzMainRan = true }\n`)
    server = await runDev({projectRoot: root, port: 0, noOpen: true})
})

test.afterAll(async () => {
    await server.close()
    await rm(root, {recursive: true, force: true})
})

test('loads, watches scripts, saves the scene without echo reload, and plays main.js', async ({page}) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(server.url)
    await expect(page.getByRole('heading', {name: 'blitz-editor-e2e-'})).toBeVisible()
    await expect(page.getByText('Project loaded')).toBeVisible()

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
    await page.getByTestId('save-scene').click()
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

    await page.getByTestId('save-scene').click()
    await expect.poll(() => readFile(resolve(root, packageJson.mainScene), 'utf8')).toBe(savedScene)

    await page.reload()
    await expect(page.getByText('Project loaded')).toBeVisible()
    await expect(page.getByTestId('scene-objects')).toContainText('RoundTripObject')

    await page.getByTestId('play').click()
    await expect(page.getByText('Playing')).toBeVisible({timeout: 20_000})
    await expect.poll(() => page.evaluate(() => Boolean((window as unknown as {__blitzMainRan?: boolean}).__blitzMainRan))).toBe(true)
    await expect(page.getByTestId('scene-hierarchy')).toContainText('Tree 0 generated')
    await expect(page.getByTestId('scene-hierarchy')).toContainText('Tree 1 generated')
    expect(await readFile(resolve(root, packageJson.mainScene), 'utf8')).not.toContain('Tree 0')

    await page.getByTestId('generator-params-0').fill('{"count": 3}')
    await page.getByTestId('generator-params-0').blur()
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

    await writeFile(resolve(root, 'Live.script.js'), `
import {Object3DComponent} from 'threepipe'
export class UpdatedComponent extends Object3DComponent { static ComponentType = 'UpdatedComponent' }
`)
    await expect(page.getByTestId('component-types')).toContainText('UpdatedComponent', {timeout: 15_000})
    await expect.poll(async () => Boolean(await readFile(resolve(root, '.blitz/state.json'), 'utf8'))).toBe(true)
    expect(errors).toEqual([])
})

test('reports a corrupt scene in the editor and console log', async ({page}) => {
    await page.goto(server.url)
    await expect(page.getByText('Project loaded')).toBeVisible()
    const scenePath = 'assets/main.scene.gltf'
    const valid = await readFile(resolve(root, scenePath), 'utf8')
    await writeFile(resolve(root, scenePath), '{not gltf')

    await expect(page.getByRole('alert')).toContainText('JSON', {timeout: 10_000})
    await expect.poll(async () => (await readFile(resolve(root, '.blitz/console.log'), 'utf8')).includes('JSON')).toBe(true)

    await writeFile(resolve(root, scenePath), valid)
})

async function manifestHash(path: string): Promise<string | undefined> {
    const response = await fetch(`http://127.0.0.1:${server.port}/api/files`, {headers: {'X-Blitz-Token': server.token}})
    const manifest = await response.json() as Array<{path: string, sha256: string}>
    return manifest.find((entry) => entry.path === path)?.sha256
}
