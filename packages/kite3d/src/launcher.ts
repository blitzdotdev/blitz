import {spawn} from 'node:child_process'
import {closeSync, openSync} from 'node:fs'
import {mkdir} from 'node:fs/promises'
import {homedir} from 'node:os'
import {resolve} from 'node:path'
import openBrowser from 'open'
import {kite3dHome} from './home.ts'
import {createDevServer, type DevServer} from './server.ts'
import {readRunningServer, serverStatePath, stopServer, type ServerState} from './serverState.ts'

// The detached child runs the same `kite3d open`, so this is how it knows that it is the child and
// must become the launcher instead of starting another one.
export const LAUNCHER_CHILD = 'KITE3D_LAUNCHER'

const startTimeoutMilliseconds = 60_000

// kite3d open in a terminal, and the kite3d:// handler. A live launcher is reused, so a second open
// starts no second process.
export async function openLauncher(options: {noOpen?: boolean} = {}): Promise<string> {
    const state = await readRunningServer(launcherStatePath()) ?? await startDetachedLauncher()
    if (!options.noOpen) await openBrowser(state.url)
    return state.url
}

// The launcher itself: a server with no project, so it serves the picker and the hub routes only.
export function serveLauncher(): Promise<DevServer> {
    return createDevServer({port: 4320})
}

export function stopLauncher(): Promise<boolean> {
    return stopServer(launcherStatePath())
}

function launcherStatePath(): string {
    return serverStatePath(undefined)
}

async function startDetachedLauncher(): Promise<ServerState> {
    const home = kite3dHome()
    await mkdir(home, {recursive: true})
    const logPath = resolve(home, 'hub.log')
    const log = openSync(logPath, 'a', 0o600)
    let child
    try {
        // process.argv[1] is the script that started this process, which is the kite3d CLI.
        child = spawn(process.execPath, [process.argv[1], 'open', '--no-open'], {
            cwd: homedir(),
            detached: true,
            env: {...process.env, [LAUNCHER_CHILD]: '1'},
            stdio: ['ignore', log, log],
        })
        child.unref()
    } finally {
        closeSync(log)
    }
    const deadline = Date.now() + startTimeoutMilliseconds
    while (Date.now() < deadline) {
        const state = await readRunningServer(launcherStatePath())
        if (state) return state
        if (child.exitCode !== null || child.signalCode !== null) {
            throw new Error(`The launcher stopped at once. Read ${logPath}.`)
        }
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
    }
    child.kill('SIGTERM')
    throw new Error(`The launcher did not answer in ${startTimeoutMilliseconds / 1_000} seconds. Read ${logPath}.`)
}
