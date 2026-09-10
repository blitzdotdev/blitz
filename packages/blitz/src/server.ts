import {createHash, randomBytes} from 'node:crypto'
import {createReadStream, createWriteStream, watch, type FSWatcher} from 'node:fs'
import {
    access,
    lstat,
    mkdir,
    readFile,
    readdir,
    realpath,
    rename,
    stat,
    unlink,
} from 'node:fs/promises'
import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http'
import {basename, dirname, extname, resolve, sep} from 'node:path'
import {pipeline} from 'node:stream/promises'
import {fileURLToPath} from 'node:url'
import {mimeTypeForPath} from '@blitzdev/engine/fileTypes'
import {DEPLOYS_PATH} from '@blitzdev/engine/paths'
import {RUNTIME_VERSION} from '@blitzdev/engine/version'

export interface ManifestEntry {
    path: string
    size: number
    sha256: string
    mtime: number
}

export interface DevServerOptions {
    projectRoot?: string
    port?: number
    token?: string
    editorDirectory?: string
    runtimePath?: string
    open?: boolean
    publish?: (message: string | undefined, emit: (data: unknown) => void) => Promise<{preview_url: string, release_hash: string}>
    pull?: () => Promise<unknown>
}

export interface DevServer {
    readonly server: Server
    readonly projectRoot: string
    readonly port: number
    readonly token: string
    readonly url: string
    close(): Promise<void>
}

interface PendingEvent {
    path: string
    client?: string
    forcedType?: 'change' | 'add' | 'unlink'
    timer: ReturnType<typeof setTimeout>
}

const SERVER_VERSION = '0.12.0'
const excludedDirectories = new Set(['.git', 'node_modules', 'dist'])

