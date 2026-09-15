import {createHash, randomBytes} from 'node:crypto'
import {createReadStream, createWriteStream} from 'node:fs'
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
import type {Server} from 'node:http'
import {createRequire} from 'node:module'
import {basename, dirname, relative, resolve, sep} from 'node:path'
import {Readable} from 'node:stream'
import {pipeline} from 'node:stream/promises'
import {fileURLToPath} from 'node:url'
import {serve, type HttpBindings} from '@hono/node-server'
import {mimeTypeForPath} from '@kite3d/engine/fileTypes'
import {dependencyImportMap} from '@kite3d/engine/importMap'
import {parsePackageJSON, parsePackageJsonSettingsConfig, type ProjectPackageJSON} from '@kite3d/engine/projectFormat'
import {Hono, type Context, type Next} from 'hono'
import {getCookie} from 'hono/cookie'
import {LinearRouter} from 'hono/router/linear-router'
import {streamSSE, type SSEStreamingApi} from 'hono/streaming'
import {watch, type FSWatcher} from 'chokidar'
import {mountHubRoutes} from './hubRoutes.ts'
import {ProjectModuleRewriter} from './module-rewriter.ts'
import {
    removeServerState,
    serverStatePath,
    writeServerState,
    type ServerState,
} from './serverState.ts'
import {KITE3D_VERSION, EDITOR_VERSION, ENGINE_VERSION} from './versions.ts'
import {DEVELOPMENT_PLUGIN_URL, installedPluginPackages} from './plugins.ts'
import {MAX_SCREENSHOT_BYTES, pngDimensions, saveScreenshotPng} from './screenshotFile.ts'

interface ManifestEntry {
    path: string
    size: number
    sha256: string
    mtime: number
}

export interface DevServerOptions {
    projectRoot?: string    // the project to serve; without it the server is the launcher
    port?: number
    strictPort?: boolean
}

