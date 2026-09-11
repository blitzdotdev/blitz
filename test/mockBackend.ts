import {createHash, randomUUID} from 'node:crypto'
import {createServer, type IncomingMessage, type ServerResponse} from 'node:http'
import {KITE3D_VERSION} from '../src/versions.ts'
import type {ReleaseRecord} from '../src/types.ts'

interface MockGame {
    id: string
    slug: string
    name: string
    deployToken: string
    claimSecret: string
    expiresAt: string
    releases: ReleaseRecord[]
    claimed: boolean
}

export interface MockBackend {
    url: string
    games: Map<string, MockGame>
    requests: Array<{method: string, path: string, body: unknown, authorization?: string, cookie?: string}>
    maxActiveUploads: number
    releaseCount(slug: string): number
    close(): Promise<void>
}

export async function startMockBackend(options: {
    runtimeVersions?: string[]
    runtimeStatus?: number
    releaseStatus?: number
    runtimeHashes?: string[]
    createStatuses?: number[]
    missingStatuses?: number[]
    uploadStatuses?: number[]
    releaseStatuses?: number[]
    uploadConnectionLoss?: 'before' | 'after'
    uploadTimeouts?: number
    corruptPreviewPath?: string
    corruptPreviewReads?: number
    failureMessage?: string
    previewUrl?: (slug: string, response: 'create' | 'release') => string
} = {}): Promise<MockBackend> {
    const games = new Map<string, MockGame>()
    const blobs = new Map<string, Buffer>()
    const requests: MockBackend['requests'] = []
    const runtime = Buffer.from('mock Kite3D runtime')
    const runtimeHash = createHash('sha256').update(runtime).digest('hex')
    let baseUrl = ''
    let activeUploads = 0
    let maxActiveUploads = 0
    let connectionLosses = options.uploadConnectionLoss ? 1 : 0
    let uploadTimeouts = options.uploadTimeouts || 0
    let corruptPreviewReads = options.corruptPreviewReads ?? Number.POSITIVE_INFINITY

    const server = createServer(async (request, response) => {
        const url = new URL(request.url || '/', baseUrl || 'http://127.0.0.1')
        const body = await readBody(request)
        requests.push({
            method: request.method || 'GET',
            path: `${url.pathname}${url.search}`,
            body,
            authorization: request.headers.authorization,
            cookie: request.headers.cookie,
        })

        if (request.method === 'GET' && url.pathname === '/health') {
            return sendJson(response, 200, {status: 'ok', service: 'blitz-backend'})
        }

        if (request.method === 'GET' && url.pathname.startsWith('/api/v1/slugs/')) {
            const slug = decodeURIComponent(url.pathname.slice('/api/v1/slugs/'.length))
            const reason = slugReason(slug, games)
            return sendJson(response, 200, reason ? {slug, available: false, reason} : {slug, available: true})
        }
        if (request.method === 'POST' && url.pathname === '/api/v1/auth/register') {
            return sendJson(response, 201, {user: {id: 'user-register', username: value(body, 'username')}, token: 'jwt-register', refresh_token: 'refresh-register'})
        }
        if (request.method === 'POST' && url.pathname === '/api/v1/auth/login') {
            return sendJson(response, 200, {user: {id: 'user-login', username: 'player'}, token: 'jwt-login', refresh_token: 'refresh-login'})
        }
        if (request.method === 'POST' && url.pathname === '/api/v1/table/users/auth/google-login') {
            const form = new URLSearchParams(Buffer.isBuffer(body) ? body.toString('utf8') : '')
            const credential = form.get('credential')
            const csrfToken = form.get('g_csrf_token')
            if (!credential || !csrfToken) {
                return sendJson(response, 400, {error: {code: 'invalid_google_login', message: 'Missing Google login fields.'}})
            }
            if (cookieValue(request.headers.cookie, 'g_csrf_token') !== csrfToken) {
                return sendJson(response, 403, {error: {code: 'invalid_google_csrf', message: 'Google CSRF cookie does not match.'}})
            }
            return sendJson(response, 200, {
                record: {id: 'user-google', username: 'google-player'},
                token: 'jwt-google',
                refresh_token: 'refresh-google',
            })
        }
        const newGame = request.method === 'POST' && /^\/api\/v1\/new-game\/([^/]+)$/.exec(url.pathname)
        if (newGame) {
            const failure = options.createStatuses?.shift()
            if (failure) return sendFailure(response, failure, options.failureMessage)
            const slug = decodeURIComponent(newGame[1])
            const reason = slugReason(slug, games)
            if (reason) return sendJson(response, reason === 'slug_taken' ? 409 : 400, {error: {code: reason, message: reason}})
            const game: MockGame = {
                id: randomUUID(),
                slug,
                name: url.searchParams.get('name') || slug,
                deployToken: `tp_${slug}`,
                claimSecret: `secret_${slug}`,
                expiresAt: sqlDate(Date.now() + 12 * 60 * 60 * 1000),
                releases: [],
                claimed: false,
            }
            games.set(slug, game)
            return sendJson(response, 201, {
                game_id: game.id,
                slug,
                name: game.name,
                state: 'open',
                expires_at: game.expiresAt,
                preview_url: previewUrl(slug, 'create'),
                deploy_token: game.deployToken,
                claim_secret: game.claimSecret,
                claim_url: `${baseUrl}/api/v1/games/${slug}/claim`,
            })
        }
        const runtimeMatch = request.method === 'GET' && /^\/api\/v1\/runtimes\/([^/]+)$/.exec(url.pathname)
        if (runtimeMatch && options.runtimeStatus) {
            return sendJson(response, options.runtimeStatus, {error: {code: 'runtime_unavailable', message: 'Runtime unavailable.'}})
        }
        if (runtimeMatch && (options.runtimeVersions || [KITE3D_VERSION]).includes(decodeURIComponent(runtimeMatch[1]))) {
            const hashes = options.runtimeHashes || [runtimeHash]
            return sendJson(response, 200, {
                version: decodeURIComponent(runtimeMatch[1]),
                sha256: hashes[0],
                size: runtime.byteLength,
                runtimes: hashes.map((sha256, index) => ({
                    sha256,
                    size: runtime.byteLength,
                    created_at: new Date(Date.now() - index * 1_000).toISOString(),
                })),
            })
        }
        const claim = request.method === 'POST' && /^\/api\/v1\/games\/([^/]+)\/claim$/.exec(url.pathname)
        if (claim) {
            const game = findGame(decodeURIComponent(claim[1]), games)
            if (!game) return sendJson(response, 404, {error: {code: 'game_not_found', message: 'Game not found.'}})
            if (!request.headers.authorization?.startsWith('Bearer jwt-')) {
                return sendJson(response, 401, {error: {code: 'invalid_token', message: 'Invalid platform token.'}})
            }
            if (value(body, 'secret') !== game.claimSecret) {
                return sendJson(response, 403, {error: {code: 'invalid_claim_secret', message: 'Invalid claim secret.'}})
            }
            game.claimed = true
            return sendJson(response, 200, {game_id: game.id, slug: game.slug, owner_id: 'user-id', claimed: true})
        }
        const missing = request.method === 'POST' && /^\/api\/v1\/games\/([^/]+)\/blobs\/missing$/.exec(url.pathname)
        if (missing) {
            const failure = options.missingStatuses?.shift()
            if (failure) return sendFailure(response, failure, options.failureMessage)
            const hashes = Array.isArray(record(body).hashes) ? record(body).hashes as string[] : []
            return sendJson(response, 200, {missing: hashes.filter((hash) => hash !== runtimeHash && !blobs.has(hash))})
        }
        const blobHead = request.method === 'HEAD' && /^\/api\/v1\/games\/([^/]+)\/blobs\/([a-f\d]{64})$/.exec(url.pathname)
        if (blobHead) {
            const bytes = blobHead[2] === runtimeHash ? runtime : blobs.get(blobHead[2])
            if (!bytes) return sendJson(response, 404, {error: {code: 'blob_not_found', message: 'Blob not found.'}})
            response.writeHead(200, {'Content-Length': String(bytes.byteLength), ETag: `"${blobHead[2]}"`}).end()
            return
        }
        const upload = request.method === 'PUT' && /^\/api\/v1\/games\/([^/]+)\/blobs\/([a-f\d]{64})$/.exec(url.pathname)
        if (upload) {
            const bytes = Buffer.isBuffer(body) ? body : Buffer.alloc(0)
            const failure = options.uploadStatuses?.shift()
            if (failure) return sendFailure(response, failure, options.failureMessage)
            if (uploadTimeouts > 0) {
                uploadTimeouts -= 1
                await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
                if (response.destroyed) return
            }
            if (connectionLosses > 0 && options.uploadConnectionLoss === 'before') {
                connectionLosses -= 1
                request.socket.destroy()
                return
            }
            activeUploads += 1
            maxActiveUploads = Math.max(maxActiveUploads, activeUploads)
            await new Promise((resolveDelay) => setTimeout(resolveDelay, 5))
            blobs.set(upload[2], bytes)
            activeUploads -= 1
            if (connectionLosses > 0 && options.uploadConnectionLoss === 'after') {
                connectionLosses -= 1
                request.socket.destroy()
                return
            }
            return sendJson(response, 201, {sha256: upload[2], size: bytes.byteLength, uploaded: true})
        }
        const release = request.method === 'PUT' && /^\/api\/v1\/games\/([^/]+)\/releases$/.exec(url.pathname)
        if (release) {
            const game = findGame(decodeURIComponent(release[1]), games)
            if (!game) return sendJson(response, 404, {error: {code: 'game_not_found', message: 'Game not found.'}})
            const failure = options.releaseStatuses?.shift()
            if (failure) return sendFailure(response, failure, options.failureMessage)
            if (options.releaseStatus) {
                return sendJson(response, options.releaseStatus, {error: {code: 'unregistered_runtime', message: 'unregistered_runtime'}})
            }
            const releaseHash = String(game.releases.length + 1).padStart(64, '0')
            for (const previous of game.releases) previous.active = false
            const releaseRecord: ReleaseRecord = {
                release_hash: releaseHash,
                message: typeof record(body).message === 'string' ? record(body).message as string : null,
                created_at: new Date().toISOString(),
                active: true,
                files: record(record(body).files) as ReleaseRecord['files'],
            }
            game.releases.push(releaseRecord)
            return sendJson(response, game.releases.length === 1 ? 201 : 200, {
                release_hash: releaseHash,
                preview_url: previewUrl(game.slug, 'release'),
                files: releaseRecord.files,
            })
        }
        const gameRequest = request.method === 'GET' && /^\/api\/v1\/games\/([^/]+)$/.exec(url.pathname)
        if (gameRequest) {
            const game = findGame(decodeURIComponent(gameRequest[1]), games)
            if (!game) return sendJson(response, 404, {error: {code: 'game_not_found', message: 'Game not found.'}})
            return sendJson(response, 200, {game: {
                id: game.id,
                slug: game.slug,
                name: game.name,
                active_release: game.releases.at(-1)?.release_hash || null,
            }})
        }
        const releaseRequest = request.method === 'GET' && /^\/api\/v1\/games\/([^/]+)\/releases\/([a-f\d]{64})$/.exec(url.pathname)
        if (releaseRequest) {
            const game = findGame(decodeURIComponent(releaseRequest[1]), games)
            const found = game?.releases.find(({release_hash}) => release_hash === releaseRequest[2])
            return found
                ? sendJson(response, 200, found)
                : sendJson(response, 404, {error: {code: 'release_not_found', message: 'Release not found.'}})
        }
        const download = request.method === 'GET' && /^\/api\/v1\/games\/([^/]+)\/blobs\/([a-f\d]{64})$/.exec(url.pathname)
        if (download) {
            const bytes = blobs.get(download[2])
            if (!bytes) return sendJson(response, 404, {error: {code: 'blob_not_found', message: 'Blob not found.'}})
            response.writeHead(200, {'Content-Type': 'application/octet-stream'}).end(bytes)
            return
        }
        const preview = request.method === 'GET' && /^\/preview\/([^/]+)\/(.*)$/.exec(url.pathname)
        if (preview) {
            const game = games.get(decodeURIComponent(preview[1]))
            const path = preview[2]
                ? preview[2].split('/').map(decodeURIComponent).join('/')
                : 'index.html'
            const descriptor = game?.releases.find(({active}) => active)?.files[path]
            const bytes = descriptor?.sha256 === runtimeHash ? runtime : descriptor ? blobs.get(descriptor.sha256) : undefined
            if (!bytes) return sendJson(response, 404, {error: {code: 'asset_not_found', message: 'Asset not found.'}})
            if (path === options.corruptPreviewPath && corruptPreviewReads > 0) {
                corruptPreviewReads -= 1
                response.writeHead(200, {'Content-Type': 'application/octet-stream'}).end('corrupt bytes')
                return
            }
            response.writeHead(200, {'Content-Type': previewContentType(path)}).end(bytes)
            return
        }
        return sendJson(response, 404, {error: {code: 'not_found', message: 'Mock route not found.'}})
    })

    function previewUrl(slug: string, response: 'create' | 'release'): string {
        return options.previewUrl?.(slug, response) || `${baseUrl}/preview/${slug}/`
    }

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => {
            server.off('error', reject)
            resolve()
        })
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Mock backend did not bind a port.')
    baseUrl = `http://127.0.0.1:${address.port}`

    return {
        url: baseUrl,
        games,
        requests,
        get maxActiveUploads() { return maxActiveUploads },
        releaseCount(slug: string) { return games.get(slug)?.releases.length || 0 },
        close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
    }
}