export async function createDevServer(options: DevServerOptions = {}): Promise<DevServer> {
    const projectRoot = await realpath(resolve(options.projectRoot || process.cwd()))
    const token = options.token || randomBytes(24).toString('base64url')
    const editorDirectory = options.editorDirectory || await resolvePackageDirectory('@blitzdev/editor') + '/dist'
    const runtimePath = options.runtimePath || resolve(await resolvePackageDirectory('@blitzdev/engine'), 'dist/runtime.js')
    const clients = new Set<ServerResponse>()
    const pendingEvents = new Map<string, PendingEvent>()
    const recentWrites = new Map<string, number>()
    const knownHashes = new Map<string, string>()
    let watcher: FSWatcher | undefined
    let closing = false

    for (const entry of await buildManifest(projectRoot)) knownHashes.set(entry.path, entry.sha256)

    const server = createServer(async (request, response) => {
        try {
            if (!isLocalHost(request.headers.host)) return send(response, 403, 'Invalid Host')
            const url = new URL(request.url || '/', `http://${request.headers.host}`)

            if (url.pathname === '/' || url.pathname === '/index.html') {
                if (url.searchParams.get('t') !== token) return send(response, 401, 'Missing or invalid Blitz token')
                response.setHeader('Set-Cookie', `blitz-token=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/`)
                return serveStatic(response, resolve(editorDirectory, 'index.html'), editorDirectory)
            }

            if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/files/')) {
                const cookieToken = request.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith('blitz-token='))?.slice('blitz-token='.length)
                if (request.headers['x-blitz-token'] !== token && decodeURIComponent(cookieToken || '') !== token) {
                    return send(response, 401, 'Missing or invalid Blitz token')
                }
            }

            if (request.method === 'GET' && url.pathname === '/_blitz/runtime.js') {
                return serveStatic(response, runtimePath, dirname(runtimePath))
            }
            if (request.method === 'GET' && url.pathname === '/api/files') {
                return json(response, 200, await buildManifest(projectRoot))
            }
            if (request.method === 'GET' && url.pathname === '/api/state') {
                return json(response, 200, await projectState(projectRoot))
            }
            if (request.method === 'GET' && url.pathname === '/api/events') {
                response.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    Connection: 'keep-alive',
                })
                response.write(': connected\n\n')
                clients.add(response)
                request.on('close', () => clients.delete(response))
                return
            }
            if (request.method === 'POST' && url.pathname === '/api/publish') {
                if (!options.publish) return json(response, 501, {error: {code: 'publish_unavailable', message: 'Publish is not configured.'}})
                const body = await readJsonBody(request)
                const result = await options.publish(typeof body.message === 'string' ? body.message : undefined, (data) => {
                    broadcast('publish', data)
                })
                return json(response, 200, result)
            }
            if (request.method === 'POST' && url.pathname === '/api/pull') {
                if (!options.pull) return json(response, 501, {error: {code: 'pull_unavailable', message: 'Pull is not configured.'}})
                return json(response, 200, await options.pull())
            }
            if (url.pathname.startsWith('/files/')) {
                const relativePath = decodeFilePath(url.pathname)
                const filePath = await safeProjectPath(projectRoot, relativePath, request.method === 'PUT')
                if (request.method === 'GET') return serveProjectFile(request, response, filePath, relativePath)
                if (request.method === 'PUT') {
                    const existed = await fileExists(filePath)
                    const currentHash = existed ? await hashFile(filePath) : undefined
                    const ifMatch = request.headers['if-match']
                    if (!ifMatch || (ifMatch !== '*' && ifMatch !== quoteHash(currentHash))) {
                        return json(response, 412, {error: {code: 'precondition_failed', message: 'The file changed on disk.'}, sha256: currentHash})
                    }
                    await mkdir(dirname(filePath), {recursive: true})
                    const temporary = resolve(dirname(filePath), `.${basename(filePath)}.blitz-${randomBytes(8).toString('hex')}`)
                    try {
                        await pipeline(request, createWriteStream(temporary, {flags: 'wx'}))
                        await rename(temporary, filePath)
                    } catch (error) {
                        await unlink(temporary).catch(() => undefined)
                        throw error
                    }
                    const sha256 = await hashFile(filePath)
                    knownHashes.set(relativePath, sha256)
                    recentWrites.set(relativePath, Date.now())
                    scheduleEvent(relativePath, request.headers['x-blitz-client'] as string | undefined, existed ? 'change' : 'add')
                    return json(response, existed ? 200 : 201, {path: relativePath, sha256})
                }
                if (request.method === 'DELETE') {
                    const existed = await fileExists(filePath)
                    if (!existed) return send(response, 404, 'Not found')
                    await unlink(filePath)
                    knownHashes.delete(relativePath)
                    recentWrites.set(relativePath, Date.now())
                    scheduleEvent(relativePath, request.headers['x-blitz-client'] as string | undefined, 'unlink')
                    return send(response, 204)
                }
            }

            if (request.method === 'GET') {
                const relative = decodeURIComponent(url.pathname.slice(1))
                if (relative && !relative.includes('..') && !relative.includes('\\')) {
                    const staticPath = resolve(editorDirectory, relative)
                    if (staticPath.startsWith(`${resolve(editorDirectory)}${sep}`)) {
                        return serveStatic(response, staticPath, editorDirectory)
                    }
                }
            }
            return send(response, 404, 'Not found')
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Internal server error'
            const status = /Invalid project path|forbidden|symlink|escape/i.test(message) ? 403 : 500
            return json(response, status, {error: {code: status === 403 ? 'invalid_path' : 'internal_error', message}})
        }
    })

    function broadcast(event: string, data: unknown) {
        const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
        for (const client of clients) client.write(frame)
    }

    function scheduleEvent(path: string, client?: string, forcedType?: PendingEvent['forcedType']) {
        const previous = pendingEvents.get(path)
        if (previous) clearTimeout(previous.timer)
        const effectiveType = previous?.forcedType === 'add' && forcedType !== 'unlink'
            ? 'add'
            : forcedType ?? previous?.forcedType
        const effectiveClient = client ?? previous?.client
        const timer = setTimeout(async () => {
            pendingEvents.delete(path)
            const oldHash = knownHashes.get(path)
            let sha256: string | undefined
            try {
                const target = await safeProjectPath(projectRoot, path)
                sha256 = await hashFile(target)
            } catch {
                sha256 = undefined
            }
            const type = effectiveType || (sha256 ? (oldHash ? 'change' : 'add') : 'unlink')
            if (sha256) knownHashes.set(path, sha256)
            else knownHashes.delete(path)
            broadcast(type, {path, sha256, client: effectiveClient})
        }, 150)
        pendingEvents.set(path, {path, client: effectiveClient, forcedType: effectiveType, timer})
    }

    await new Promise<void>((resolveListen, reject) => {
        server.once('error', reject)
        server.listen(options.port ?? 4321, '127.0.0.1', () => {
            server.off('error', reject)
            resolveListen()
        })
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Unable to determine dev server address')
    const port = address.port
    const url = `http://127.0.0.1:${port}/?t=${encodeURIComponent(token)}`

    await mkdir(resolve(projectRoot, '.blitz'), {recursive: true})
    await writeDevFile(projectRoot, {url, port, token, pid: process.pid, started_at: new Date().toISOString()})
    try {
        watcher = watch(projectRoot, {recursive: true}, (_event, filename) => {
            if (!filename) return
            const path = normalizeRelativePath(filename.toString())
            if (!path || !isIncludedPath(path)) return
            if (Date.now() - (recentWrites.get(path) || 0) < 600) return
            void scheduleWatchedFile(path)
        })
        watcher.on('error', (error) => console.warn(`[blitz] watcher: ${error.message}`))
    } catch (error) {
        console.warn(`[blitz] file watching is unavailable: ${error instanceof Error ? error.message : error}`)
    }
    const keepAlive = setInterval(() => {
        for (const client of clients) client.write(': keepalive\n\n')
    }, 15_000)
    keepAlive.unref()

    return {
        server,
        projectRoot,
        port,
        token,
        url,
        async close() {
            if (closing) return
            closing = true
            watcher?.close()
            clearInterval(keepAlive)
            for (const pending of pendingEvents.values()) clearTimeout(pending.timer)
            for (const client of clients) client.end()
            await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()))
            await unlink(resolve(projectRoot, '.blitz/dev.json')).catch(() => undefined)
        },
    }

    async function scheduleWatchedFile(path: string): Promise<void> {
        try {
            const target = await safeProjectPath(projectRoot, path)
            const metadata = await lstat(target)
            if (!metadata.isFile()) return
        } catch (error) {
            // A missing path is an unlink only when it was previously a file in
            // the manifest. Recursive watchers also report removed directories.
            if (!isMissing(error) || !knownHashes.has(path)) return
        }
        scheduleEvent(path)
    }
}

