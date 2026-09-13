import {spawn} from 'node:child_process'
import {randomBytes, randomUUID} from 'node:crypto'
import {closeSync, openSync} from 'node:fs'
import {mkdir, open, readFile, rename, unlink, writeFile} from 'node:fs/promises'
import type {Server} from 'node:http'
import {homedir} from 'node:os'
import {resolve} from 'node:path'
import {serve} from '@hono/node-server'
import {Hono} from 'hono'
import {LinearRouter} from 'hono/router/linear-router'
import openBrowser from 'open'
import {mountHubRoutes, processIsAlive} from './hubRoutes.ts'
import {kite3dHomeDirectory} from './projectIndex.ts'
import {
    installLocalServerMiddleware,
    resolveEditorDirectory,
    serveEditorIndex,
    serveEditorPath,
    type LocalAppEnv,
} from './server.ts'

export interface HubServer {
    readonly server: Server
    readonly port: number
    readonly token: string
    readonly url: string
    close(): Promise<void>
}

export interface HubState {
    pid: number
    port: number
    url: string
    token: string
}

const hubStartTimeoutMilliseconds = 60_000
const hubStopTimeoutMilliseconds = 5_000

export async function createHubServer(port = 4320): Promise<HubServer> {
    const token = randomBytes(24).toString('base64url')
    const editorDirectory = await resolveEditorDirectory()
    const app = new Hono<LocalAppEnv>({router: new LinearRouter()})
    installLocalServerMiddleware(app, token)
    app.get('/', (c) => serveEditorIndex(c.req.raw, token, editorDirectory))
    app.get('/index.html', (c) => serveEditorIndex(c.req.raw, token, editorDirectory))
    app.get('/favicon.ico', () => serveEditorPath('/favicon.ico', editorDirectory))
    app.get('/api/state', () => jsonResponse({hub: true}))
    mountHubRoutes(app)
    app.get('*', (c) => serveEditorPath(new URL(c.req.url).pathname, editorDirectory))
    app.onError(() => jsonResponse({error: {code: 'internal_error', message: 'Internal server error'}}, 500))
    app.notFound(() => new Response('Not found', {status: 404}))

    let server!: Server
    for (let attempt = 0; attempt < 20; attempt += 1) {
        server = serve({fetch: app.fetch, port: port + attempt, hostname: '127.0.0.1'}) as Server
        try {
            await waitForListening(server)
            break
        } catch (error) {
            if (errorCode(error) !== 'EADDRINUSE') throw error
            if (attempt === 19) throw new Error(`Ports ${port}-${port + 19} are already in use.`)
        }
    }
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Unable to determine hub server address')
    const url = `http://127.0.0.1:${address.port}/?t=${encodeURIComponent(token)}`
    await writeHubState({pid: process.pid, port: address.port, url, token})
    let closing = false
    return {
        server,
        port: address.port,
        token,
        url,
        async close() {
            if (closing) return
            closing = true
            const closed = new Promise<void>((resolveClose, reject) => {
                server.close((error) => error ? reject(error) : resolveClose())
            })
            server.closeIdleConnections()
            server.closeAllConnections()
            await closed
            await removeHubFileIfOwned(process.pid, token)
        },
    }
}

export async function openProjectHub(options: {
    cliPath?: string
    noOpen?: boolean
} = {}): Promise<string> {
    let state = await readHubState()
    if (!state) {
        const release = await acquireHubStartupLock()
        try {
            state = await readHubState()
            if (!state) {
                await unlink(resolve(kite3dHomeDirectory(), 'hub.json')).catch(() => undefined)
                await mkdir(kite3dHomeDirectory(), {recursive: true})
                const log = openSync(resolve(kite3dHomeDirectory(), 'hub.log'), 'a', 0o600)
                let child
                try {
                    child = spawn(process.execPath, [resolve(options.cliPath || process.argv[1]), 'open', '--no-open'], {
                        cwd: homedir(),
                        detached: true,
                        env: {...process.env, KITE3D_HUB_SERVER: '1'},
                        stdio: ['ignore', log, log],
                    })
                    child.unref()
                } finally {
                    closeSync(log)
                }
                state = await waitForHubState(hubStartTimeoutMilliseconds, () => child?.exitCode)
            }
        } finally {
            await release()
        }
    }
    if (!options.noOpen) await openBrowser(state.url)
    return state.url
}