async function readBody(request: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    if (!chunks.length) return {}
    const bytes = Buffer.concat(chunks)
    if (request.headers['content-type']?.startsWith('application/json')) return JSON.parse(bytes.toString('utf8')) as unknown
    return bytes
}

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function value(body: unknown, key: string): string {
    const result = record(body)[key]
    return typeof result === 'string' ? result : ''
}

function cookieValue(header: string | undefined, name: string): string | undefined {
    const prefix = `${encodeURIComponent(name)}=`
    const entry = header?.split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix))
    return entry ? decodeURIComponent(entry.slice(prefix.length)) : undefined
}

function slugReason(slug: string, games: Map<string, MockGame>): string | undefined {
    if (!/^[a-z0-9](?:[a-z0-9-]{1,47}[a-z0-9])$/.test(slug) || slug.includes('--')) return 'invalid_slug'
    if (slug === 'admin') return 'reserved_slug'
    if (games.has(slug)) return 'slug_taken'
    return undefined
}

function findGame(id: string, games: Map<string, MockGame>): MockGame | undefined {
    return games.get(id) || [...games.values()].find((game) => game.id === id)
}

function sqlDate(milliseconds: number): string {
    return new Date(milliseconds).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '')
}

function previewContentType(path: string): string {
    if (path.endsWith('.html')) return 'text/html; charset=utf-8'
    if (path.endsWith('.js') || path.endsWith('.mjs')) return 'text/javascript; charset=utf-8'
    if (path.endsWith('.json')) return 'application/json; charset=utf-8'
    if (path.endsWith('.gltf')) return 'model/gltf+json'
    if (path.endsWith('.glb')) return 'model/gltf-binary'
    return 'application/octet-stream'
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
    response.writeHead(status, {
        'Content-Type': 'application/json',
        ...(status === 429 || status >= 500 ? {'Retry-After': '0'} : {}),
    }).end(JSON.stringify(body))
}

function sendFailure(response: ServerResponse, status: number, message = `Injected HTTP ${status}`): void {
    sendJson(response, status, {error: {code: `injected_${status}`, message}})
}