export interface DevServer {
    readonly projectRoot: string | undefined
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

interface ScreenshotResult {
    ok: boolean
    code?: string
    error?: string
    [key: string]: unknown
}

interface PendingScreenshot {
    resolve: (result: ScreenshotResult) => void
    timer: ReturnType<typeof setTimeout>
    name: string
}

const excludedDirectories = new Set(['.git', 'node_modules', 'dist'])
const serverRequire = createRequire(import.meta.url)

export type LocalAppEnv = {Bindings: HttpBindings, Variables: {clientId: string | undefined}}

function installLocalServerMiddleware(app: Hono<LocalAppEnv>, token: string): void {
    app.use('*', async (c, next) => {
        if (!isLocalHost(c.req.header('Host'))) return textResponse('Invalid Host', 403)
        c.set('clientId', c.req.header('X-Kite3D-Client'))
        await next()
    })
    const checkToken = async (c: Context<LocalAppEnv>, next: Next): Promise<void | Response> => {
        const queryToken = c.req.method === 'GET' ? c.req.query('t') : undefined
        if (c.req.header('X-Kite3D-Token') !== token
            && getCookie(c, localTokenCookieName(c.req.raw)) !== token
            && queryToken !== token) {
            return textResponse('Missing or invalid Kite3D token', 401)
        }
        return next()
    }
    app.use('/api/*', checkToken)
    app.use('/files/*', checkToken)
    app.use('/kite3d/plugins/*', checkToken)
}

async function resolveEditorDirectory(): Promise<string> {
    return await resolvePackageDirectory('@kite3d/editor') + '/dist'
}

async function serveEditorIndex(
    request: Request,
    token: string,
    editorDirectory: string,
    transform: (source: string) => string | Promise<string> = (source) => source,
): Promise<Response> {
    const url = new URL(request.url)
    if (url.searchParams.get('t') !== token) return textResponse('Missing or invalid Kite3D token', 401)
    const source = await readFile(resolve(editorDirectory, 'index.html'), 'utf8')
    const response = new Response(await transform(source), {
        headers: {'Content-Type': 'text/html; charset=utf-8'},
    })
    response.headers.set(
        'Set-Cookie',
        `${localTokenCookieName(request)}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/`,
    )
    return response
}

function localTokenCookieName(request: Request): string {
    const url = new URL(request.url)
    const port = url.port || (url.protocol === 'https:' ? '443' : '80')
    return `kite3d-token-${port}`
}

function serveEditorPath(pathname: string, editorDirectory: string): Promise<Response> {
    const relative = decodeURIComponent(pathname.slice(1))
    if (relative && !relative.includes('..') && !relative.includes('\\')) {
        const staticPath = resolve(editorDirectory, relative)
        if (staticPath.startsWith(`${resolve(editorDirectory)}${sep}`)) {
            return serveStaticFile(staticPath, editorDirectory)
        }
    }
    return Promise.resolve(textResponse('Not found', 404))
}

export async function createDevServer(options: DevServerOptions = {}): Promise<DevServer> {
    // Without a project this server is the launcher: the editor bundle and the hub routes, no files.
    const projectRoot = options.projectRoot ? await realpath(resolve(options.projectRoot)) : undefined
    const token = randomBytes(24).toString('base64url')
    const editorDirectory = await resolveEditorDirectory()
    const clients = new Map<SSEStreamingApi, string | undefined>()
    const pendingScreenshots = new Map<string, PendingScreenshot>()
    const pendingEvents = new Map<string, PendingEvent>()
    const knownHashes = new Map<string, string>()
    const moduleRewriter = new ProjectModuleRewriter()
    let watcher: FSWatcher | undefined
    let closing = false

    const app = new Hono<LocalAppEnv>({router: new LinearRouter()})
    installLocalServerMiddleware(app, token)

    const serveIndex = (c: Context<LocalAppEnv>) => serveEditorIndex(
        c.req.raw,
        token,
        editorDirectory,
        projectRoot ? (source) => injectProjectImportMap(source, projectRoot) : undefined,
    )
    app.get('/', serveIndex)
    app.get('/index.html', serveIndex)
    app.get('/favicon.ico', () => serveStaticFile(resolve(editorDirectory, 'favicon.ico'), editorDirectory))
    mountHubRoutes(app)
    if (projectRoot) await mountProjectRoutes(projectRoot)
    else app.get('/api/state', () => jsonResponse({hub: true}))
    app.get('*', (c) => serveEditorPath(new URL(c.req.url).pathname, editorDirectory))
    app.onError((error) => {
        if (error instanceof InvalidProjectPathError) {
            return jsonResponse({error: {code: 'invalid_path', message: error.message}}, 403)
        }
        if (isMissing(error)) return missingFileResponse()
        return jsonResponse({error: {code: 'internal_error', message: 'Internal server error'}}, 500)
    })
    app.notFound(() => textResponse('Not found', 404))

    const requestedPort = options.port ?? 4321
    const attempts = options.strictPort || requestedPort === 0 ? 1 : 20
    let server!: Server

    async function broadcast(event: string, data: unknown): Promise<void> {
        await Promise.all([...clients.keys()].map(async (client) => {
            try { await client.writeSSE({event, data: JSON.stringify(data)}) } catch { clients.delete(client) }
        }))
    }

    for (let attempt = 0; attempt < attempts; attempt += 1) {
        const candidatePort = requestedPort === 0 ? 0 : requestedPort + attempt
        server = serve({fetch: app.fetch, port: candidatePort, hostname: '127.0.0.1'}) as Server
        try {
            await waitForListening(server)
            break
        } catch (error) {
            if (!isAddressInUse(error)) throw error
            if (options.strictPort) {
                throw new Error(`Port ${candidatePort} is already in use. Choose another port with --port.`)
            }
            if (attempt === attempts - 1) {
                throw new Error(`Ports ${requestedPort}-${requestedPort + attempts - 1} are already in use.`)
            }
        }
    }
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Unable to determine dev server address')
    const port = address.port
    const url = `http://127.0.0.1:${port}/?t=${encodeURIComponent(token)}`

    // How every other process finds this server: a project server next to its project, the launcher
    // in the kite3d home, because kite3d open must find it without being in a project.
    const statePath = serverStatePath(projectRoot)
    const state: ServerState = {pid: process.pid, port, url, token}
    await writeServerState(statePath, state)

    if (projectRoot) await startWatcher(projectRoot)
    const keepAlive = setInterval(() => {
        for (const client of clients.keys()) void client.write(': keepalive\n\n')
    }, 15_000)
    keepAlive.unref()

    return {
        projectRoot,
        port,
        token,
        url,
        async close() {
            if (closing) return
            closing = true
            await watcher?.close()
            clearInterval(keepAlive)
            for (const pending of pendingEvents.values()) clearTimeout(pending.timer)
            const eventClients = [...clients.keys()]
            // Abort first to release a writer blocked behind a disconnected client,
            // then close so clients that are still connected receive the stream end.
            for (const client of eventClients) client.abort()
            await Promise.all(eventClients.map((client) => client.close()))
            clients.clear()
            for (const screenshot of pendingScreenshots.values()) {
                clearTimeout(screenshot.timer)
                screenshot.resolve({ok: false, error: 'The development server closed before the screenshot finished.'})
            }
            pendingScreenshots.clear()
            const serverClosed = new Promise<void>((resolveClose, reject) => {
                server.close((error) => error ? reject(error) : resolveClose())
            })
            server.closeIdleConnections()
            server.closeAllConnections()
            await serverClosed
            await removeServerState(statePath, state)
        },
    }

    async function mountProjectRoutes(root: string): Promise<void> {
        for (const entry of await buildManifest(root)) knownHashes.set(entry.path, entry.sha256)
        app.get('/api/files', async () => jsonResponse(await buildManifest(root)))
        app.get('/api/directories', async () => jsonResponse({directories: await buildDirectoryManifest(root)}))
        app.post('/api/directories', async (c) => {
            const body = await readJsonBody(c.req.raw)
            if (typeof body.path !== 'string') {
                return jsonResponse({error: {code: 'invalid_path', message: 'A directory path is required.'}}, 400)
            }
            const directoryPath = await safeProjectPath(root, body.path, true)
            if (await fileExists(directoryPath)) {
                return jsonResponse({error: {code: 'already_exists', message: 'A file or directory with that name already exists.'}}, 409)
            }
            await mkdir(directoryPath)
            return jsonResponse({path: body.path}, 201)
        })
        app.get('/api/state', async () => jsonResponse({...await projectState(root), clients: clients.size}))
        app.get('/api/events', (c) => {
            c.header('Cache-Control', 'no-cache')
            c.header('Connection', 'keep-alive')
            return streamSSE(c, async (stream) => {
                clients.set(stream, c.req.query('client') || c.get('clientId'))
                await stream.write(': connected\n\n')
                await new Promise<void>((resolveAbort) => stream.onAbort(() => {
                    clients.delete(stream)
                    resolveAbort()
                }))
            })
        })
        app.post('/api/screenshot', async (c) => {
            const body = await readJsonBody(c.req.raw)
            if (body.name !== undefined && typeof body.name !== 'string') {
                return jsonResponse({error: {code: 'invalid_name', message: 'name must be a string.'}}, 400)
            }
            if (![...clients.values()].some(Boolean)) {
                return jsonResponse({error: {code: 'editor_not_connected', message: 'No editor is connected.'}}, 409)
            }
            const id = randomBytes(16).toString('hex')
            const name = typeof body.name === 'string' ? body.name : 'editor'
            const result = await new Promise<ScreenshotResult>((resolveScreenshot) => {
                const timer = setTimeout(() => {
                    pendingScreenshots.delete(id)
                    resolveScreenshot({
                        ok: false,
                        code: 'screenshot_timeout',
                        error: 'The editor did not answer the screenshot request. Reload the editor tab or run kite3d screenshot --headless.',
                    })
                }, 10_000)
                pendingScreenshots.set(id, {name, resolve: resolveScreenshot, timer})
                void broadcast('command', {id, command: 'screenshot', options: {name}})
            })
            if (result.ok) return jsonResponse(result)
            const code = result.code ?? 'screenshot_failed'
            const status = code === 'screenshot_timeout' ? 504 : 409
            return jsonResponse({error: {code, message: result.error || 'Screenshot failed.'}}, status)
        })
        app.post('/api/screenshot/:id', async (c) => {
            const id = c.req.param('id')
            if (!/^[a-f\d]+$/.test(id) || !pendingScreenshots.has(id)) {
                return jsonResponse({error: {code: 'screenshot_not_found', message: 'Screenshot is no longer pending.'}}, 404)
            }
            const contentLength = Number(c.req.header('Content-Length'))
            if (Number.isFinite(contentLength) && contentLength > MAX_SCREENSHOT_BYTES) {
                return jsonResponse({error: {code: 'screenshot_too_large', message: 'The screenshot is larger than 50 MB.'}}, 413)
            }
            const bytes = new Uint8Array(await c.req.arrayBuffer())
            try {
                pngDimensions(bytes)
            } catch (error) {
                return jsonResponse({error: {code: 'invalid_screenshot', message: errorMessage(error)}}, 400)
            }
            const pending = pendingScreenshots.get(id)
            if (!pending) {
                return jsonResponse({error: {code: 'screenshot_not_found', message: 'Screenshot is no longer pending.'}}, 404)
            }
            pendingScreenshots.delete(id)
            clearTimeout(pending.timer)
            try {
                const saved = await saveScreenshotPng(root, bytes, pending.name)
                pending.resolve({ok: true, ...saved, source: 'editor'})
                return jsonResponse({accepted: true}, 202)
            } catch (error) {
                pending.resolve({ok: false, error: errorMessage(error)})
                throw error
            }
        })
        app.get('/kite3d/plugins/*', async (c) => {
            const packageJson = await readProjectPackageJson(root)
            const plugins = await installedPluginPackages(root, packageJson, DEVELOPMENT_PLUGIN_URL)
            const requestPath = decodeURIComponent(new URL(c.req.url).pathname)
            const plugin = plugins.find(({rootUrl}) => requestPath.startsWith(rootUrl))
            if (!plugin) return missingFileResponse()
            const relativePath = requestPath.slice(plugin.rootUrl.length)
            if (!safePluginFilePath(relativePath)) return textResponse('Forbidden', 403)
            const packageRoot = resolve(root, 'node_modules', ...plugin.specifier.split('/'))
            return serveStaticFile(resolve(packageRoot, ...relativePath.split('/')), packageRoot)
        })
        app.get('/files/*', async (c) => {
            const relativePath = decodeFilePath(new URL(c.req.url).pathname)
            const filePath = await safeProjectPath(root, relativePath, true)
            if (!(await fileExists(filePath))) return missingFileResponse()
            return serveProjectFile(c.req.raw, filePath, relativePath, moduleRewriter, async (targetPath) => {
                try {
                    const target = await safeProjectPath(root, targetPath)
                    if (!(await stat(target)).isFile()) return undefined
                    return await hashFile(target)
                } catch {
                    return undefined
                }
            })
        })
        app.put('/files/*', async (c) => {
            const relativePath = decodeFilePath(new URL(c.req.url).pathname)
            const filePath = await safeProjectPath(root, relativePath, true)
            const existed = await fileExists(filePath)
            const currentHash = existed ? await hashFile(filePath) : undefined
            // A create sends If-None-Match: *, so it never truncates a file the editor has not listed yet.
            const ifNoneMatch = c.req.header('If-None-Match')
            const ifMatch = c.req.header('If-Match')
            if (ifNoneMatch === '*') {
                if (existed) {
                    return jsonResponse({error: {code: 'precondition_failed', message: 'The file already exists.'}, sha256: currentHash}, 412)
                }
            } else if (!ifMatch || (ifMatch !== '*' && ifMatch !== quoteHash(currentHash))) {
                return jsonResponse({error: {code: 'precondition_failed', message: 'The file changed on disk.'}, sha256: currentHash}, 412)
            }
            await mkdir(dirname(filePath), {recursive: true})
            const temporary = resolve(dirname(filePath), `.${basename(filePath)}.kite3d-${randomBytes(8).toString('hex')}`)
            let sha256 = ''
            try {
                if (!c.req.raw.body) throw new Error('File request body is required')
                await pipeline(c.env.incoming, createWriteStream(temporary, {flags: 'wx'}))
                sha256 = await hashFile(temporary)
                knownHashes.set(relativePath, sha256)
                await rename(temporary, filePath)
            } catch (error) {
                if (currentHash) knownHashes.set(relativePath, currentHash)
                else knownHashes.delete(relativePath)
                await unlink(temporary).catch(() => undefined)
                throw error
            }
            scheduleEvent(root, relativePath, c.get('clientId'), existed ? 'change' : 'add')
            return jsonResponse({path: relativePath, sha256}, existed ? 200 : 201)
        })
        app.delete('/files/*', async (c) => {
            const relativePath = decodeFilePath(new URL(c.req.url).pathname)
            const filePath = await safeProjectPath(root, relativePath, true)
            if (!(await fileExists(filePath))) return missingFileResponse()
            await unlink(filePath)
            knownHashes.delete(relativePath)
            scheduleEvent(root, relativePath, c.get('clientId'), 'unlink')
            return new Response(null, {status: 204})
        })
    }

    async function startWatcher(root: string): Promise<void> {
        try {
            const handleWatchedFile = (watchedPath: string) => {
                const path = normalizeRelativePath(relative(root, watchedPath))
                if (!path || !isWatchedPath(path)) return
                if (!closing) void processWatchedFile(root, path)
            }
            watcher = watch(root, {
                ignoreInitial: true,
                ignored: (watchedPath) => {
                    const path = normalizeRelativePath(relative(root, watchedPath))
                    return Boolean(path && !isWatchedPath(path))
                },
            })
            watcher.on('add', handleWatchedFile)
            watcher.on('change', handleWatchedFile)
            watcher.on('unlink', handleWatchedFile)
            watcher.on('error', (error) => {
                console.warn(`[kite3d] watcher: ${error instanceof Error ? error.message : error}`)
            })
            await new Promise<void>((resolveReady) => watcher!.once('ready', resolveReady))
        } catch (error) {
            console.warn(`[kite3d] file watching is unavailable: ${error instanceof Error ? error.message : error}`)
        }
    }

    function scheduleEvent(root: string, path: string, client?: string, forcedType?: PendingEvent['forcedType']) {
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
                const target = await safeProjectPath(root, path)
                sha256 = await hashFile(target)
            } catch {
                sha256 = undefined
            }
            const type = effectiveType || (sha256 ? (oldHash ? 'change' : 'add') : 'unlink')
            if (sha256) knownHashes.set(path, sha256)
            else knownHashes.delete(path)
            await broadcast(type, {path, sha256, client: effectiveClient})
        }, 150)
        pendingEvents.set(path, {path, client: effectiveClient, forcedType: effectiveType, timer})
    }

    async function processWatchedFile(root: string, path: string): Promise<void> {
        try {
            const target = await safeProjectPath(root, path)
            const metadata = await lstat(target)
            if (!metadata.isFile()) return
            if (await hashFile(target) === knownHashes.get(path)) return
        } catch (error) {
            // A missing path is an unlink only when it was previously a file in
            // the manifest. Recursive watchers also report removed directories.
            if (!isMissing(error) || !knownHashes.has(path)) return
        }
        if (!closing) scheduleEvent(root, path)
    }

}

