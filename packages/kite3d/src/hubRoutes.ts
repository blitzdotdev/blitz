import {spawn, type ChildProcess} from 'node:child_process'
import {closeSync, openSync} from 'node:fs'
import {access, mkdir, readdir, realpath, stat} from 'node:fs/promises'
import {homedir} from 'node:os'
import {dirname, isAbsolute, resolve, sep} from 'node:path'
import type {Context, Hono} from 'hono'
import {gitHead, repoRoot} from './gitInfo.ts'
import {initProject} from './initProject.ts'
import {isKite3dProjectRoot} from './project-root.ts'
import {readProjectIndex, registerProject, type IndexedProject} from './projectIndex.ts'
import {readRunningServer, serverStatePath, stopServer, type ServerState} from './serverState.ts'
import type {LocalAppEnv} from './server.ts'

// One row of the picker: what the index remembers, plus the six things only a server knows now.
export type ProjectRow = IndexedProject & {
    repoRoot: string | null // shared by every worktree of one repository; null for a loose project
    branch: string | null   // from git at request time; null when HEAD is detached
    head: string | null     // the short commit when branch is null
    running: boolean        // <path>/.kite3d/dev.json parses and its pid is alive
    tabs: number            // that server's SSE subscribers; 0 when it is not running
    url?: string            // the tokenized URL to open; only when running
}

interface HubFolder {
    name: string
    path: string
    isProject: boolean
    isRepo: boolean
}

const startTimeoutMilliseconds = 60_000

type HubErrorStatus = 400 | 403 | 404 | 409 | 500

class HubError extends Error {
    constructor(readonly status: HubErrorStatus, readonly code: string, message: string) {
        super(message)
    }
}

// The picker's routes. Every server serves them, so the picker in any open editor can start and
// stop the others, and the launcher is a server that serves nothing else.
export function mountHubRoutes(app: Hono<LocalAppEnv>): void {
    app.get('/api/hub/projects', (c) => hubRoute(c, () => listProjects()))
    app.get('/api/hub/folders', (c) => hubRoute(c, () => listFolders(c.req.query('path'))))
    app.post('/api/hub/projects/start', (c) => hubRoute(c, async () => startProject(await pathBody(c))))
    app.post('/api/hub/projects/stop', (c) => hubRoute(c, async () => stopProject(await pathBody(c))))
    app.post('/api/hub/projects/add', (c) => hubRoute(c, async () => addProject(await pathBody(c))))
    app.post('/api/hub/projects/create', (c) => hubRoute(c, async () => {
        const body = await jsonBody(c)
        if (typeof body.parent !== 'string' || typeof body.name !== 'string') {
            throw new HubError(400, 'invalid_request', 'parent and name must be strings.')
        }
        return createProject(body.parent, body.name)
    }))
}

async function listProjects(): Promise<ProjectRow[]> {
    const {projects} = await readProjectIndex()
    return Promise.all(projects.map(async (project) => {
        const server = await readRunningServer(serverStatePath(project.path))
        const {branch, head} = await gitHead(project.path)
        return {
            ...project,
            repoRoot: await repoRoot(project.path),
            branch,
            head,
            running: server !== null,
            tabs: server ? await countTabs(server) : 0,
            ...(server ? {url: server.url} : {}),
        }
    }))
}

// An open editor tab is one SSE subscriber, and only that server can count its own.
async function countTabs(server: ServerState): Promise<number> {
    try {
        // A pid can be alive with its port already closed, so this call needs an end.
        const response = await fetch(new URL('/api/state', server.url), {
            headers: {'X-Kite3D-Token': server.token},
            signal: AbortSignal.timeout(2_000),
        })
        if (!response.ok) return 0
        const state = await response.json() as {clients?: unknown}
        return typeof state.clients === 'number' ? state.clients : 0
    } catch {
        return 0
    }
}

async function listFolders(requested: string | undefined): Promise<{path: string, parent: string | null, folders: HubFolder[]}> {
    const home = await realpath(homedir())
    const path = requested === undefined ? home : await existingPathUnderHome(requested)
    if (!(await stat(path)).isDirectory()) throw new HubError(400, 'invalid_path', `Not a folder: ${path}`)
    const entries = (await readdir(path, {withFileTypes: true}))
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules')
        .sort((left, right) => left.name.localeCompare(right.name))
    const folders = await Promise.all(entries.map(async ({name}) => {
        const folderPath = resolve(path, name)
        return {
            name,
            path: folderPath,
            isProject: await isKite3dProjectRoot(folderPath),
            // A repository keeps a .git folder here, or a .git file when this is a linked worktree.
            isRepo: await pathExists(resolve(folderPath, '.git')),
        }
    }))
    return {path, parent: path === home ? null : dirname(path), folders}
}

async function startProject(path: string): Promise<{url: string}> {
    const projectPath = await existingPathUnderHome(path)
    if (!await isKite3dProjectRoot(projectPath)) {
        throw new HubError(409, 'conflict', `Not a Kite3D project: ${projectPath}`)
    }
    const running = await readRunningServer(serverStatePath(projectPath))
    // A start always refreshes lastOpened, running or not, so the field name does not lie.
    const url = running ? running.url : (await spawnProjectServer(projectPath)).url
    await registerProject(projectPath)
    return {url}
}