export async function buildManifest(root: string): Promise<ManifestEntry[]> {
    const entries: ManifestEntry[] = []
    await walk(root, '')
    return entries.sort((left, right) => left.path.localeCompare(right.path))

    async function walk(directory: string, prefix: string): Promise<void> {
        for (const entry of await readdir(directory, {withFileTypes: true})) {
            const path = prefix ? `${prefix}/${entry.name}` : entry.name
            if (!isIncludedPath(path)) continue
            const target = resolve(directory, entry.name)
            if (entry.isSymbolicLink()) continue
            if (entry.isDirectory()) await walk(target, path)
            else if (entry.isFile()) {
                const metadata = await stat(target)
                entries.push({path, size: metadata.size, sha256: await hashFile(target), mtime: metadata.mtimeMs})
            }
        }
    }
}

function isIncludedPath(path: string): boolean {
    const parts = normalizeRelativePath(path).split('/')
    if (parts.some((part) => excludedDirectories.has(part))) return false
    return !parts.some((part) => part.startsWith('.') && part !== '.blitz')
}

async function projectState(root: string) {
    let packageJson: Record<string, unknown> = {}
    let deploys: unknown = {games: {}}
    try { packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as Record<string, unknown> } catch { /* optional */ }
    try { deploys = JSON.parse(await readFile(resolve(root, DEPLOYS_PATH), 'utf8')) as unknown } catch { /* optional */ }
    return {
        name: typeof packageJson.name === 'string' ? packageJson.name : basename(root),
        versions: {server: SERVER_VERSION, engine: RUNTIME_VERSION, editor: SERVER_VERSION},
        deploys,
        server_version: SERVER_VERSION,
    }
}

