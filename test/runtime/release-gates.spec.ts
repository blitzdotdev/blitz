import {File} from 'node:buffer'
import {createHash} from 'node:crypto'
import {cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile} from 'node:fs/promises'
import {createServer, type Server} from 'node:http'
import {extname, normalize, relative, resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {expect, test} from '@playwright/test'
import {generateIndexHtml} from '../../../kite3d/dist/indexHtml.js'
import {buildManifest} from '../../../kite3d/dist/manifest.js'
import enginePackage from '../../package.json' with {type: 'json'}

const sampleDirectory = fileURLToPath(new URL('../../../editor/test/fixtures/sample-project/', import.meta.url))
const engineDirectory = fileURLToPath(new URL('../../', import.meta.url))
const largeAssetSize = 50 * 1024 * 1024 + 1

let releaseDirectory: string
let releaseOrigin: string
let releaseServer: Server
let manifest: Awaited<ReturnType<typeof buildManifest>>

test.beforeAll(async () => {
    releaseDirectory = await mkdtemp(resolve(tmpdir(), 'kite3d-independent-release-'))
    await cp(sampleDirectory, releaseDirectory, {recursive: true})
    await mkdir(resolve(releaseDirectory, '_blitz'), {recursive: true})
    const runtime = await readFile(resolve(engineDirectory, 'dist/runtime.js'))
    await writeFile(resolve(releaseDirectory, '_blitz/runtime.js'), runtime)
    await writeFile(resolve(releaseDirectory, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>\n')
    await writeFile(resolve(releaseDirectory, 'assets/large-range.bin'), Buffer.alloc(largeAssetSize, 0x5a))
    await writeFile(resolve(releaseDirectory, 'index.html'), generateIndexHtml({
        name: 'Independent release gate',
        version: enginePackage.version,
        runtimeHash: createHash('sha256').update(runtime).digest('hex'),
        dependencies: [{key: 'threepipe', version: '0.5.1'}],
    }))

    const paths = await walkFiles(releaseDirectory)
    manifest = await buildManifest(await Promise.all(paths.map(async (path) => ({
        path,
        file: new File([await readFile(resolve(releaseDirectory, path))], path),
    }))))
    releaseServer = createReleaseServer(releaseDirectory, manifest)
    releaseOrigin = await listen(releaseServer)
})

test.afterAll(async () => {
    await close(releaseServer)
    await rm(releaseDirectory, {recursive: true, force: true})
})

test('boots a published release from one clean static origin with no development dependencies', async ({page}) => {
    const requests: string[] = []
    const errors: string[] = []
    page.on('request', (request) => requests.push(request.url()))
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text())
    })

    await page.goto(`${releaseOrigin}/`)
    await expect.poll(() => page.evaluate(() => (window as any).__kite3dUpdates || 0)).toBeGreaterThan(0)
    expect(await page.evaluate(() => Boolean((window as any).__kite3dMainRan))).toBe(true)
    expect(await page.locator('body').innerText()).not.toContain('Failed to start:')

    expect(requests.length).toBeGreaterThan(0)
    const foreignRequests = requests.filter((url) => new URL(url).origin !== releaseOrigin)
    expect(foreignRequests).toEqual([])
    expect(requests.some((url) => /esm\.sh|kite3d\.dev|localhost/.test(url))).toBe(false)
    expect(errors).toEqual([])

    const html = await readFile(resolve(releaseDirectory, 'index.html'), 'utf8')
    expect(html).toContain("import {createGame} from './_blitz/runtime.js'")
    expect(html).toContain('"threepipe":"./_blitz/runtime.js"')
    expect(Object.keys(manifest.files)).toEqual(expect.arrayContaining([
        '_blitz/runtime.js',
        'index.html',
        'package.json',
        'assets/main.scene.gltf',
    ]))
})

test('serves published bytes with gateway-compatible identity encoding, strong ETags, and ranges', async () => {
    const path = 'assets/large-range.bin'
    const url = `${releaseOrigin}/${path}`
    const expectedEtag = `"${manifest.files[path].sha256}"`

    const full = await fetch(url, {method: 'HEAD'})
    expect(full.status).toBe(200)
    expect(full.headers.get('content-encoding')).toBe('identity')
    expect(full.headers.get('etag')).toBe(expectedEtag)
    expect(full.headers.get('content-length')).toBe(String(largeAssetSize))
    expect(full.headers.get('accept-ranges')).toBe('bytes')
    expect(full.headers.get('cache-control')).toBe('public, max-age=60, must-revalidate')
    expect(full.headers.get('x-content-type-options')).toBe('nosniff')
    expect((await full.arrayBuffer()).byteLength).toBe(0)

    const unchanged = await fetch(url, {headers: {'If-None-Match': expectedEtag}})
    expect(unchanged.status).toBe(304)
    expect(unchanged.headers.get('etag')).toBe(expectedEtag)
    expect((await unchanged.arrayBuffer()).byteLength).toBe(0)

    const rangeStart = largeAssetSize - 8
    const range = await fetch(url, {headers: {Range: `bytes=${rangeStart}-${rangeStart + 7}`}})
    expect(range.status).toBe(206)
    expect(range.headers.get('content-encoding')).toBe('identity')
    expect(range.headers.get('etag')).toBe(expectedEtag)
    expect(range.headers.get('content-range')).toBe(`bytes ${rangeStart}-${largeAssetSize - 1}/${largeAssetSize}`)
    expect(range.headers.get('content-length')).toBe('8')
    expect(Buffer.from(await range.arrayBuffer())).toEqual(Buffer.alloc(8, 0x5a))

    expect((await fetch(`${releaseOrigin}/missing.bin`)).status).toBe(404)
})

