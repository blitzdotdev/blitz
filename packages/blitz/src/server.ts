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
import type {Server} from 'node:http'
import {createRequire} from 'node:module'
import {basename, dirname, resolve, sep} from 'node:path'
import {Readable} from 'node:stream'
import {pipeline} from 'node:stream/promises'
import {fileURLToPath} from 'node:url'
import {serve, type HttpBindings} from '@hono/node-server'
import {mimeTypeForPath} from '@blitzdev/engine/fileTypes'
import {dependencyImportMap, projectDependencies} from '@blitzdev/engine/importMap'
import {BLITZ_SERVER_CLIENT_ID, JOURNAL_PATH} from '@blitzdev/engine/paths'
import {Hono, type Context, type Next} from 'hono'
import {getCookie} from 'hono/cookie'
import {LinearRouter} from 'hono/router/linear-router'
import {streamSSE, type SSEStreamingApi} from 'hono/streaming'
import {checkBakeSafety, type BakeJournalEntry} from './bake.ts'
import {appendSceneJournal} from './journal.ts'
import {NodeProjectDirectory} from './node-filesystem.ts'
import {readDeploys, writeDeploys} from './deploys.ts'
import {sanitizeDiagnostic} from './api.ts'
import {ProjectModuleRewriter} from './module-rewriter.ts'
import type {PublishProgress} from './types.ts'
import {BLITZ_VERSION, EDITOR_VERSION, ENGINE_VERSION} from './versions.ts'

export interface ManifestEntry {
    path: string
    size: number
    sha256: string
    mtime: number
}

