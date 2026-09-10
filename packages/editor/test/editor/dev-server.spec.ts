import {expect, test} from '@playwright/test'
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
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
    await expect(page.getByTestId('component-types')).toContainText('LiveComponent', {timeout: 10_000})

    const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as {mainScene: string}
    expect(packageJson.mainScene).toBe('assets/main.scene.gltf')
    await expect(page.locator('label[for="scene"]')).toContainText(packageJson.mainScene)

    const before = await manifestHash(packageJson.mainScene)
    const scene = JSON.parse(await readFile(resolve(root, packageJson.mainScene), 'utf8')) as {
        scenes: Array<{nodes: number[]}>
        nodes: Array<{name?: string}>
    }
    scene.nodes.push({name: 'RoundTripObject'})
    scene.scenes[0].nodes.push(scene.nodes.length - 1)
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
    await expect(page.getByText('Scene saved')).toBeVisible()

    await page.reload()
    await expect(page.getByText('Project loaded')).toBeVisible()
    await expect(page.getByTestId('scene-objects')).toContainText('RoundTripObject')

    await page.getByTestId('play').click()
    await expect(page.getByText('Playing')).toBeVisible({timeout: 20_000})
    await expect.poll(() => page.evaluate(() => Boolean((window as unknown as {__blitzMainRan?: boolean}).__blitzMainRan))).toBe(true)

    await writeFile(resolve(root, 'Live.script.js'), `
import {Object3DComponent} from 'threepipe'
export class UpdatedComponent extends Object3DComponent { static ComponentType = 'UpdatedComponent' }
`)
    await expect(page.getByTestId('component-types')).toContainText('UpdatedComponent', {timeout: 15_000})
    await expect.poll(async () => Boolean(await readFile(resolve(root, '.blitz/state.json'), 'utf8'))).toBe(true)
    expect(errors).toEqual([])
})

async function manifestHash(path: string): Promise<string | undefined> {
    const response = await fetch(`http://127.0.0.1:${server.port}/api/files`, {headers: {'X-Blitz-Token': server.token}})
    const manifest = await response.json() as Array<{path: string, sha256: string}>
    return manifest.find((entry) => entry.path === path)?.sha256
}
