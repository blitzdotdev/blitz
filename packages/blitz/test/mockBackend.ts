import {createHash, randomUUID} from 'node:crypto'
import {createServer, type IncomingMessage, type ServerResponse} from 'node:http'

interface MockGame {
    id: string
    slug: string
    name: string
    deployToken: string
    claimSecret: string
    expiresAt: string
    releases: string[]
    claimed: boolean
}

export interface MockBackend {
    url: string
    games: Map<string, MockGame>
    requests: Array<{method: string, path: string, body: unknown, authorization?: string}>
    releaseCount(slug: string): number
    close(): Promise<void>
}

export async function startMockBackend(): Promise<MockBackend> {
    const games = new Map<string, MockGame>()
    const blobs = new Map<string, Buffer>()
    const requests: MockBackend['requests'] = []
    const runtime = Buffer.from('mock Blitz runtime')
    const runtimeHash = createHash('sha256').update(runtime).digest('hex')
    let baseUrl = ''

    const server = createServer(async (request, response) => {
        const url = new URL(request.url || '/', baseUrl || 'http://127.0.0.1')
        const body = await readBody(request)
        requests.push({
            method: request.method || 'GET',
            path: `${url.pathname}${url.search}`,
            body,
            authorization: request.headers.authorization,
        })

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
        const newGame = request.method === 'POST' && /^\/api\/v1\/new-game\/([^/]+)$/.exec(url.pathname)
        if (newGame) {
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
                preview_url: `${baseUrl}/preview/${slug}/`,
                deploy_token: game.deployToken,
                claim_secret: game.claimSecret,
                claim_url: `${baseUrl}/api/v1/games/${slug}/claim`,
            })
        }
        if (request.method === 'GET' && url.pathname === '/api/v1/runtimes/0.12.0') {
            return sendJson(response, 200, {version: '0.12.0', sha256: runtimeHash, size: runtime.byteLength})
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
            const hashes = Array.isArray(record(body).hashes) ? record(body).hashes as string[] : []
            return sendJson(response, 200, {missing: hashes.filter((hash) => hash !== runtimeHash && !blobs.has(hash))})
        }
        const upload = request.method === 'PUT' && /^\/api\/v1\/games\/([^/]+)\/blobs\/([a-f\d]{64})$/.exec(url.pathname)
        if (upload) {
            const bytes = Buffer.isBuffer(body) ? body : Buffer.alloc(0)
            blobs.set(upload[2], bytes)
            return sendJson(response, 201, {sha256: upload[2], size: bytes.byteLength, uploaded: true})
        }
        const release = request.method === 'PUT' && /^\/api\/v1\/games\/([^/]+)\/releases$/.exec(url.pathname)
        if (release) {
            const game = findGame(decodeURIComponent(release[1]), games)
            if (!game) return sendJson(response, 404, {error: {code: 'game_not_found', message: 'Game not found.'}})
            const releaseHash = String(game.releases.length + 1).padStart(64, '0')
            game.releases.push(releaseHash)
            return sendJson(response, game.releases.length === 1 ? 201 : 200, {
                release_hash: releaseHash,
                preview_url: `${baseUrl}/preview/${game.slug}/`,
                files: record(body).files,
            })
        }
        if (request.method === 'GET' && /^\/preview\/[^/]+\/$/.test(url.pathname)) {
            return sendHtml(response, '<!doctype html><title>Mock published game</title>')
        }
        return sendJson(response, 404, {error: {code: 'not_found', message: 'Mock route not found.'}})
    })

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

function sendJson(response: ServerResponse, status: number, body: unknown): void {
    response.writeHead(status, {'Content-Type': 'application/json'}).end(JSON.stringify(body))
}

function sendHtml(response: ServerResponse, body: string): void {
    response.writeHead(200, {'Content-Type': 'text/html'}).end(body)
}
