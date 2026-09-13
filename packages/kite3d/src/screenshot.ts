import {createRequire} from 'node:module'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import type {DevServer} from './server.ts'

export interface ScreenshotOptions {
    name?: string
    headless?: boolean
    full?: boolean
    width?: number
    height?: number
}

export interface ScreenshotResult {
    path: string
    width: number
    height: number
    source: 'editor' | 'headless'
    capturedAt: string
}

export interface DevConnection {
    url: string
    token: string
}

export class HeadlessBrowserUnavailableError extends Error {
    readonly name = 'HeadlessBrowserUnavailableError'
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
    evaluate(expression: string): Promise<unknown>
    locator(selector: string): {
        first(): {screenshot(options: {type: 'png'}): Promise<Uint8Array>}
    }
    screenshot(options: {type: 'png'}): Promise<Uint8Array>
}

const screenshotRequire = createRequire(import.meta.url)
const PLAYWRIGHT_INSTALL_HINT = 'Run npx playwright install chromium.'
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const MAX_SCREENSHOT_BYTES = 50 * 1024 * 1024

export async function screenshotProject(
    projectRoot = process.cwd(),
    options: ScreenshotOptions = {},
): Promise<ScreenshotResult> {
    const root = resolve(projectRoot)
    const width = screenshotDimension(options.width, '--width', 1280)
    const height = screenshotDimension(options.height, '--height', 720)
    const name = screenshotName(options.name)
    const connection = await runningDevConnection(root)

    if (!options.headless && !options.full && connection) {
        const result = await requestEditorScreenshot(connection, {name, width, height})
        if (result) return result
    }

    return runWithHeadlessChromium(root, {connection}, async (browser, activeConnection) => {
        const page = await browser.newPage({viewport: {width, height}})
        const url = new URL(activeConnection.url)
        url.searchParams.set('headless', 'screenshot')
        await page.goto(url.href, {waitUntil: 'domcontentloaded', timeout: 30_000})
        await page.waitForFunction(
            "document.querySelector('.kite3d-status-hook')?.textContent === 'Project loaded'",
            undefined,
            {timeout: 30_000},
        )
        await page.waitForFunction(
            "Boolean(document.querySelector('.editor-canvas-mount canvas:not(.game-canvas-overlay)')?.clientWidth)",
            undefined,
            {timeout: 10_000},
        )
        const bytes = options.full
            ? await page.screenshot({type: 'png'})
            : await page.locator('.editor-canvas-mount canvas:not(.game-canvas-overlay)').first().screenshot({type: 'png'})
        const saved = await saveScreenshotPng(root, bytes, name)
        return {...saved, source: 'headless'}
    })
}

export async function runningDevConnection(root: string): Promise<DevConnection | undefined> {
    let value: {url?: unknown, token?: unknown}
    try {
        value = JSON.parse(await readFile(resolve(root, '.kite3d/dev.json'), 'utf8')) as typeof value
    } catch {
        return undefined
    }
    if (typeof value.url !== 'string' || typeof value.token !== 'string') return undefined
    try {
        const response = await fetch(new URL('/api/state', value.url), {
            headers: {'X-Kite3D-Token': value.token},
            signal: AbortSignal.timeout(1_500),
        })
        if (!response.ok) return undefined
    } catch {
        return undefined
    }
    return {url: value.url, token: value.token}
}

export async function runWithHeadlessChromium<T>(
    root: string,
    options: {connection?: DevConnection},
    operation: (browser: BrowserHandle, connection: DevConnection) => Promise<T>,
): Promise<T> {
    let chromium: BrowserLauncher
    try {
        chromium = (screenshotRequire('playwright') as {chromium: BrowserLauncher}).chromium
    } catch {
        throw new HeadlessBrowserUnavailableError(`Playwright is not installed. ${PLAYWRIGHT_INSTALL_HINT}`)
    }

    let server: DevServer | undefined
    let browser: BrowserHandle | undefined
    const devPath = resolve(root, '.kite3d/dev.json')
    const previousDevFile = options.connection ? undefined : await readFile(devPath).catch(() => undefined)
    try {
        let connection = options.connection
        if (!connection) {
            const {createDevServer} = await import('./server.ts')
            server = await createDevServer({projectRoot: root, port: 0, strictPort: true})
            connection = {url: server.url, token: server.token}
        }
        try {
            browser = await chromium.launch({headless: true})
        } catch (error) {
            if (browserIsMissing(error)) {
                throw new HeadlessBrowserUnavailableError(`No Playwright browser is installed. ${PLAYWRIGHT_INSTALL_HINT}`)
            }
            throw error
        }
        return await operation(browser, connection)
    } finally {
        await browser?.close().catch(() => undefined)
        await server?.close().catch(() => undefined)
        if (previousDevFile) await writeFile(devPath, previousDevFile, {mode: 0o600})
    }
}

export async function saveScreenshotPng(
    projectRoot: string,
    bytes: Uint8Array,
    requestedName?: string,
): Promise<Omit<ScreenshotResult, 'source'>> {
    if (bytes.byteLength > MAX_SCREENSHOT_BYTES) throw new Error('The screenshot is larger than 50 MB.')
    const {width, height} = pngDimensions(bytes)
    const directory = resolve(projectRoot, '.kite3d/screenshots')
    const name = screenshotName(requestedName)
    await mkdir(directory, {recursive: true})
    let capturedTime = Date.now()
    for (;;) {
        const capturedAt = new Date(capturedTime).toISOString()
        const timestamp = capturedAt.replace(/[:.]/g, '-')
        const path = resolve(directory, `${timestamp}-${name}.png`)
        try {
            await writeFile(path, bytes, {flag: 'wx', mode: 0o600})
            return {path, width, height, capturedAt}
        } catch (error) {
            if (!isFileExists(error)) throw error
            capturedTime += 1
        }
    }
}

export function pngDimensions(bytes: Uint8Array): {width: number, height: number} {
    if (bytes.byteLength < 24 || !Buffer.from(bytes.subarray(0, 8)).equals(PNG_SIGNATURE)
        || Buffer.from(bytes.subarray(12, 16)).toString('ascii') !== 'IHDR') {
        throw new Error('The editor returned an invalid PNG.')
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const width = view.getUint32(16)
    const height = view.getUint32(20)
    if (width < 1 || height < 1) throw new Error('The editor returned a PNG with zero size.')
    return {width, height}
}

function screenshotDimension(value: number | undefined, option: string, fallback: number): number {
    if (value === undefined) return fallback
    if (!Number.isInteger(value) || value < 1) throw new Error(`${option} must be a positive integer.`)
    return value
}

function screenshotName(value?: string): string {
    const normalized = (value || 'editor').trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
    if (!normalized) throw new Error('--name must contain a letter, number, underscore, or hyphen.')
    return normalized.slice(0, 80)
}

async function requestEditorScreenshot(
    connection: DevConnection,
    options: {name: string, width: number, height: number},
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
            body: JSON.stringify(options),
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

function browserIsMissing(error: unknown): boolean {
    return /executable.*(does not exist|doesn't exist|missing)|browser.*not found|playwright install/i.test(errorMessage(error))
}

function isFileExists(error: unknown): boolean {
    return error instanceof Error && 'code' in error && error.code === 'EEXIST'
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}
