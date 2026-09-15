import {homedir} from 'node:os'
import {resolve} from 'node:path'
import openBrowser from 'open'
import {kite3dHome} from './home.ts'
import {createDevServer, type DevServer} from './server.ts'
import {readRunningServer, serverStatePath, startDetachedServer, stopServer, type ServerState} from './serverState.ts'

// The detached child runs the same `kite3d open`, so this is how it knows that it is the child and
// must become the launcher instead of starting another one.
export const LAUNCHER_CHILD = 'KITE3D_LAUNCHER'

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

function startDetachedLauncher(): Promise<ServerState> {
    return startDetachedServer({
        // process.argv[1] is the script that started this process, which is the kite3d CLI.
        argv: [process.argv[1], 'open', '--no-open'],
        cwd: homedir(),
        env: {...process.env, [LAUNCHER_CHILD]: '1'},
        logPath: resolve(kite3dHome(), 'hub.log'),
        statePath: launcherStatePath(),
        subject: 'The launcher',
    })
}