function createReleaseServer(root: string, releaseManifest: typeof manifest): Server {
    return createServer(async (request, response) => {
        try {
            if (!['GET', 'HEAD'].includes(request.method || '')) {
                response.writeHead(405).end('Method not allowed')
                return
            }
            const pathname = new URL(request.url || '/', `http://${request.headers.host}`).pathname
            const requested = pathname === '/' || pathname.endsWith('/')
                ? `${pathname.slice(1)}index.html`
                : pathname.slice(1)
            const path = normalize(decodeURIComponent(requested)).replaceAll('\\', '/')
            const descriptor = releaseManifest.files[path]
            const filePath = resolve(root, path)
            if (!descriptor || relative(root, filePath).startsWith('..') || !(await stat(filePath)).isFile()) {
                response.writeHead(404, {'X-Content-Type-Options': 'nosniff'}).end('Not found')
                return
            }

            const body = await readFile(filePath)
            const etag = `"${descriptor.sha256}"`
            const headers: Record<string, string | number> = {
                'Content-Type': descriptor.mime || mimeType(path),
                'Content-Encoding': 'identity',
                'ETag': etag,
                'Accept-Ranges': 'bytes',
                'Cache-Control': 'public, max-age=60, must-revalidate',
                'X-Content-Type-Options': 'nosniff',
            }
            if (request.headers['if-none-match'] === etag) {
                response.writeHead(304, headers).end()
                return
            }

            const parsedRange = parseRange(request.headers.range, body.byteLength)
            if (request.headers.range && !parsedRange) {
                response.writeHead(416, {...headers, 'Content-Range': `bytes */${body.byteLength}`}).end()
                return
            }
            if (parsedRange) {
                const {start, end} = parsedRange
                const partial = body.subarray(start, end + 1)
                response.writeHead(206, {
                    ...headers,
                    'Content-Length': partial.byteLength,
                    'Content-Range': `bytes ${start}-${end}/${body.byteLength}`,
                })
                if (request.method === 'HEAD') response.end()
                else response.end(partial)
                return
            }

            response.writeHead(200, {...headers, 'Content-Length': body.byteLength})
            if (request.method === 'HEAD') response.end()
            else response.end(body)
        } catch {
            response.writeHead(404, {'X-Content-Type-Options': 'nosniff'}).end('Not found')
        }
    })
}

function parseRange(value: string | undefined, size: number): {start: number, end: number} | undefined {
    if (!value) return undefined
    const match = /^bytes=(\d+)-(\d*)$/.exec(value)
    if (!match) return undefined
    const start = Number(match[1])
    const end = match[2] ? Number(match[2]) : size - 1
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return undefined
    return {start, end: Math.min(end, size - 1)}
}

async function walkFiles(root: string, directory = root): Promise<string[]> {
    const paths: string[] = []
    for (const entry of await readdir(directory, {withFileTypes: true})) {
        const fullPath = resolve(directory, entry.name)
        if (entry.isDirectory()) paths.push(...await walkFiles(root, fullPath))
        else if (entry.isFile()) paths.push(relative(root, fullPath).replaceAll('\\', '/'))
    }
    return paths.sort()
}

function mimeType(path: string): string {
    const types: Record<string, string> = {
        '.bin': 'application/octet-stream',
        '.gltf': 'model/gltf+json',
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.svg': 'image/svg+xml',
    }
    return types[extname(path).toLowerCase()] || 'application/octet-stream'
}

function listen(server: Server): Promise<string> {
    return new Promise((resolveListen, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => {
            server.off('error', reject)
            const address = server.address()
            if (!address || typeof address === 'string') {
                reject(new Error('Static release server did not bind to a TCP port'))
                return
            }
            resolveListen(`http://127.0.0.1:${address.port}`)
        })
    })
}

function close(server: Server | undefined): Promise<void> {
    if (!server) return Promise.resolve()
    return new Promise((resolveClose, reject) => {
        server.close((error) => error ? reject(error) : resolveClose())
    })
}
