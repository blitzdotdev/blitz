import {createRequire} from 'node:module'
import {resolve} from 'node:path'
import {saveScreenshotPng, screenshotName, type SavedScreenshot} from './screenshotFile.ts'
import {createDevServer, type DevServer} from './server.ts'
import {readRunningServer, serverStatePath} from './serverState.ts'

export interface ScreenshotOptions {
    name?: string
    headless?: boolean
    full?: boolean
    width?: number
    height?: number
}

export interface ScreenshotResult extends SavedScreenshot {
    source: 'editor' | 'headless'
}

export interface DevConnection {
    url: string
    token: string
}

interface BrowserLauncher {
    launch(options: {headless: boolean}): Promise<BrowserHandle>
}

interface BrowserHandle {
    newPage(options?: {viewport?: {width: number, height: number}}): Promise<PageHandle>
    close(): Promise<void>
}

interface PageHandle {
    goto(url: string, options: {waitUntil: 'domcontentloaded', timeout: number}): Promise<unknown>
    waitForFunction(expression: string, argument?: undefined, options?: {timeout: number}): Promise<unknown>
    locator(selector: string): {
        first(): {screenshot(options: {type: 'png'}): Promise<Uint8Array>}
    }
    screenshot(options: {type: 'png'}): Promise<Uint8Array>
}

const screenshotRequire = createRequire(import.meta.url)
const PLAYWRIGHT_INSTALL_HINT = 'Run npx playwright install chromium.'

export async function screenshotProject(
    projectRoot = process.cwd(),
    options: ScreenshotOptions = {},
): Promise<ScreenshotResult> {
    const root = resolve(projectRoot)
    const width = screenshotDimension(options.width, '--width', 1280)
    const height = screenshotDimension(options.height, '--height', 720)
    const name = screenshotName(options.name)

    // An open editor tab knows what the user is looking at, Play included; a headless page does not.
    // --headless, --full and a chosen size all ask for something only a page of our own can give.
    const sized = options.width !== undefined || options.height !== undefined
    if (!options.headless && !options.full && !sized) {
        const connection = await readRunningServer(serverStatePath(root))
        const result = connection && await requestEditorScreenshot(connection, name)
        if (result) return result
    }

    let chromium: BrowserLauncher
    try {
        chromium = (screenshotRequire('playwright') as {chromium: BrowserLauncher}).chromium
    } catch {
        throw new Error(`Playwright is not installed. ${PLAYWRIGHT_INSTALL_HINT}`)
    }

    let server: DevServer | undefined
    let browser: BrowserHandle | undefined
    try {
        server = await createDevServer({projectRoot: root, port: 0, strictPort: true})
        try {
            browser = await chromium.launch({headless: true})
        } catch (error) {
            if (browserIsMissing(error)) {
                throw new Error(`No Playwright browser is installed. ${PLAYWRIGHT_INSTALL_HINT}`)
            }
            throw error
        }
        const page = await browser.newPage({viewport: {width, height}})
        const url = new URL(server.url)
        url.searchParams.set('headless', 'screenshot')
        await page.goto(url.href, {waitUntil: 'domcontentloaded', timeout: 30_000})
        await page.waitForFunction(
            'window.kite3dProjectLoaded === true',
            undefined,
            {timeout: 30_000},
        )
        await page.waitForFunction(
            "Boolean(document.querySelector('.editorCanvasContainer canvas')?.clientWidth)",
            undefined,
            {timeout: 10_000},
        )
        const bytes = options.full
            ? await page.screenshot({type: 'png'})
            : await page.locator('.editorCanvasContainer canvas').first().screenshot({type: 'png'})
        const saved = await saveScreenshotPng(root, bytes, name)
        return {...saved, source: 'headless'}
    } finally {
        await browser?.close().catch(() => undefined)
        await server?.close().catch(() => undefined)
    }
}

/**
 * Asks the connected editor for its viewport. The server saves the PNG the editor posts back and
 * answers with the file it wrote. Undefined means no editor answered, so the headless path runs.
 */
async function requestEditorScreenshot(
    connection: DevConnection,
    name: string,
): Promise<ScreenshotResult | undefined> {
    let response: Response
    try {
        response = await fetch(new URL('/api/screenshot', connection.url), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Kite3D-Token': connection.token,
                'X-Kite3D-Client': 'kite3d-screenshot',
            },
            body: JSON.stringify({name}),
            signal: AbortSignal.timeout(12_000),
        })
    } catch {
        return undefined
    }
    const body = await response.json().catch(() => ({})) as {
        error?: {code?: string, message?: string}
        path?: unknown
        width?: unknown
        height?: unknown
        source?: unknown
        capturedAt?: unknown
    }
    if (response.status === 404 || response.status === 409 && body.error?.code === 'editor_not_connected') {
        return undefined
    }
    // An editor that is there but cannot answer is reported, not quietly replaced by a headless page
    // showing a different view of the project.
    if (!response.ok) throw new Error(body.error?.message || `Screenshot failed with status ${response.status}.`)
    if (typeof body.path !== 'string' || typeof body.width !== 'number' || typeof body.height !== 'number'
        || body.source !== 'editor' || typeof body.capturedAt !== 'string') {
        throw new Error('The editor returned an invalid screenshot result.')
    }
    return {
        path: body.path,
        width: body.width,
        height: body.height,
        source: body.source,
        capturedAt: body.capturedAt,
    }
}

function screenshotDimension(value: number | undefined, option: string, fallback: number): number {
    if (value === undefined) return fallback
    if (!Number.isInteger(value) || value < 1) throw new Error(`${option} must be a positive integer.`)
    return value
}

function browserIsMissing(error: unknown): boolean {
    return /executable.*(does not exist|doesn't exist|missing)|browser.*not found|playwright install/i.test(errorMessage(error))
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}
