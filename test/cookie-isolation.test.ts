import {createRequire} from 'node:module'
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {createDevServer, type DevServer} from '../src/server.ts'
import {KITE3D_VERSION} from '../src/versions.ts'

interface BrowserHandle {
    newContext(): Promise<BrowserContextHandle>
    close(): Promise<void>
}

interface BrowserContextHandle {
    newPage(): Promise<PageHandle>
    cookies(): Promise<Array<{name: string}>>
}

interface PageHandle {
    goto(url: string, options: NavigationOptions): Promise<unknown>
    reload(options: NavigationOptions): Promise<unknown>
    waitForFunction(expression: string, argument: undefined, options: {timeout: number}): Promise<unknown>
    waitForResponse(
        predicate: (response: ResponseHandle) => boolean,
        options: {timeout: number},
    ): Promise<ResponseHandle>
    on(event: 'response', listener: (response: ResponseHandle) => void): void
}

interface ResponseHandle {
    status(): number
    url(): string
}

interface NavigationOptions {
    waitUntil: 'domcontentloaded'
    timeout: number
}

const testRequire = createRequire(import.meta.url)
const cleanup: Array<() => Promise<void>> = []
const navigationOptions: NavigationOptions = {waitUntil: 'domcontentloaded', timeout: 30_000}

afterEach(async () => {
    while (cleanup.length) await cleanup.pop()!()
})

describe('editor token cookie isolation', () => {
    // Guards the owner's report: a second editor on the same host caused 401 responses in the first editor.
    it('loads editor A scene after editor B opens, then reloads A without 401s', async () => {
        const rootA = await temporaryProject('cookie-editor-a')
        const rootB = await temporaryProject('cookie-editor-b')
        const serverA = await startServer(rootA)
        const serverB = await startServer(rootB)
        const chromium = (testRequire('playwright') as {
            chromium: {launch(options: {headless: boolean}): Promise<BrowserHandle>}
        }).chromium
        const browser = await chromium.launch({headless: true})
        cleanup.push(() => browser.close())
        const context = await browser.newContext()
        const unauthorized: string[] = []

        const pageA = await context.newPage()
        pageA.on('response', (response) => {
            if (response.status() === 401 && response.url().startsWith(origin(serverA))) {
                unauthorized.push(new URL(response.url()).pathname)
            }
        })
        await pageA.goto(serverA.url, navigationOptions)
        await waitForProjectLoaded(pageA)

        const pageB = await context.newPage()
        await pageB.goto(serverB.url, navigationOptions)
        await waitForProjectLoaded(pageB)
        expect((await context.cookies()).map(({name}) => name)).toEqual(expect.arrayContaining([
            `kite3d-token-${serverA.port}`,
            `kite3d-token-${serverB.port}`,
        ]))

        const sceneReload = pageA.waitForResponse((response) => {
            const url = new URL(response.url())
            return url.origin === origin(serverA)
                && url.pathname === '/files/assets/main.scene.gltf'
                && url.searchParams.has('v')
        }, {timeout: 10_000})
        await writeScene(rootA, true)
        expect((await sceneReload).status()).toBe(200)

        const sceneAfterPageReload = pageA.waitForResponse((response) => {
            const url = new URL(response.url())
            return url.origin === origin(serverA)
                && url.pathname === '/files/assets/main.scene.gltf'
                && url.searchParams.has('v')
        }, {timeout: 10_000})
        await pageA.reload(navigationOptions)
        expect((await sceneAfterPageReload).status()).toBe(200)
        await waitForProjectLoaded(pageA)
        expect(unauthorized).toEqual([])
    })
})

async function temporaryProject(name: string): Promise<string> {
    const root = await mkdtemp(resolve(tmpdir(), `${name}-`))
    cleanup.push(() => rm(root, {recursive: true, force: true}))
    await mkdir(resolve(root, 'assets'), {recursive: true})
    await writeFile(resolve(root, 'package.json'), `${JSON.stringify({
        name,
        private: true,
        type: 'module',
        main: './main.js',
        mainScene: 'assets/main.scene.gltf',
        devDependencies: {kite3d: KITE3D_VERSION},
        kite3d: {version: KITE3D_VERSION},
    })}\n`)
    await writeFile(resolve(root, 'assets.json'), '{"files":{},"version":1}\n')
    await writeFile(resolve(root, 'main.js'), 'export async function main({viewer}) { window.viewer = viewer }\n')
    await writeScene(root, false)
    return root
}

async function startServer(projectRoot: string): Promise<DevServer> {
    const server = await createDevServer({projectRoot, port: 0, strictPort: true})
    cleanup.push(() => server.close())
    return server
}

async function writeScene(root: string, reloaded: boolean): Promise<void> {
    await writeFile(resolve(root, 'assets/main.scene.gltf'), `${JSON.stringify({
        asset: {version: '2.0'},
        scene: 0,
        scenes: [{nodes: reloaded ? [0] : []}],
        nodes: reloaded ? [{name: 'Reloaded scene'}] : [],
    })}\n`)
}

function waitForProjectLoaded(page: PageHandle): Promise<unknown> {
    return page.waitForFunction(
        'window.kite3dProjectLoaded === true',
        undefined,
        {timeout: 30_000},
    )
}

function origin(server: DevServer): string {
    return new URL(server.url).origin
}
