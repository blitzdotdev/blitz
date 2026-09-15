import {mkdir, writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
export const MAX_SCREENSHOT_BYTES = 50 * 1024 * 1024

export interface SavedScreenshot {
    path: string
    width: number
    height: number
    capturedAt: string
}

export async function saveScreenshotPng(
    projectRoot: string,
    bytes: Uint8Array,
    requestedName?: string,
): Promise<SavedScreenshot> {
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

export function screenshotName(value?: string): string {
    const normalized = (value || 'editor').trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
    if (!normalized) throw new Error('--name must contain a letter, number, underscore, or hyphen.')
    return normalized.slice(0, 80)
}

function isFileExists(error: unknown): boolean {
    return error instanceof Error && 'code' in error && error.code === 'EEXIST'
}
