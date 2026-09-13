import {execFile} from 'node:child_process'
import {createRequire} from 'node:module'
import {mkdtemp, readFile, realpath, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {isAbsolute, relative, resolve} from 'node:path'
import {promisify} from 'node:util'
import {afterEach, describe, expect, it} from 'vitest'
import {initProject} from '../src/commands.ts'
import {createDevServer} from '../src/server.ts'

interface BrowserHandle {
    newPage(options: {viewport: {width: number, height: number}}): Promise<PageHandle>
    close(): Promise<void>
}

interface PageHandle {
    goto(url: string, options: {waitUntil: 'domcontentloaded', timeout: number}): Promise<unknown>
    waitForFunction(expression: string, argument: undefined, options: {timeout: number}): Promise<unknown>
    evaluate<T>(expression: string): Promise<T>
}

const execute = promisify(execFile)
const cli = resolve('dist/cli.js')
const testRequire = createRequire(import.meta.url)
const cleanup: Array<() => Promise<void>> = []
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

afterEach(async () => {
    while (cleanup.length) await cleanup.pop()!()
})

describe('kite3d screenshot', () => {
    it('captures the connected editor canvas at its pixel size, including while hidden, and prints JSON', async () => {
        const root = await temporaryProject()
        const {server, browser, page} = await openEditor(root, {width: 1200, height: 760})
        const canvasSize = await page.evaluate<{width: number, height: number}>(
            '({width: window.viewer.canvas.width, height: window.viewer.canvas.height})',
        )
        await page.evaluate("document.querySelector('.editorCanvasContainer').style.backgroundColor = '#102030'")

        const visible = await runScreenshot(root, '--name', 'connected')
        expect(visible.code, 'kite3d screenshot should exit successfully').toBe(0)
        expect(visible.stderr).toBe('')
        const visiblePath = visible.stdout.trim()
        expect(visible.stdout.trimEnd().split('\n')).toHaveLength(1)
        expect(isAbsolute(visiblePath)).toBe(true)
        const visibleBytes = await readFile(visiblePath)
        expect(pngSize(visibleBytes)).toEqual(canvasSize)
        expect(visibleBytes.byteLength).toBeGreaterThan(1_000)
        expect(await realpath(resolve(root, '.kite3d/screenshots'))).toBe(resolve(await realpath(root), '.kite3d/screenshots'))
        expect(relative(resolve(await realpath(root), '.kite3d/screenshots'), visiblePath)).toMatch(
            /^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z-connected\.png$/,
        )

        await page.evaluate("document.querySelector('.editorCanvasContainer').style.backgroundColor = '#405060'")
        const recolored = await runScreenshot(root, '--name', 'connected-recolored')
        expect(recolored.code, 'recolored editor screenshot should exit successfully').toBe(0)
        expect(recolored.stderr).toBe('')
        const recoloredBytes = await readFile(recolored.stdout.trim())
        expect(pngSize(recoloredBytes)).toEqual(canvasSize)
        expect(recoloredBytes.equals(visibleBytes)).toBe(false)

        await page.evaluate(`(() => {
            Object.defineProperty(document, 'hidden', {configurable: true, get: () => true})
            Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => 'hidden'})
            document.dispatchEvent(new Event('visibilitychange'))
        })()`)
        const hidden = await runScreenshot(root, '--name', 'hidden', '--json')
        expect(hidden.code, 'hidden editor screenshot should exit successfully').toBe(0)
        expect(hidden.stderr).toBe('')
        const result = JSON.parse(hidden.stdout) as Record<string, unknown>
        expect(Object.keys(result)).toEqual(['path', 'width', 'height', 'source', 'capturedAt'])
        expect(result).toMatchObject({...canvasSize, source: 'editor', capturedAt: expect.any(String)})
        expect(pngSize(await readFile(String(result.path)))).toEqual(canvasSize)

        expect(server.server.listening).toBe(true)
        expect(browser).toBeDefined()
    })

    it('falls back without an editor and captures the full headless editor window when requested', async () => {
        const root = await temporaryProject()

        const fallback = await runScreenshot(root, '--name', 'fallback', '--width', '800', '--height', '600', '--json')
        expect(fallback.code, 'headless fallback screenshot should exit successfully').toBe(0)
        expect(fallback.stderr).toBe('')
        const fallbackResult = JSON.parse(fallback.stdout) as Record<string, unknown>
        expect(fallbackResult).toMatchObject({source: 'headless', capturedAt: expect.any(String)})
        const fallbackSize = pngSize(await readFile(String(fallbackResult.path)))
        expect(fallbackSize.width).toBeGreaterThan(0)
        expect(fallbackSize.height).toBeGreaterThan(0)
        expect(fallbackSize.width).toBeLessThanOrEqual(800)
        expect(fallbackSize.height).toBeLessThanOrEqual(600)

        const full = await runScreenshot(
            root,
            '--headless', '--full', '--name', 'full', '--width', '900', '--height', '600', '--json',
        )
        expect(full.code, 'full headless screenshot should exit successfully').toBe(0)
        expect(full.stderr).toBe('')
        const fullResult = JSON.parse(full.stdout) as Record<string, unknown>
        expect(fullResult).toMatchObject({width: 900, height: 600, source: 'headless'})
        expect(pngSize(await readFile(String(fullResult.path)))).toEqual({width: 900, height: 600})
    })

    it('fails with recovery guidance when a connected stream client does not answer', async () => {
        const root = await temporaryProject()
        const server = await createDevServer({projectRoot: root, port: 0, strictPort: true})
        cleanup.push(() => server.close())
        const controller = new AbortController()
        const stream = await fetch(new URL('/api/events?client=silent-editor', server.url), {
            headers: {'X-Kite3D-Token': server.token},
            signal: controller.signal,
        })
        expect(stream.status).toBe(200)

        const result = await runScreenshot(root)
        controller.abort()

        expect(result.code).toBe(1)
        expect(result.stdout).toBe('')
        expect(result.stderr.trim()).toBe(
            'kite3d: The editor did not answer the screenshot request. Reload the editor tab or run kite3d screenshot --headless.',
        )
    })
})

async function temporaryProject(): Promise<string> {
    const root = await mkdtemp(resolve(tmpdir(), 'kite3d-screenshot-'))
    cleanup.push(() => rm(root, {recursive: true, force: true}))
    await initProject(root, {git: false})
    return root
}

async function openEditor(root: string, viewport: {width: number, height: number}): Promise<{
    server: Awaited<ReturnType<typeof createDevServer>>
    browser: BrowserHandle
    page: PageHandle
}> {
    const server = await createDevServer({projectRoot: root, port: 0, strictPort: true})
    cleanup.push(() => server.close())
    const chromium = (testRequire('playwright') as {
        chromium: {launch(options: {headless: boolean}): Promise<BrowserHandle>}
    }).chromium
    const browser = await chromium.launch({headless: true})
    cleanup.push(() => browser.close())
    const page = await browser.newPage({viewport})
    await page.goto(server.url, {waitUntil: 'domcontentloaded', timeout: 30_000})
    await page.waitForFunction(
        "document.querySelector('.kite3d-status-hook')?.textContent === 'Project loaded'",
        undefined,
        {timeout: 30_000},
    )
    await page.waitForFunction(
        'Boolean(window.viewer?.canvas?.width && window.viewer?.canvas?.height)',
        undefined,
        {timeout: 10_000},
    )
    return {server, browser, page}
}

async function runScreenshot(root: string, ...args: string[]): Promise<{
    code: number
    stdout: string
    stderr: string
}> {
    try {
        const result = await execute(process.execPath, [cli, 'screenshot', ...args], {cwd: root, timeout: 35_000})
        return {code: 0, stdout: result.stdout, stderr: result.stderr}
    } catch (error) {
        return error as {code: number, stdout: string, stderr: string}
    }
}

function pngSize(bytes: Uint8Array): {width: number, height: number} {
    expect(Buffer.from(bytes.subarray(0, 8))).toEqual(pngSignature)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    return {width: view.getUint32(16), height: view.getUint32(20)}
}
