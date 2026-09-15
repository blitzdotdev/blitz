import {spawn, type ChildProcess} from 'node:child_process'
import {randomBytes} from 'node:crypto'
import {closeSync, openSync} from 'node:fs'
import {mkdir, readFile, rename, unlink, writeFile} from 'node:fs/promises'
import {dirname, resolve} from 'node:path'
import {kite3dHome} from './home.ts'

const startTimeoutMilliseconds = 60_000

// What a running server writes so another process can find it and talk to it.
export interface ServerState {
    pid: number
    port: number
    url: string
    token: string
}

// A project server writes it next to its project, the launcher writes it to the kite3d home,
// because kite3d open must find the launcher without being in a project.
export function serverStatePath(projectRoot: string | undefined): string {
    return projectRoot ? resolve(projectRoot, '.kite3d/dev.json') : resolve(kite3dHome(), 'hub.json')
}

// The server this file describes, or null when the file is absent, unreadable, or names a pid
// that is gone. A crashed server leaves the file behind, and that reads as stopped.
export async function readRunningServer(path: string): Promise<ServerState | null> {
    const state = await readServerState(path)
    return state && processIsAlive(state.pid) ? state : null
}

// The server already serving this project keeps the claim. kite3d screenshot --headless starts a
// second server for a few seconds, and without this it took the file and deleted it on the way out,
// which left the real server running and invisible to the picker.
export async function writeServerState(path: string, state: ServerState): Promise<void> {
    const current = await readRunningServer(path)
    if (current && current.pid !== state.pid) return
    await mkdir(dirname(path), {recursive: true})
    const temporary = resolve(dirname(path), `.${randomBytes(6).toString('hex')}.tmp`)
    try {
        await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {mode: 0o600})
        await rename(temporary, path)
    } catch (error) {
        await unlink(temporary).catch(() => undefined)
        throw error
    }
}

// Only the server that wrote the file removes it, so a server that took the place of a crashed
// one keeps its own file when the crashed one's shutdown runs late.
export async function removeServerState(path: string, state: ServerState): Promise<void> {
    const current = await readServerState(path)
    if (current?.pid === state.pid && current.token === state.token) await unlink(path).catch(() => undefined)
}

// One detached server start: spawn it with its own log, then wait for the state file it writes.
// The subject opens the failure sentence, so an error names the server that did not start.
export async function startDetachedServer({argv, cwd, env, logPath, statePath, subject}: {
    argv: string[]
    cwd: string
    env?: NodeJS.ProcessEnv
    logPath: string
    statePath: string
    subject: string
}): Promise<ServerState> {
    await mkdir(dirname(logPath), {recursive: true})
    const log = openSync(logPath, 'a', 0o600)
    let child: ChildProcess
    try {
        child = spawn(process.execPath, argv, {cwd, detached: true, env, stdio: ['ignore', log, log]})
        child.unref()
    } finally {
        closeSync(log)
    }
    const deadline = Date.now() + startTimeoutMilliseconds
    while (Date.now() < deadline) {
        const state = await readRunningServer(statePath)
        if (state) return state
        if (child.exitCode !== null || child.signalCode !== null) {
            throw new Error(`${subject} stopped at once. Read ${logPath}.`)
        }
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
    }
    child.kill('SIGTERM')
    throw new Error(`${subject} did not answer in ${startTimeoutMilliseconds / 1_000} seconds. Read ${logPath}.`)
}

// SIGTERM, five seconds, then SIGKILL. False when nothing was running, which also drops a stale file.
export async function stopServer(path: string): Promise<boolean> {
    const state = await readRunningServer(path)
    if (!state) {
        await unlink(path).catch(() => undefined)
        return false
    }
    signal(state.pid, 'SIGTERM')
    if (!await waitForExit(state.pid, 5_000)) {
        signal(state.pid, 'SIGKILL')
        if (!await waitForExit(state.pid, 1_000)) throw new Error(`The server with pid ${state.pid} did not stop.`)
    }
    // A killed server cannot clean up after itself.
    await removeServerState(path, state)
    return true
}

function processIsAlive(pid: number): boolean {
    try {
        process.kill(pid, 0)
        return true
    } catch (error) {
        // EPERM means the pid exists and belongs to another user.
        return error instanceof Error && 'code' in error && error.code === 'EPERM'
    }
}

function signal(pid: number, name: 'SIGTERM' | 'SIGKILL'): void {
    try {
        process.kill(pid, name)
    } catch (error) {
        // The server stopped between the liveness check and the signal.
        if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error
    }
}

async function waitForExit(pid: number, timeoutMilliseconds: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMilliseconds
    while (processIsAlive(pid)) {
        if (Date.now() >= deadline) return false
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 50))
    }
    return true
}

async function readServerState(path: string): Promise<ServerState | null> {
    let value: unknown
    try {
        value = JSON.parse(await readFile(path, 'utf8'))
    } catch {
        return null
    }
    if (!value || typeof value !== 'object') return null
    const {pid, port, url, token} = value as Record<string, unknown>
    if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return null
    if (typeof port !== 'number' || !Number.isInteger(port) || port <= 0) return null
    if (typeof url !== 'string' || !url || typeof token !== 'string' || !token) return null
    return {pid, port, url, token}
}