export interface DevServerOptions {
    projectRoot?: string
    port?: number
    strictPort?: boolean
    open?: boolean
    backendUrl?: string
    publish?: (
        options: {slug?: string, name?: string, message?: string},
        emit: (data: PublishProgress) => void,
    ) => Promise<{preview_url: string, release_hash: string}>
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

interface CommandResult {
    ok: boolean
    error?: string
    [key: string]: unknown
}

interface PendingCommand {
    resolve: (result: CommandResult) => void
    timer: ReturnType<typeof setTimeout>
}

const excludedDirectories = new Set(['.git', 'node_modules', 'dist'])
const protectedProjectPaths = new Set(['.blitz/deploys.json', '.blitz/dev.json'])
const DEFAULT_BACKEND_URL = 'https://blitz-backend.blitzapp.workers.dev'
const serverRequire = createRequire(import.meta.url)

export async function createDevServer(options: DevServerOptions = {}): Promise<DevServer> {
    const projectRoot = await realpath(resolve(options.projectRoot || process.cwd()))
    const token = randomBytes(24).toString('base64url')
    const editorDirectory = await resolvePackageDirectory('@blitzdev/editor') + '/dist'
    const clients = new Map<SSEStreamingApi, string | undefined>()
    const pendingCommands = new Map<string, PendingCommand>()
    const pendingEvents = new Map<string, PendingEvent>()
    const knownHashes = new Map<string, string>()
    const moduleRewriter = new ProjectModuleRewriter()
    let {path: mainScenePath, text: lastSceneText} = await readMainSceneSnapshot(projectRoot)
    let sceneJournalQueue = Promise.resolve()
    let serverMutationActive = false
    let mutationQueue = Promise.resolve()
    let watcher: FSWatcher | undefined
    let closing = false
    let platformToken: string | undefined
    let publishActive = false
    const backendUrl = (options.backendUrl || process.env.BLITZ_BACKEND_URL || DEFAULT_BACKEND_URL).replace(/\/+$/, '')
    const projectDirectory = new NodeProjectDirectory(projectRoot).asHandle()

    for (const entry of await buildManifest(projectRoot)) knownHashes.set(entry.path, entry.sha256)

    type AppEnv = {Bindings: HttpBindings, Variables: {clientId: string | undefined}}
    const app = new Hono<AppEnv>({router: new LinearRouter()})

    app.use('*', async (c, next) => {
        if (!isLocalHost(c.req.header('Host'))) return textResponse('Invalid Host', 403)
        c.set('clientId', c.req.header('X-Blitz-Client'))
        await next()
    })
    app.use('/api/*', checkToken)
    app.use('/files/*', checkToken)

    async function checkToken(c: Context<AppEnv>, next: Next): Promise<void | Response> {
        const queryToken = c.req.method === 'GET' ? c.req.query('t') : undefined
        if (c.req.header('X-Blitz-Token') !== token && getCookie(c, 'blitz-token') !== token && queryToken !== token) {
            return textResponse('Missing or invalid Blitz token', 401)
        }
        return next()
    }

    const serveIndex = async (c: Context<AppEnv>) => {
        if (new URL(c.req.url).searchParams.get('t') !== token) return textResponse('Missing or invalid Blitz token', 401)
        const source = new URL(c.req.url).searchParams.get('headless') === 'check'
            ? headlessCheckHtml()
            : await readFile(resolve(editorDirectory, 'index.html'), 'utf8')
        const response = new Response(await injectProjectImportMap(source, projectRoot), {
            headers: {'Content-Type': 'text/html; charset=utf-8'},
        })
        response.headers.set('Set-Cookie', `blitz-token=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/`)
        return response
    }
    app.get('/', serveIndex)
    app.get('/index.html', serveIndex)
    app.get('/favicon.ico', () => serveStaticFile(resolve(editorDirectory, 'favicon.ico'), editorDirectory))
    app.get('/api/import-map', async () => jsonResponse(await readProjectImportMap(projectRoot)))
    app.get('/api/files', async () => jsonResponse(await buildManifest(projectRoot)))
    app.get('/api/state', async () => jsonResponse(await projectState(projectRoot)))
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
    app.get('/api/slug/:slug', async (c) => proxyBackendJson(
        `${backendUrl}/api/v1/slugs/${encodeURIComponent(c.req.param('slug'))}`,
    ))
    app.get('/api/deploys', async () => {
        const deploys = await readDeploys(projectDirectory)
        return jsonResponse({
            games: Object.entries(deploys.games).map(([slug, entry]) => ({
                game_id: entry.game_id,
                slug,
                preview_url: entry.preview_url,
                expires_at: entry.expires_at,
                last_release_hash: entry.last_release_hash,
                claimed: entry.claimed === true,
            })),
            last_publish: deploys.last_publish,
        })
    })
    for (const mode of ['register', 'login'] as const) {
        app.post(`/api/auth/${mode}`, async (c) => {
            const body = await readJsonBody(c.req.raw)
            const backendResponse = await fetch(`${backendUrl}/api/v1/auth/${mode}`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(body),
            })
            const payload = await readBackendPayload(backendResponse)
            if (!backendResponse.ok) return backendJson(backendResponse, payload)
            if (!isRecord(payload) || typeof payload.token !== 'string') {
                return jsonResponse({error: {code: 'invalid_backend_response', message: 'The Blitz backend returned an invalid authentication response.'}}, 502)
            }
            platformToken = payload.token
            return jsonResponse({user: payload.user, token: payload.token}, backendResponse.status)
        })
    }
    app.post('/api/claim', async (c) => {
        if (!platformToken) return jsonResponse({error: {code: 'authentication_required', message: 'Sign in before claiming a game.'}}, 401)
        const body = await readJsonBody(c.req.raw)
        const slug = typeof body.slug === 'string' ? body.slug : ''
        const deploys = await readDeploys(projectDirectory)
        const entry = deploys.games[slug]
        if (!entry) return jsonResponse({error: {code: 'deploy_not_found', message: `No local deploy exists for ${slug}.`}}, 404)
        const backendResponse = await fetch(`${backendUrl}/api/v1/games/${encodeURIComponent(slug)}/claim`, {
            method: 'POST',
            headers: {'Authorization': `Bearer ${platformToken}`, 'Content-Type': 'application/json'},
            body: JSON.stringify({secret: entry.claim_secret}),
        })
        const payload = await readBackendPayload(backendResponse)
        if (!backendResponse.ok) {
            const safePayload = JSON.parse(sanitizeDiagnostic(
                JSON.stringify(payload),
                [platformToken, entry.deploy_token, entry.claim_secret],
            )) as unknown
            return backendJson(backendResponse, safePayload)
        }
        deploys.games[slug] = {...entry, claimed: true}
        await writeDeploys(projectDirectory, deploys)
        return jsonResponse(payload, backendResponse.status)
    })
    app.post('/api/bake', async (c) => {
        const body = await readJsonBody(c.req.raw)
        const nodeName = typeof body.nodeName === 'string' ? body.nodeName.trim() : ''
        const force = body.force === true
        if (!nodeName) return jsonResponse({error: {code: 'invalid_node', message: 'nodeName is required.'}}, 400)
        if (![...clients.values()].some(Boolean)) {
            return jsonResponse({error: {code: 'editor_not_connected', message: 'No editor is connected. Open the URL from blitz dev and try again.'}}, 409)
        }
        const {document, journal} = await readBakeInputs(projectRoot)
        const safety = checkBakeSafety(document, nodeName, journal, force)
        if (!safety.ok) return jsonResponse({error: {code: safety.code, message: safety.reason}}, 409)

        const id = randomBytes(16).toString('hex')
        const result = await new Promise<CommandResult>((resolveCommand) => {
            const timer = setTimeout(() => {
                pendingCommands.delete(id)
                resolveCommand({ok: false, error: 'The connected editor did not finish the bake within 30 seconds.'})
            }, 30_000)
            pendingCommands.set(id, {resolve: resolveCommand, timer})
            void broadcast('command', {id, command: 'bake', nodeName, force})
        })
        return result.ok
            ? jsonResponse(result)
            : jsonResponse({error: {code: 'bake_failed', message: result.error || 'Bake failed.'}}, 409)
    })
    app.post('/api/check', async () => {
        if (![...clients.values()].some(Boolean)) {
            return jsonResponse({error: {code: 'editor_not_connected', message: 'No editor is connected.'}}, 409)
        }
        const id = randomBytes(16).toString('hex')
        const result = await new Promise<CommandResult>((resolveCommand) => {
            const timer = setTimeout(() => {
                pendingCommands.delete(id)
                resolveCommand({ok: false, error: 'The connected editor did not finish the check within 60 seconds.'})
            }, 60_000)
            pendingCommands.set(id, {resolve: resolveCommand, timer})
            void broadcast('command', {id, command: 'check'})
        })
        return result.ok
            ? jsonResponse(result)
            : jsonResponse({error: {code: 'check_failed', message: result.error || 'Check failed.'}, ...result}, 409)
    })
    app.post('/api/commands/:id', async (c) => {
        const id = c.req.param('id')
        if (!/^[a-f\d]+$/.test(id)) return jsonResponse({error: {code: 'command_not_found', message: 'Command is no longer pending.'}}, 404)
        const pending = pendingCommands.get(id)
        if (!pending) return jsonResponse({error: {code: 'command_not_found', message: 'Command is no longer pending.'}}, 404)
        const body = await readJsonBody(c.req.raw) as CommandResult
        clearTimeout(pending.timer)
        pendingCommands.delete(id)
        pending.resolve({...body, ok: body.ok === true})
        return jsonResponse({accepted: true}, 202)
    })
    app.post('/api/publish', async (c) => {
        if (!options.publish) return jsonResponse({error: {code: 'publish_unavailable', message: 'Publish is not configured.'}}, 501)
        const body = await readJsonBody(c.req.raw)
        if (publishActive) return jsonResponse({error: {code: 'publish_locked', message: 'Another publish is already running.'}}, 409)
        publishActive = true
        return streamSSE(c, async (stream) => {
            let writes = Promise.resolve()
            const writeEvent = (event: string, data: unknown) => {
                writes = writes.then(() => stream.writeSSE({event, data: JSON.stringify(data)})).catch(() => undefined)
            }
            try {
                const result = await runServerMutation(() => options.publish!(
                    {
                        slug: typeof body.slug === 'string' ? body.slug : undefined,
                        name: typeof body.name === 'string' ? body.name : undefined,
                        message: typeof body.message === 'string' ? body.message : undefined,
                    },
                    (data) => {
                        writeEvent('publish:progress', data)
                        void broadcast('publish:progress', data)
                    },
                ))
                await writes
                await stream.writeSSE({event: 'publish:result', data: JSON.stringify(result)})
            } catch (error) {
                await writes
                await stream.writeSSE({event: 'publish:error', data: JSON.stringify({
                    status: httpErrorStatus(error) ?? 500,
                    code: httpErrorCode(error) ?? 'publish_failed',
                    message: sanitizeDiagnostic(error instanceof Error ? error.message : error),
                })})
            } finally {
                publishActive = false
            }
        })
    })
    app.post('/api/pull', async () => {
        if (!options.pull) return jsonResponse({error: {code: 'pull_unavailable', message: 'Pull is not configured.'}}, 501)
        return jsonResponse(await runServerMutation(options.pull))
    })
    app.get('/files/*', async (c) => {
        const relativePath = decodeFilePath(new URL(c.req.url).pathname)
        const filePath = await safeProjectPath(projectRoot, relativePath, true)
        if (!(await fileExists(filePath))) return missingFileResponse()
        return serveProjectFile(c.req.raw, filePath, relativePath, moduleRewriter, async (targetPath) => {
            try {
                const target = await safeProjectPath(projectRoot, targetPath)
                if (!(await stat(target)).isFile()) return undefined
                return await hashFile(target)
            } catch {
                return undefined
            }
        })
    })
    app.put('/files/*', async (c) => {
        const relativePath = decodeFilePath(new URL(c.req.url).pathname)
        const filePath = await safeProjectPath(projectRoot, relativePath, true)
        const existed = await fileExists(filePath)
        const currentHash = existed ? await hashFile(filePath) : undefined
        const beforeSceneText = relativePath === mainScenePath && existed ? await readFile(filePath, 'utf8') : undefined
        const ifMatch = c.req.header('If-Match')
        if (!ifMatch || (ifMatch !== '*' && ifMatch !== quoteHash(currentHash))) {
            return jsonResponse({error: {code: 'precondition_failed', message: 'The file changed on disk.'}, sha256: currentHash}, 412)
        }
        await mkdir(dirname(filePath), {recursive: true})
        const temporary = resolve(dirname(filePath), `.${basename(filePath)}.blitz-${randomBytes(8).toString('hex')}`)
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
        if (relativePath === mainScenePath) {
            const afterSceneText = await readFile(filePath, 'utf8')
            const client = pendingCommands.size ? 'blitz-bake' : c.get('clientId') || 'external'
            await recordSceneWrite(beforeSceneText, afterSceneText, client)
        } else if (relativePath === 'package.json') {
            const snapshot = await readMainSceneSnapshot(projectRoot)
            mainScenePath = snapshot.path
            lastSceneText = snapshot.text
        }
        scheduleEvent(relativePath, c.get('clientId'), existed ? 'change' : 'add')
        return jsonResponse({path: relativePath, sha256}, existed ? 200 : 201)
    })
    app.delete('/files/*', async (c) => {
        const relativePath = decodeFilePath(new URL(c.req.url).pathname)
        const filePath = await safeProjectPath(projectRoot, relativePath, true)
        if (!(await fileExists(filePath))) return missingFileResponse()
        await unlink(filePath)
        knownHashes.delete(relativePath)
        scheduleEvent(relativePath, c.get('clientId'), 'unlink')
        return new Response(null, {status: 204})
    })
    app.get('*', async (c) => {
        const relative = decodeURIComponent(new URL(c.req.url).pathname.slice(1))
        if (relative && !relative.includes('..') && !relative.includes('\\')) {
            const staticPath = resolve(editorDirectory, relative)
            if (staticPath.startsWith(`${resolve(editorDirectory)}${sep}`)) {
                return serveStaticFile(staticPath, editorDirectory)
            }
        }
        return textResponse('Not found', 404)
    })
    app.onError((error) => {
        const rawMessage = error instanceof Error ? error.message : 'Internal server error'
        const status = httpErrorStatus(error) ?? (isMissing(error) ? 404 : (/Invalid project path|forbidden|symlink|escape/i.test(rawMessage) ? 403 : 500))
        const code = status === 404
            ? 'not_found'
            : httpErrorCode(error) ?? (status === 403 ? 'invalid_path' : 'internal_error')
        const message = status === 404 ? 'File not found.' : status === 500 ? 'Internal server error' : rawMessage
        return jsonResponse({error: {code, message}}, status)
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
            await broadcast(type, {path, sha256, client: effectiveClient})
        }, 150)
        pendingEvents.set(path, {path, client: effectiveClient, forcedType: effectiveType, timer})
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