function waitForListening(server: Server): Promise<void> {
    return new Promise((resolveListen, reject) => {
        if (server.listening) return resolveListen()
        server.once('error', reject)
        server.once('listening', () => {
            server.off('error', reject)
            resolveListen()
        })
    })
}

function isAddressInUse(error: unknown): boolean {
    return error instanceof Error && 'code' in error && error.code === 'EADDRINUSE'
}

async function buildManifest(root: string): Promise<ManifestEntry[]> {
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

async function buildDirectoryManifest(root: string): Promise<string[]> {
    const directories: string[] = []
    await walk(root, '')
    return directories.sort((left, right) => left.localeCompare(right))

    async function walk(directory: string, prefix: string): Promise<void> {
        for (const entry of await readdir(directory, {withFileTypes: true})) {
            if (!entry.isDirectory() || entry.isSymbolicLink()) continue
            const path = prefix ? `${prefix}/${entry.name}` : entry.name
            if (!isIncludedPath(path)) continue
            directories.push(path)
            await walk(resolve(directory, entry.name), path)
        }
    }
}

// The listing and the file routes keep .kite3d, because the editor's thumbnails and save backups
// live there.
function isIncludedPath(path: string): boolean {
    const normalized = normalizeRelativePath(path)
    const parts = normalized.split('/')
    if (parts.some((part) => excludedDirectories.has(part))) return false
    return !parts.some((part) => part.startsWith('.') && part !== '.kite3d')
}

// The watcher does not, so a screenshot, dev.json, a backup or a detached server's dev.log is not
// an event for every open tab.
function isWatchedPath(path: string): boolean {
    const parts = normalizeRelativePath(path).split('/')
    return isIncludedPath(path) && !parts.includes('.kite3d')
}

async function projectState(root: string) {
    let packageJson: Record<string, unknown> = {}
    try { packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as Record<string, unknown> } catch { /* optional */ }
    return {
        name: typeof packageJson.name === 'string' ? packageJson.name : basename(root),
        versions: {kite3d: KITE3D_VERSION, editor: EDITOR_VERSION, engine: ENGINE_VERSION},
    }
}

async function readProjectImportMap(root: string): Promise<{imports: Record<string, string>}> {
    const packageJson = await readProjectPackageJson(root)
    const config = await parsePackageJsonSettingsConfig(packageJson)
    const plugins = await installedPluginPackages(root, packageJson, DEVELOPMENT_PLUGIN_URL)
    return dependencyImportMap(config.dependencies, '/editor-runtime.js', plugins)
}

async function readProjectPackageJson(root: string): Promise<ProjectPackageJSON> {
    return parsePackageJSON(await readFile(resolve(root, 'package.json'), 'utf8'))
}

function safePluginFilePath(path: string): boolean {
    return Boolean(path) && !path.startsWith('/') && !path.includes('\\')
        && path.split('/').every((part) => Boolean(part) && part !== '.' && part !== '..')
}

async function injectProjectImportMap(html: string, root: string): Promise<string> {
    const importMap = JSON.stringify(await readProjectImportMap(root)).replace(/</g, '\\u003c')
    const script = `<script type="importmap">${importMap}</script>`
    if (/<script type="importmap">.*?<\/script>/s.test(html)) {
        return html.replace(/<script type="importmap">.*?<\/script>/s, script)
    }
    return html.replace('</head>', `${script}\n</head>`)
}

// A path the server refuses: outside the project, through a symlink, or not a relative project path.
// It is the one error app.onError answers with 403.
class InvalidProjectPathError extends Error {}

async function safeProjectPath(root: string, relativePath: string, allowMissing = false): Promise<string> {
    if (!relativePath || !isIncludedPath(relativePath)) throw new InvalidProjectPathError(`Invalid project path: ${relativePath}`)
    const normalized = normalizeRelativePath(relativePath)
    if (normalized !== relativePath || normalized.split('/').some((part) => !part || part === '.' || part === '..')) {
        throw new InvalidProjectPathError(`Invalid project path: ${relativePath}`)
    }
    const target = resolve(root, ...normalized.split('/'))
    if (!target.startsWith(`${root}${sep}`)) throw new InvalidProjectPathError('Project path escapes the project root')
    const parts = normalized.split('/')
    let current = root
    for (let index = 0; index < parts.length; index += 1) {
        current = resolve(current, parts[index])
        try {
            const info = await lstat(current)
            if (info.isSymbolicLink()) throw new InvalidProjectPathError('Project symlinks are forbidden')
            if (index < parts.length - 1 && !info.isDirectory()) throw new InvalidProjectPathError('Invalid project path')
        } catch (error) {
            if (allowMissing && isMissing(error)) break
            throw error
        }
    }
    return target
}

async function serveProjectFile(
    request: Request,
    path: string,
    relativePath: string,
    moduleRewriter: ProjectModuleRewriter,
    resolveModuleRevision: (path: string) => Promise<string | undefined>,
): Promise<Response> {
    if (!(await fileExists(path))) return missingFileResponse()
    const url = new URL(request.url)
    const rewriteImports = url.searchParams.has('v') && /\.m?js$/i.test(relativePath)
    const bytes = rewriteImports ? await readFile(path) : undefined
    const sha256 = bytes
        ? createHash('sha256').update(bytes).digest('hex')
        : await hashFile(path)
    const etag = `"${sha256}"`
    if (request.headers.get('If-None-Match') === etag) {
        return new Response(null, {status: 304, headers: {ETag: etag}})
    }
    if (bytes) {
        const body = await moduleRewriter.rewrite(
            relativePath,
            sha256,
            bytes.toString('utf8'),
            resolveModuleRevision,
            url.searchParams.get('r') || undefined,
        )
        return new Response(body, {
            status: 200,
            headers: {
                'Content-Type': mimeTypeForPath(relativePath),
                'Content-Length': String(Buffer.byteLength(body)),
                ETag: etag,
                'Cache-Control': 'no-cache',
            },
        })
    }
    const metadata = await stat(path)
    return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>, {
        status: 200,
        headers: {
            'Content-Type': mimeTypeForPath(relativePath),
            'Content-Length': String(metadata.size),
            ETag: etag,
            'Cache-Control': 'no-cache',
        },
    })
}