export async function stopProjectHub(): Promise<boolean> {
    const state = await readHubState()
    if (!state) {
        await unlink(resolve(kite3dHomeDirectory(), 'hub.json')).catch(() => undefined)
        return false
    }
    try {
        process.kill(state.pid, 'SIGTERM')
    } catch (error) {
        if (errorCode(error) !== 'ESRCH') throw error
    }
    const stopped = await waitForProcessExit(state.pid, hubStopTimeoutMilliseconds)
    if (!stopped) {
        try { process.kill(state.pid, 'SIGKILL') } catch (error) {
            if (errorCode(error) !== 'ESRCH') throw error
        }
        if (!await waitForProcessExit(state.pid, 1_000)) {
            throw new Error(`Kite3D launcher pid ${state.pid} did not stop.`)
        }
    }
    await removeHubFileIfOwned(state.pid, state.token)
    return true
}

export async function readHubState(): Promise<HubState | null> {
    let value: Record<string, unknown>
    try {
        value = JSON.parse(await readFile(resolve(kite3dHomeDirectory(), 'hub.json'), 'utf8')) as Record<string, unknown>
    } catch {
        return null
    }
    if (typeof value.pid !== 'number' || !Number.isInteger(value.pid) || value.pid <= 0
        || typeof value.port !== 'number' || !Number.isInteger(value.port) || value.port < 1
        || typeof value.url !== 'string' || typeof value.token !== 'string'
        || !processIsAlive(value.pid)) return null
    try {
        const url = new URL(value.url)
        if (url.searchParams.get('t') !== value.token) return null
    } catch {
        return null
    }
    return {pid: value.pid, port: value.port, url: value.url, token: value.token}
}

async function writeHubState(state: HubState): Promise<void> {
    const home = kite3dHomeDirectory()
    await mkdir(home, {recursive: true})
    const temporary = resolve(home, `.hub-${process.pid}-${randomBytes(6).toString('hex')}.tmp`)
    try {
        await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {mode: 0o600})
        await rename(temporary, resolve(home, 'hub.json'))
    } finally {
        await unlink(temporary).catch(() => undefined)
    }
}

async function acquireHubStartupLock(): Promise<() => Promise<void>> {
    const home = kite3dHomeDirectory()
    const path = resolve(home, 'hub-start.lock')
    const owner = {pid: process.pid, created_at: new Date().toISOString(), id: randomUUID()}
    await mkdir(home, {recursive: true})
    for (let attempt = 0; attempt < 1_200; attempt += 1) {
        try {
            const handle = await open(path, 'wx', 0o600)
            try {
                await handle.writeFile(`${JSON.stringify(owner)}\n`, 'utf8')
            } finally {
                await handle.close()
            }
            return async () => {
                try {
                    const current = JSON.parse(await readFile(path, 'utf8')) as {id?: unknown}
                    if (current.id === owner.id) await unlink(path)
                } catch { /* already released or replaced */ }
            }
        } catch (error) {
            if (errorCode(error) !== 'EEXIST') throw error
            let current: {pid?: unknown, created_at?: unknown} = {}
            try { current = JSON.parse(await readFile(path, 'utf8')) as typeof current } catch { /* replace below */ }
            const createdAt = typeof current.created_at === 'string' ? Date.parse(current.created_at) : Number.NaN
            if (typeof current.pid !== 'number' || !Number.isInteger(current.pid) || !processIsAlive(current.pid)
                || !Number.isFinite(createdAt) || Date.now() - createdAt > hubStartTimeoutMilliseconds) {
                await unlink(path).catch(() => undefined)
                continue
            }
            await new Promise((resolveWait) => setTimeout(resolveWait, 50))
        }
    }
    throw new Error('Timed out waiting to start the Kite3D launcher.')
}

async function waitForHubState(
    timeoutMilliseconds: number,
    exitCode: () => number | null | undefined,
): Promise<HubState> {
    const started = Date.now()
    for (;;) {
        const state = await readHubState()
        if (state) return state
        const code = exitCode()
        if (code !== undefined && code !== null) throw new Error(`Kite3D launcher exited with code ${code} before it became ready.`)
        if (Date.now() - started >= timeoutMilliseconds) throw new Error('Timed out waiting for the Kite3D launcher.')
        await new Promise((resolveWait) => setTimeout(resolveWait, 100))
    }
}

async function waitForProcessExit(pid: number, timeoutMilliseconds: number): Promise<boolean> {
    const started = Date.now()
    while (processIsAlive(pid)) {
        if (Date.now() - started >= timeoutMilliseconds) return false
        await new Promise((resolveWait) => setTimeout(resolveWait, 50))
    }
    return true
}

async function removeHubFileIfOwned(pid: number, token: string): Promise<void> {
    const path = resolve(kite3dHomeDirectory(), 'hub.json')
    try {
        const value = JSON.parse(await readFile(path, 'utf8')) as {pid?: unknown, token?: unknown}
        if (value.pid === pid && value.token === token) await unlink(path)
    } catch { /* already removed or replaced */ }
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

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {'Content-Type': 'application/json; charset=utf-8'},
    })
}

function errorCode(error: unknown): string | undefined {
    return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : undefined
}