async function spawnProjectServer(projectRoot: string): Promise<ServerState> {
    // A project pins its own kite3d once it is installed, and until then it runs on this server's
    // own CLI, so a project created from the picker starts on the click that created it.
    const pinnedCli = resolve(projectRoot, 'node_modules/kite3d/dist/cli.js')
    const cliPath = await pathExists(pinnedCli) ? pinnedCli : process.argv[1]
    await mkdir(resolve(projectRoot, '.kite3d'), {recursive: true})
    const log = openSync(resolve(projectRoot, '.kite3d/dev.log'), 'a', 0o600)
    let child: ChildProcess
    try {
        child = spawn(process.execPath, [cliPath, 'dev', '--no-open'], {
            cwd: projectRoot,
            detached: true,
            stdio: ['ignore', log, log],
        })
        child.unref()
    } finally {
        closeSync(log)
    }
    const statePath = serverStatePath(projectRoot)
    const deadline = Date.now() + startTimeoutMilliseconds
    while (Date.now() < deadline) {
        const state = await readRunningServer(statePath)
        if (state) return state
        if (child.exitCode !== null || child.signalCode !== null) {
            throw new HubError(500, 'start_failed', `The dev server for ${projectRoot} stopped at once. Read .kite3d/dev.log.`)
        }
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
    }
    child.kill('SIGTERM')
    throw new HubError(500, 'start_failed', `The dev server for ${projectRoot} did not answer in ${startTimeoutMilliseconds / 1_000} seconds. Read .kite3d/dev.log.`)
}

// True means the project is not running any more, whether this call stopped it or it was already down.
async function stopProject(path: string): Promise<{stopped: true}> {
    const projectPath = await existingPathUnderHome(path)
    const statePath = serverStatePath(projectPath)
    const running = await readRunningServer(statePath)
    if (running?.pid === process.pid) {
        // The picker inside this server's own editor asked for it. Answer first, then take the signal.
        setTimeout(() => process.kill(process.pid, 'SIGTERM'), 100).unref()
        return {stopped: true}
    }
    await stopServer(statePath)
    return {stopped: true}
}

async function addProject(path: string): Promise<{path: string}> {
    const projectPath = await existingPathUnderHome(path)
    if (!await isKite3dProjectRoot(projectPath)) {
        throw new HubError(409, 'conflict', `Not a Kite3D project: ${projectPath}`)
    }
    await registerProject(projectPath)
    return {path: projectPath}
}

async function createProject(parent: string, name: string): Promise<{path: string}> {
    const parentPath = await existingPathUnderHome(parent)
    if (!(await stat(parentPath)).isDirectory()) throw new HubError(400, 'invalid_path', `Not a folder: ${parentPath}`)
    const target = resolve(parentPath, name)
    if (dirname(target) !== parentPath || name === '.' || name === '..') {
        throw new HubError(400, 'invalid_request', 'name must be one folder name.')
    }
    if (await pathExists(target)) throw new HubError(409, 'conflict', `Folder already exists: ${target}`)
    await initProject(target)
    await registerProject(target)
    return {path: target}
}

async function hubRoute(c: Context<LocalAppEnv>, handler: () => Promise<unknown>): Promise<Response> {
    try {
        return c.json(await handler() as Record<string, unknown>)
    } catch (error) {
        if (!(error instanceof HubError)) throw error
        return c.json({error: {code: error.code, message: error.message}}, error.status)
    }
}

async function pathBody(c: Context<LocalAppEnv>): Promise<string> {
    const {path} = await jsonBody(c)
    if (typeof path !== 'string' || !path) throw new HubError(400, 'invalid_request', 'path must be a string.')
    return path
}

async function jsonBody(c: Context<LocalAppEnv>): Promise<Record<string, unknown>> {
    const text = await c.req.text()
    let body: unknown
    try {
        body = text ? JSON.parse(text) : {}
    } catch {
        throw new HubError(400, 'invalid_request', 'The request body must be JSON.')
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new HubError(400, 'invalid_request', 'The request body must be a JSON object.')
    }
    return body as Record<string, unknown>
}

// Every path the picker sends is absolute and inside the home folder, before and after symlinks.
async function existingPathUnderHome(path: string): Promise<string> {
    if (!isAbsolute(path)) throw new HubError(400, 'invalid_path', 'path must be absolute.')
    const home = await realpath(homedir())
    if (!isInside(resolve(path), home)) throw new HubError(403, 'invalid_path', 'path must be inside the home folder.')
    let canonical: string
    try {
        canonical = await realpath(resolve(path))
    } catch {
        throw new HubError(404, 'not_found', `Path does not exist: ${path}`)
    }
    if (!isInside(canonical, home)) throw new HubError(403, 'invalid_path', 'path must be inside the home folder.')
    return canonical
}

function isInside(path: string, root: string): boolean {
    return path === root || path.startsWith(`${root}${sep}`)
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await access(path)
        return true
    } catch {
        return false
    }
}