async function serveStaticFile(path: string, root: string): Promise<Response> {
    const absoluteRoot = resolve(root)
    const absolutePath = resolve(path)
    if (absolutePath !== absoluteRoot && !absolutePath.startsWith(`${absoluteRoot}${sep}`)) return textResponse('Forbidden', 403)
    try {
        const metadata = await stat(absolutePath)
        if (!metadata.isFile()) return textResponse('Not found', 404)
        return new Response(Readable.toWeb(createReadStream(absolutePath)) as ReadableStream<Uint8Array>, {
            status: 200,
            headers: {'Content-Type': mimeTypeForPath(absolutePath), 'Content-Length': String(metadata.size)},
        })
    } catch (error) {
        if (isMissing(error)) return textResponse('Not found', 404)
        throw error
    }
}

function decodeFilePath(pathname: string): string {
    let decoded: string
    try { decoded = decodeURIComponent(pathname.slice('/files/'.length)) } catch { throw new InvalidProjectPathError('Invalid project path encoding') }
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

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function textResponse(body: string, status = 200): Response {
    return new Response(body || null, {
        status,
        headers: body ? {'Content-Type': 'text/plain; charset=utf-8'} : undefined,
    })
}

function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}): Response {
    const text = JSON.stringify(body)
    return new Response(text, {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': String(Buffer.byteLength(text)),
            ...Object.fromEntries(new Headers(headers)),
        },
    })
}

function missingFileResponse(): Response {
    return jsonResponse({error: {code: 'not_found', message: 'File not found.'}}, 404)
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
    const text = await request.text()
    if (!text) return {}
    const body = JSON.parse(text) as unknown
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('JSON body must be an object')
    return body as Record<string, unknown>
}

async function resolvePackageDirectory(packageName: string): Promise<string> {
    return dirname(serverRequire.resolve(`${packageName}/package.json`))
}