    await mkdir(resolve(projectRoot, '.blitz'), {recursive: true})
    await writeDevFile(projectRoot, {url, port, token, pid: process.pid, started_at: new Date().toISOString()})
    try {
        watcher = watch(projectRoot, {recursive: true}, (_event, filename) => {
            if (!filename) return
            const path = normalizeRelativePath(filename.toString())
            if (!path || !isIncludedPath(path)) return
            if (serverMutationActive) return
            void scheduleWatchedFile(path)
        })
        watcher.on('error', (error) => console.warn(`[blitz] watcher: ${error.message}`))
    } catch (error) {
        console.warn(`[blitz] file watching is unavailable: ${error instanceof Error ? error.message : error}`)
    }
    const keepAlive = setInterval(() => {
        for (const client of clients.keys()) void client.write(': keepalive\n\n')
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
            await Promise.all([...clients.keys()].map((client) => client.close()))
            for (const command of pendingCommands.values()) {
                clearTimeout(command.timer)
                command.resolve({ok: false, error: 'The development server closed before the command finished.'})
            }
            pendingCommands.clear()
            await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()))
            await unlink(resolve(projectRoot, '.blitz/dev.json')).catch(() => undefined)
        },
    }

    async function scheduleWatchedFile(path: string): Promise<void> {
        try {
            const target = await safeProjectPath(projectRoot, path)
            const metadata = await lstat(target)
            if (!metadata.isFile()) return
            if (await hashFile(target) === knownHashes.get(path)) return
            if (path === mainScenePath) {
                const current = await readFile(target, 'utf8')
                await recordSceneWrite(lastSceneText, current, 'external', true)
            } else if (path === 'package.json') {
                const snapshot = await readMainSceneSnapshot(projectRoot)
                mainScenePath = snapshot.path
                lastSceneText = snapshot.text
            }
        } catch (error) {
            // A missing path is an unlink only when it was previously a file in
            // the manifest. Recursive watchers also report removed directories.
            if (!isMissing(error) || !knownHashes.has(path)) return
        }
        scheduleEvent(path)
    }

    function recordSceneWrite(
        before: string | undefined,
        after: string,
        client: string,
        deduplicate = false,
    ): Promise<void> {
        const task = sceneJournalQueue.then(async () => {
            if (deduplicate && after === lastSceneText) return
            await appendSceneJournal(projectRoot, deduplicate ? lastSceneText : before, after, client)
            lastSceneText = after
        })
        sceneJournalQueue = task.catch(() => undefined)
        return task
    }

    function runServerMutation<T>(operation: () => Promise<T>): Promise<T> {
        const run = mutationQueue.then(async () => {
            const before = manifestHashes(await buildManifest(projectRoot))
            serverMutationActive = true
            try {
                return await operation()
            } finally {
                try {
                    const after = manifestHashes(await buildManifest(projectRoot))
                    const changedPaths = new Set([...before.keys(), ...after.keys()])
                    for (const path of changedPaths) {
                        const previous = before.get(path)
                        const current = after.get(path)
                        if (previous === current) continue
                        if (path === mainScenePath && current) {
                            const after = await readFile(resolve(projectRoot, path), 'utf8')
                            await recordSceneWrite(lastSceneText, after, BLITZ_SERVER_CLIENT_ID, true)
                        }
                        scheduleEvent(path, BLITZ_SERVER_CLIENT_ID, current ? (previous ? 'change' : 'add') : 'unlink')
                    }
                } finally {
                    serverMutationActive = false
                }
            }
        })
        mutationQueue = run.then(() => undefined, () => undefined)
        return run
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

async function readMainSceneSnapshot(root: string): Promise<{path: string, text?: string}> {
    let path = 'assets/main.scene.gltf'
    try {
        const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as {mainScene?: unknown}
        if (typeof packageJson.mainScene === 'string') path = normalizeRelativePath(packageJson.mainScene)
    } catch { /* use the default path */ }
    try {
        const scenePath = await safeProjectPath(root, path)
        return {path, text: await readFile(scenePath, 'utf8')}
    } catch {
        return {path}
    }
}

async function readBakeInputs(root: string): Promise<{
    document: Parameters<typeof checkBakeSafety>[0]
    journal: BakeJournalEntry[]
}> {
    const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as {mainScene?: unknown}
    if (typeof packageJson.mainScene !== 'string') throw new Error('package.json mainScene must be a string')
    const scenePath = await safeProjectPath(root, packageJson.mainScene)
    const document = JSON.parse(await readFile(scenePath, 'utf8')) as Parameters<typeof checkBakeSafety>[0]
    let journal: BakeJournalEntry[] = []
    try {
        journal = (await readFile(resolve(root, JOURNAL_PATH), 'utf8'))
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line) as BakeJournalEntry)
    } catch (error) {
        if (!isMissing(error)) throw error
    }
    return {document, journal}
}

