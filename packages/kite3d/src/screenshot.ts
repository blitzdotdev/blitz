import {createRequire} from 'node:module'
import {mkdir, writeFile} from 'node:fs/promises'
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
    return runWithHeadlessChromium(root, async (browser, activeConnection) => {
        const page = await browser.newPage({viewport: {width, height}})
        const url = new URL(activeConnection.url)
        url.searchParams.set('headless', 'screenshot')
        await page.goto(url.href, {waitUntil: 'domcontentloaded', timeout: 30_000})
        await page.waitForFunction(
            'window.kite3dProjectLoaded === true',
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

export async function runWithHeadlessChromium<T>(
    root: string,
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
    try {
        const {createDevServer} = await import('./server.ts')
        server = await createDevServer({projectRoot: root, port: 0, strictPort: true})
        const connection = {url: server.url, token: server.token}
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

function browserIsMissing(error: unknown): boolean {
    return /executable.*(does not exist|doesn't exist|missing)|browser.*not found|playwright install/i.test(errorMessage(error))
}

function isFileExists(error: unknown): boolean {
    return error instanceof Error && 'code' in error && error.code === 'EEXIST'
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}
