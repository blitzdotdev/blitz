import {execFile} from 'node:child_process'
import {mkdtemp, readFile, realpath, rm, stat, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import {promisify} from 'node:util'
import {afterEach, describe, expect, it} from 'vitest'

const executeFile = promisify(execFile)
const cli = resolve('dist/cli.js')
const cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
    while (cleanup.length) await cleanup.pop()!()
})

describe('background development server', () => {
    it('starts detached, writes a log, and stops idempotently', async () => {
        const root = await mkdtemp(resolve(tmpdir(), 'kite3d-detach-'))
        cleanup.push(() => rm(root, {recursive: true, force: true}))
        await executeFile(process.execPath, [cli, 'init', root, '--no-git'], {env: process.env})
        const canonicalRoot = await realpath(root)
        cleanup.push(() => stopProcessFromFile(resolve(root, '.kite3d/dev.json')))

        const started = await executeFile(process.execPath, [cli, 'dev', '--detach', '--port', '0', '--no-open'], {
            cwd: root,
            env: process.env,
            timeout: 15_000,
        })
        const state = JSON.parse(await readFile(resolve(root, '.kite3d/dev.json'), 'utf8')) as {
            pid: number, url: string
        }
        expect(started.stderr).toBe('')
        expect(started.stdout.trim()).toBe(state.url)
        expect(processIsAlive(state.pid)).toBe(true)
        expect((await stat(resolve(root, '.kite3d/dev.log'))).isFile()).toBe(true)

        const stopped = await executeFile(process.execPath, [cli, 'dev', '--stop'], {
            cwd: root,
            env: process.env,
            timeout: 10_000,
        })
        expect(stopped.stdout.trim()).toBe(`Stopped the development server for ${canonicalRoot}`)
        expect(processIsAlive(state.pid)).toBe(false)

        const stoppedAgain = await executeFile(process.execPath, [cli, 'dev', '--stop'], {
            cwd: root,
            env: process.env,
            timeout: 10_000,
        })
        expect(stoppedAgain.stdout.trim()).toBe(`No development server is running for ${canonicalRoot}`)
    })
})

describe('project launcher process', () => {
    it('replaces stale state, reuses one hub, and stops it', async () => {
        const cwd = await mkdtemp(resolve(tmpdir(), 'kite3d-open-'))
        cleanup.push(() => rm(cwd, {recursive: true, force: true}))
        cleanup.push(() => stopProcessFromFile(resolve(kite3dHomeDirectory(), 'hub.json')))
        await writeFile(resolve(kite3dHomeDirectory(), 'hub.json'), `${JSON.stringify({
            pid: 99_999_999,
            port: 4320,
            url: 'http://127.0.0.1:4320/?t=stale',
            token: 'stale',
        })}\n`)

        const first = await executeFile(process.execPath, [cli, 'open', '--no-open'], {
            cwd,
            env: process.env,
            timeout: 15_000,
        })
        const firstState = await readHubStateFile()
        expect(first.stderr).toBe('')
        expect(firstState).not.toBeNull()
        expect(first.stdout.trim()).toBe(firstState?.url)
        expect(firstState?.pid).not.toBe(99_999_999)
        const origin = new URL(firstState!.url).origin
        expect((await fetch(`${origin}/api/state`)).status).toBe(401)
        const hubStateResponse = await fetch(`${origin}/api/state?t=${encodeURIComponent(firstState!.token)}`)
        expect(await hubStateResponse.json()).toEqual({hub: true})
        expect((await fetch(firstState!.url)).status).toBe(200)
        expect((await fetch(`${origin}/api/files?t=${encodeURIComponent(firstState!.token)}`)).status).toBe(404)

        const second = await executeFile(process.execPath, [cli, 'open', '--no-open'], {
            cwd,
            env: process.env,
            timeout: 15_000,
        })
        const secondState = await readHubStateFile()
        expect(second.stdout.trim()).toBe(first.stdout.trim())
        expect(secondState).toMatchObject({pid: firstState?.pid, port: firstState?.port})

        const stopped = await executeFile(process.execPath, [cli, 'open', '--stop'], {
            cwd,
            env: process.env,
            timeout: 10_000,
        })
        expect(stopped.stdout.trim()).toBe('Stopped the Kite3D launcher.')
        expect(processIsAlive(firstState!.pid)).toBe(false)
        expect(await readHubStateFile()).toBeNull()
    })
})

interface HubStateFile {
    pid: number
    port: number
    url: string
    token: string
}

function kite3dHomeDirectory(): string {
    if (!process.env.KITE3D_HOME) throw new Error('KITE3D_HOME is required in tests')
    return resolve(process.env.KITE3D_HOME)
}

async function readHubStateFile(): Promise<HubStateFile | null> {
    try {
        const value = JSON.parse(await readFile(resolve(kite3dHomeDirectory(), 'hub.json'), 'utf8')) as HubStateFile
        return processIsAlive(value.pid) ? value : null
    } catch {
        return null
    }
}

async function stopProcessFromFile(path: string): Promise<void> {
    let pid: number
    try {
        pid = (JSON.parse(await readFile(path, 'utf8')) as {pid: number}).pid
    } catch {
        return
    }
    try { process.kill(pid, 'SIGTERM') } catch { return }
    const started = Date.now()
    while (processIsAlive(pid) && Date.now() - started < 5_000) {
        await new Promise((resolveWait) => setTimeout(resolveWait, 50))
    }
    if (processIsAlive(pid)) {
        try { process.kill(pid, 'SIGKILL') } catch { /* already stopped */ }
    }
}

function processIsAlive(pid: number): boolean {
    try {
        process.kill(pid, 0)
        return true
    } catch (error) {
        return error instanceof Error && 'code' in error && error.code === 'EPERM'
    }
}