function manifestHashes(entries: ManifestEntry[]): Map<string, string> {
    return new Map(entries.map(({path, sha256}) => [path, sha256]))
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
    const normalized = normalizeRelativePath(path)
    if (protectedProjectPaths.has(normalized)) return false
    const parts = normalized.split('/')
    if (parts.some((part) => excludedDirectories.has(part))) return false
    return !parts.some((part) => part.startsWith('.') && part !== '.blitz')
}

async function projectState(root: string) {
    let packageJson: Record<string, unknown> = {}
    try { packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as Record<string, unknown> } catch { /* optional */ }
    return {
        name: typeof packageJson.name === 'string' ? packageJson.name : basename(root),
        versions: {blitz: BLITZ_VERSION, editor: EDITOR_VERSION, engine: ENGINE_VERSION},
        server_version: BLITZ_VERSION,
    }
}

async function readProjectImportMap(root: string): Promise<{imports: Record<string, string>}> {
    const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as Record<string, unknown>
    return dependencyImportMap(projectDependencies(packageJson), '/editor-runtime.js')
}

function headlessCheckHtml(): string {
    return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Blitz check</title></head>
<body><canvas id="first" width="640" height="360"></canvas><canvas id="second" width="640" height="360"></canvas>
<script type="module">
import {
    authoringQualityReport,
    createGame,
    persistenceReport,
    semanticSceneSnapshot,
    serializeSceneGltf,
} from '@blitzdev/engine'

const started = performance.now()
const errors = []
const message = value => value instanceof Error ? value.message : String(value)
const consoleError = console.error.bind(console)
console.error = (...values) => {
    consoleError(...values)
    errors.push(values.map(message).join(' '))
}
addEventListener('error', event => errors.push(message(event.error || event.message)))
addEventListener('unhandledrejection', event => errors.push(message(event.reason)))

const codes = issues => [...new Set(issues.map(issue => issue.code))]
const runFrames = (viewer, target) => new Promise((resolve, reject) => {
    let frames = 0
    const timeout = setTimeout(() => {
        viewer.removeEventListener('preFrame', onFrame)
        reject(new Error('The game did not render ' + target + ' frames within 10 seconds.'))
    }, 10000)
    const onFrame = () => {
        frames += 1
        if (frames < target) {
            viewer.setDirty()
            return
        }
        clearTimeout(timeout)
        viewer.removeEventListener('preFrame', onFrame)
        resolve()
    }
    viewer.addEventListener('preFrame', onFrame)
    viewer.setDirty()
})

try {
    const base = new URL('/files/', location.href).href
    const first = await createGame({base, canvas: document.getElementById('first'), onError: error => errors.push(message(error))})
    const before = semanticSceneSnapshot(first.viewer)
    const editable = authoringQualityReport(first.viewer)
    const relationshipIssues = editable.issues.filter(issue =>
        issue.code === 'MISSING_AUTHORING_SOURCE' || issue.code === 'RUNTIME_SOURCE_DRIFT')
    const frameCount = Math.max(1, Number(new URL(location.href).searchParams.get('frames')) || 30)
    await runFrames(first.viewer, frameCount)
    const projectValidation = await first.runGameValidation()
    let serialized
    let serializationError
    try {
        serialized = await serializeSceneGltf(first.viewer, {scenePath: first.project.mainScene})
    } catch (error) {
        serializationError = message(error)
    }
    const cleanup = first.dispose()

    let persistence
    const networkFetch = window.fetch.bind(window)
    try {
        const savedFiles = new Map()
        if (serialized) {
            savedFiles.set(new URL(first.project.mainScene, base).href, serialized.gltf)
            for (const file of serialized.files) savedFiles.set(new URL(file.path, base).href, file.bytes)
            window.fetch = (input, init) => {
                const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href).href
                const bytes = savedFiles.get(url)
                return bytes
                    ? Promise.resolve(new Response(bytes, {headers: {'Content-Type': url.endsWith('.gltf') ? 'model/gltf+json' : 'application/octet-stream'}}))
                    : networkFetch(input, init)
            }
        }
        const second = await createGame({base, canvas: document.getElementById('second'), onError: error => errors.push(message(error))})
        persistence = persistenceReport(before, semanticSceneSnapshot(second.viewer))
        const secondCleanup = second.dispose()
        if (!secondCleanup.ok) cleanup.issues.push(...secondCleanup.issues)
    } catch (error) {
        persistence = {
            ok: false,
            issues: [{code: 'PERSISTENCE_DRIFT', severity: 'error', message: 'Reload failed: ' + message(error)}],
            summary: 'Reload failed: ' + message(error),
        }
    } finally {
        window.fetch = networkFetch
    }

    const cleanupErrors = cleanup.issues.filter(issue => issue.severity === 'error')
    const playableOk = errors.length === 0 && projectValidation.ok && relationshipIssues.length === 0 && cleanupErrors.length === 0
    const playableReasons = [
        errors.length ? errors.length + ' runtime error(s).' : '',
        !projectValidation.ok ? projectValidation.summary : '',
        relationshipIssues.length ? relationshipIssues.length + ' runtime source issue(s).' : '',
        cleanupErrors.length ? cleanupErrors.length + ' cleanup issue(s).' : '',
    ].filter(Boolean)
    window.__blitzCheckResult = {
        ok: playableOk && editable.ok && persistence.ok && !serializationError,
        mode: 'headless',
        outcomes: [
            {
                name: 'Playable', status: playableOk ? 'pass' : 'fail',
                summary: playableOk ? 'The game booted and ran ' + frameCount + ' frames without errors.' : playableReasons.join(' '),
                codes: codes([...relationshipIssues, ...cleanupErrors]), durationMs: Math.round(performance.now() - started),
            },
            {
                name: 'Editable', status: editable.ok ? 'pass' : 'fail', summary: editable.summary,
                codes: codes(editable.issues), report: editable,
            },
            {
                name: 'Persisted', status: persistence.ok && !serializationError ? 'pass' : 'fail',
                summary: serializationError ? 'Serialization failed: ' + serializationError : persistence.summary,
                codes: codes(persistence.issues), report: persistence,
            },
        ],
    }
} catch (error) {
    const summary = 'Headless check failed: ' + message(error)
    window.__blitzCheckResult = {
        ok: false,
        mode: 'headless',
        outcomes: ['Playable', 'Editable', 'Persisted'].map(name => ({name, status: 'fail', summary, codes: []})),
    }
} finally {
    window.__blitzCheckDone = true
}
</script></body></html>`
}

async function injectProjectImportMap(html: string, root: string): Promise<string> {
    const importMap = JSON.stringify(await readProjectImportMap(root)).replace(/</g, '\\u003c')
    const script = `<script type="importmap">${importMap}</script>`
    if (/<script type="importmap">.*?<\/script>/s.test(html)) {
        return html.replace(/<script type="importmap">.*?<\/script>/s, script)
    }
    return html.replace('</head>', `${script}\n</head>`)
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

async function proxyBackendJson(url: string, init?: RequestInit): Promise<Response> {
    const backendResponse = await fetch(url, init)
    return backendJson(backendResponse, await readBackendPayload(backendResponse))
}

async function readBackendPayload(response: Response): Promise<unknown> {
    const text = await response.text()
    if (!text) return {}
    try { return JSON.parse(text) as unknown } catch {
        return {error: {code: `http_${response.status}`, message: text}}
    }
}

function backendJson(backendResponse: Response, payload: unknown): Response {
    const retryAfter = backendResponse.headers.get('Retry-After')
    return jsonResponse(payload, backendResponse.status, retryAfter ? {'Retry-After': retryAfter} : {})
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function httpErrorStatus(error: unknown): number | undefined {
    if (!isRecord(error)) return undefined
    return typeof error.status === 'number' && error.status >= 400 && error.status <= 599 ? error.status : undefined
}

function httpErrorCode(error: unknown): string | undefined {
    if (!isRecord(error)) return undefined
    return typeof error.code === 'string' ? error.code : undefined
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
    const text = await request.text()
    if (!text) return {}
    const body = JSON.parse(text) as unknown
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('JSON body must be an object')
    return body as Record<string, unknown>
}

async function writeDevFile(root: string, value: unknown): Promise<void> {
    const {writeFile} = await import('node:fs/promises')
    await writeFile(resolve(root, '.blitz/dev.json'), `${JSON.stringify(value, null, 2)}\n`, {mode: 0o600})
}

async function resolvePackageDirectory(packageName: string): Promise<string> {
    return dirname(serverRequire.resolve(`${packageName}/package.json`))
}