async function safeProjectPath(root: string, relativePath: string, allowMissing = false): Promise<string> {
    if (!relativePath || !isIncludedPath(relativePath)) throw new Error(`Invalid project path: ${relativePath}`)
    const normalized = normalizeRelativePath(relativePath)
    if (normalized !== relativePath || normalized.split('/').some((part) => !part || part === '.' || part === '..')) {
        throw new Error(`Invalid project path: ${relativePath}`)
    }
    const target = resolve(root, ...normalized.split('/'))
    if (!target.startsWith(`${root}${sep}`)) throw new Error('Project path escapes the project root')
    const parts = normalized.split('/')
    let current = root
    for (let index = 0; index < parts.length; index += 1) {
        current = resolve(current, parts[index])
        try {
            const info = await lstat(current)
            if (info.isSymbolicLink()) throw new Error('Project symlinks are forbidden')
            if (index < parts.length - 1 && !info.isDirectory()) throw new Error('Invalid project path')
        } catch (error) {
            if (allowMissing && isMissing(error)) break
            throw error
        }
    }
    return target
}

async function serveProjectFile(request: IncomingMessage, response: ServerResponse, path: string, relativePath: string) {
    if (!(await fileExists(path))) return send(response, 404, 'Not found')
    const sha256 = await hashFile(path)
    const etag = quoteHash(sha256)
    if (request.headers['if-none-match'] === etag) {
        response.writeHead(304, {ETag: etag}).end()
        return
    }
    const metadata = await stat(path)
    response.writeHead(200, {
        'Content-Type': mimeTypeForPath(relativePath),
        'Content-Length': metadata.size,
        ETag: etag,
        'Cache-Control': 'no-cache',
    })
    createReadStream(path).pipe(response)
}

async function serveStatic(response: ServerResponse, path: string, root: string) {
    const absoluteRoot = resolve(root)
    const absolutePath = resolve(path)
    if (absolutePath !== absoluteRoot && !absolutePath.startsWith(`${absoluteRoot}${sep}`)) return send(response, 403, 'Forbidden')
    try {
        const metadata = await stat(absolutePath)
        if (!metadata.isFile()) return send(response, 404, 'Not found')
        response.writeHead(200, {'Content-Type': mimeTypeForPath(absolutePath), 'Content-Length': metadata.size})
        createReadStream(absolutePath).pipe(response)
    } catch (error) {
        if (isMissing(error)) return send(response, 404, 'Not found')
        throw error
    }
}

function decodeFilePath(pathname: string): string {
    let decoded: string
    try { decoded = decodeURIComponent(pathname.slice('/files/'.length)) } catch { throw new Error('Invalid project path encoding') }
    return normalizeRelativePath(decoded)
}

function normalizeRelativePath(path: string): string {
    return path.replaceAll('\\', '/').replace(/^\/+/, '')
}

function isLocalHost(host: string | undefined): boolean {
    if (!host) return false
    const hostname = host.toLowerCase().replace(/:\d+$/, '')
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]'
}

async function hashFile(path: string): Promise<string> {
    const hash = createHash('sha256')
    await pipeline(createReadStream(path), hash)
    return hash.digest('hex')
}

function quoteHash(hash: string | undefined): string | undefined {
    return hash ? `"${hash}"` : undefined
}

async function fileExists(path: string): Promise<boolean> {
    try { await access(path); return true } catch { return false }
}

function isMissing(error: unknown): boolean {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function send(response: ServerResponse, status: number, body = '') {
    response.writeHead(status, body ? {'Content-Type': 'text/plain; charset=utf-8'} : undefined).end(body)
}

function json(response: ServerResponse, status: number, body: unknown) {
    const text = JSON.stringify(body)
    response.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text)}).end(text)
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    if (!chunks.length) return {}
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('JSON body must be an object')
    return body as Record<string, unknown>
}

async function writeDevFile(root: string, value: unknown): Promise<void> {
    const {writeFile} = await import('node:fs/promises')
    await writeFile(resolve(root, '.blitz/dev.json'), `${JSON.stringify(value, null, 2)}\n`, {mode: 0o600})
}

async function resolvePackageDirectory(packageName: string): Promise<string> {
    return dirname(fileURLToPath(import.meta.resolve(`${packageName}/package.json`)))
}
