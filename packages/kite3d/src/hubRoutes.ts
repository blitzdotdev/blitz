import {execFile, spawn} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import {closeSync, openSync} from 'node:fs'
import {access, mkdir, open as openFile, readFile, readdir, realpath, stat, unlink} from 'node:fs/promises'
import {homedir} from 'node:os'
import {basename, dirname, isAbsolute, relative, resolve, sep} from 'node:path'
import {promisify} from 'node:util'
import type {Hono} from 'hono'
import {branch, repoKey, repoRoot, worktrees, type GitWorktree} from './gitInfo.ts'
import {readProjectIndex, registerProject, type IndexedProject} from './projectIndex.ts'
import {isKite3dProjectRoot} from './project-root.ts'
import type {LocalAppEnv} from './server.ts'

const executeFile = promisify(execFile)
const developmentStartTimeoutMilliseconds = 60_000
const developmentStopTimeoutMilliseconds = 5_000

export interface RunningDevelopmentServer {
    pid: number
    port: number
    url: string
    token: string
    startedAt: string
}

interface HubWorktree {
    path: string
    name: string
    branch: string | null
    running: boolean
    url: string | null
}

export function mountHubRoutes(app: Hono<LocalAppEnv>): void {
    app.get('/api/hub/projects', async () => routeResponse(() => listHubProjects()))
    app.get('/api/hub/folders', async (c) => routeResponse(() => listHubFolders(c.req.query('path'))))
    app.post('/api/hub/projects/start', async (c) => routeResponse(async () => {
        const {path} = await pathBody(c.req.raw)
        const projectPath = await existingPathUnderHome(path)
        if (!await isKite3dProjectRoot(projectPath)) throw routeError(409, `Not a Kite3D project: ${projectPath}`)
        const existing = await readDevelopmentServer(projectPath)
        if (existing) return {url: existing.url}
        const pinnedCli = resolve(projectPath, 'node_modules/kite3d/dist/cli.js')
        if (!await isFile(pinnedCli)) throw routeError(409, `Run npm install in ${projectPath} first.`)
        try {
            await executeFile(process.execPath, [pinnedCli, 'dev', '--detach', '--no-open'], {
                cwd: projectPath,
                env: process.env,
                encoding: 'utf8',
                timeout: developmentStartTimeoutMilliseconds + 5_000,
                maxBuffer: 1024 * 1024,
            })
        } catch (error) {
            const concurrent = await readDevelopmentServer(projectPath)
            if (!concurrent) throw routeError(500, `Could not start the development server for ${projectPath}.`)
        }
        const server = await waitForDevelopmentServer(projectPath, developmentStartTimeoutMilliseconds)
        await registerProject(projectPath)
        return {url: server.url}
    }))
    app.post('/api/hub/projects/stop', async (c) => routeResponse(async () => {
        const {path} = await pathBody(c.req.raw)
        const projectPath = await existingPathUnderHome(path)
        const server = await readDevelopmentServer(projectPath)
        if (server?.pid === process.pid) {
            const timer = setTimeout(() => process.kill(process.pid, 'SIGTERM'), 100)
            timer.unref()
        } else {
            await stopDevelopmentServer(projectPath)
        }
        return {stopped: true}
    }))
    app.post('/api/hub/projects/create', async (c) => routeResponse(async () => {
        const body = await jsonBody(c.req.raw)
        if (typeof body.parent !== 'string' || typeof body.name !== 'string') {
            throw routeError(400, 'parent and name must be strings.')
        }
        const parent = await existingPathUnderHome(body.parent)
        if (!(await stat(parent)).isDirectory()) throw routeError(400, `Not a folder: ${parent}`)
        if (!body.name || body.name === '.' || body.name === '..' || body.name.includes('/')
            || body.name.includes('\\') || body.name.includes('\0')) {
            throw routeError(400, 'name must be one folder name.')
        }
        const target = resolve(parent, body.name)
        if (dirname(target) !== parent) throw routeError(400, 'name must be one folder name.')
        if (await pathExists(target)) throw routeError(409, `Folder already exists: ${target}`)
        const {initProject} = await import('./commands.ts')
        await initProject(target)
        return {path: target}
    }))
    app.post('/api/hub/projects/add', async (c) => routeResponse(async () => {
        const {path} = await pathBody(c.req.raw)
        const projectPath = await existingPathUnderHome(path)
        if (!await isKite3dProjectRoot(projectPath)) throw routeError(409, `Not a Kite3D project: ${projectPath}`)
        await registerProject(projectPath)
        return {path: projectPath}
    }))
}

export async function readDevelopmentServer(projectRoot: string): Promise<RunningDevelopmentServer | null> {
    let value: Record<string, unknown>
    try {
        value = JSON.parse(await readFile(resolve(projectRoot, '.kite3d/dev.json'), 'utf8')) as Record<string, unknown>
    } catch {
        return null
    }
    if (typeof value.pid !== 'number' || !Number.isInteger(value.pid) || value.pid <= 0
        || typeof value.port !== 'number' || !Number.isInteger(value.port) || value.port < 1
        || typeof value.url !== 'string' || typeof value.token !== 'string'
        || typeof value.started_at !== 'string' || !Number.isFinite(Date.parse(value.started_at))
        || !processIsAlive(value.pid)) return null
    try {
        const url = new URL(value.url)
        if (url.searchParams.get('t') !== value.token) return null
    } catch {
        return null
    }
    return {
        pid: value.pid,
        port: value.port,
        url: value.url,
        token: value.token,
        startedAt: value.started_at,
    }
}

export async function startDetachedDevelopmentServer(
    projectRoot: string,
    cliPath: string,
    options: {port?: number, force?: boolean} = {},
): Promise<RunningDevelopmentServer> {
    const root = resolve(projectRoot)
    const existing = await readDevelopmentServer(root)
    if (existing && !options.force) return existing
    await mkdir(resolve(root, '.kite3d'), {recursive: true})
    const release = await acquireDetachStartupLock(root)
    try {
        const concurrent = await readDevelopmentServer(root)
        if (concurrent && !options.force) return concurrent
        const logPath = resolve(root, '.kite3d/dev.log')
        const output = openSync(logPath, 'a', 0o600)
        let child
        try {
            const args = [cliPath, 'dev', '--no-open']
            if (options.port !== undefined) args.push('--port', String(options.port))
            if (options.force) args.push('--force')
            child = spawn(process.execPath, args, {
                cwd: root,
                detached: true,
                env: process.env,
                stdio: ['ignore', output, output],
            })
            child.unref()
        } finally {
            closeSync(output)
        }
        return await waitForDevelopmentServer(root, developmentStartTimeoutMilliseconds, () => child?.exitCode)
    } finally {
        await release()
    }
}

export async function stopDevelopmentServer(projectRoot: string): Promise<boolean> {
    const root = resolve(projectRoot)
    const server = await readDevelopmentServer(root)
    if (!server) {
        await unlink(resolve(root, '.kite3d/dev.json')).catch(() => undefined)
        return false
    }
    try {
        process.kill(server.pid, 'SIGTERM')
    } catch (error) {
        if (errorCode(error) !== 'ESRCH') throw error
    }
    const stopped = await waitForProcessExit(server.pid, developmentStopTimeoutMilliseconds)
    if (!stopped) {
        try { process.kill(server.pid, 'SIGKILL') } catch (error) {
            if (errorCode(error) !== 'ESRCH') throw error
        }
        if (!await waitForProcessExit(server.pid, 1_000)) {
            throw new Error(`Development server pid ${server.pid} did not stop.`)
        }
    }
    await removeDevelopmentFileIfOwned(root, server.pid, server.token)
    return true
}

export function processIsAlive(pid: number): boolean {
    try {
        process.kill(pid, 0)
        return true
    } catch (error) {
        return errorCode(error) === 'EPERM'
    }
}

async function listHubProjects(): Promise<{
    active: Array<{path: string, name: string, branch: string | null, url: string}>
    repos: Array<{name: string, root: string, worktrees: HubWorktree[]}>
    loose: HubWorktree[]
}> {
    const {projects} = await readProjectIndex()
    const details = await Promise.all(projects.map(async (project) => ({
        project,
        key: await repoKey(project.path),
        server: await readDevelopmentServer(project.path),
        branch: await branch(project.path),
    })))
    const active = details.flatMap(({project, server, branch: currentBranch}) => server ? [{
        path: project.path,
        name: project.name,
        branch: currentBranch,
        url: server.url,
    }] : [])
    const groups = new Map<string, IndexedProject[]>()
    const loose = details.filter(({key}) => key === null).map(({project, server}) => ({
        path: project.path,
        name: project.name,
        branch: null,
        running: server !== null,
        url: server?.url ?? null,
    }))
    for (const {key, project} of details) {
        if (key === null) continue
        groups.set(key, [...groups.get(key) || [], project])
    }
    const repos = await Promise.all([...groups.values()].map(async (indexedProjects) => {
        const listedWorktrees = await worktrees(indexedProjects[0].path) || []
        const knownPaths = new Set(listedWorktrees.map(({path}) => path))
        const completeWorktrees: GitWorktree[] = [...listedWorktrees]
        for (const project of indexedProjects) {
            if (!knownPaths.has(project.path)) {
                completeWorktrees.push({path: project.path, branch: await branch(project.path), head: ''})
            }
        }
        const indexedByPath = new Map(indexedProjects.map((project) => [project.path, project]))
        const hubWorktrees = await Promise.all(completeWorktrees.map(async (worktree) => {
            const server = await readDevelopmentServer(worktree.path)
            return {
                path: worktree.path,
                name: await projectName(worktree.path),
                branch: worktree.branch,
                running: server !== null,
                url: server?.url ?? null,
            }
        }))
        hubWorktrees.sort((left, right) => compareWorktrees(left, right, indexedByPath))
        const root = listedWorktrees[0]?.path || indexedProjects[0].repoRoot || indexedProjects[0].path
        return {
            name: await projectName(root),
            root,
            worktrees: hubWorktrees,
            lastOpened: indexedProjects[0].lastOpened,
        }
    }))
    repos.sort((left, right) => right.lastOpened.localeCompare(left.lastOpened))
    return {
        active,
        repos: repos.map(({lastOpened: _lastOpened, ...repo}) => repo),
        loose,
    }
}

async function listHubFolders(requestedPath: string | undefined): Promise<{
    path: string
    parent: string | null
    folders: Array<{name: string, path: string, isProject: boolean, isRepo: boolean}>
}> {
    let path: string
    if (requestedPath === undefined) {
        const latest = (await readProjectIndex()).projects[0]
        path = latest ? dirname(latest.path) : await realpath(homedir())
        if (!isPathInside(path, await realpath(homedir()))) path = await realpath(homedir())
    } else {
        if (!isAbsolute(requestedPath)) throw routeError(400, 'path must be absolute.')
        path = await existingPathUnderHome(requestedPath)
    }
    if (!(await stat(path)).isDirectory()) throw routeError(400, `Not a folder: ${path}`)
    const home = await realpath(homedir())
    const entries = (await readdir(path, {withFileTypes: true}))
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules')
        .sort((left, right) => left.name.localeCompare(right.name))
    const folders = await Promise.all(entries.map(async ({name}) => {
        const folderPath = resolve(path, name)
        return {
            name,
            path: folderPath,
            isProject: await isKite3dProjectRoot(folderPath),
            isRepo: await repoRoot(folderPath) === folderPath,
        }
    }))
    return {
        path,
        parent: path === home ? null : dirname(path),
        folders,
    }
}

async function existingPathUnderHome(path: string): Promise<string> {
    if (!isAbsolute(path)) throw routeError(400, 'path must be absolute.')
    const home = await realpath(homedir())
    const absolutePath = resolve(path)
    if (!isPathInside(absolutePath, home)) throw routeError(403, 'Path is outside the home folder.')
    let canonicalPath: string
    try {
        canonicalPath = await realpath(absolutePath)
    } catch (error) {
        if (errorCode(error) === 'ENOENT') throw routeError(404, `Path does not exist: ${absolutePath}`)
        throw error
    }
    if (!isPathInside(canonicalPath, home)) throw routeError(403, 'Path is outside the home folder.')
    return canonicalPath
}

function isPathInside(path: string, root: string): boolean {
    const relativePath = relative(root, path)
    return relativePath === '' || relativePath !== '..'
        && !relativePath.startsWith('..' + sep) && !isAbsolute(relativePath)
}

async function waitForDevelopmentServer(
    projectRoot: string,
    timeoutMilliseconds: number,
    exitCode: () => number | null | undefined = () => undefined,
): Promise<RunningDevelopmentServer> {
    const started = Date.now()
    for (;;) {
        const server = await readDevelopmentServer(projectRoot)
        if (server) return server
        const code = exitCode()
        if (code !== undefined && code !== null) {
            throw new Error(`Development server exited with code ${code} before it became ready.`)
        }
        if (Date.now() - started >= timeoutMilliseconds) {
            throw new Error(`Timed out waiting for the development server for ${projectRoot}.`)
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 100))
    }
}

async function acquireDetachStartupLock(projectRoot: string): Promise<() => Promise<void>> {
    const path = resolve(projectRoot, '.kite3d/dev-detach.lock')
    const owner = {pid: process.pid, created_at: new Date().toISOString(), id: randomUUID()}
    for (let attempt = 0; attempt < 1_200; attempt += 1) {
        try {
            const handle = await openFile(path, 'wx', 0o600)
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
                || !Number.isFinite(createdAt) || Date.now() - createdAt > developmentStartTimeoutMilliseconds) {
                await unlink(path).catch(() => undefined)
                continue
            }
            await new Promise((resolveWait) => setTimeout(resolveWait, 50))
        }
    }
    throw new Error(`Timed out waiting to start the development server for ${projectRoot}.`)
}

async function waitForProcessExit(pid: number, timeoutMilliseconds: number): Promise<boolean> {
    const started = Date.now()
    while (processIsAlive(pid)) {
        if (Date.now() - started >= timeoutMilliseconds) return false
        await new Promise((resolveWait) => setTimeout(resolveWait, 50))
    }
    return true
}

async function removeDevelopmentFileIfOwned(projectRoot: string, pid: number, token: string): Promise<void> {
    const path = resolve(projectRoot, '.kite3d/dev.json')
    try {
        const value = JSON.parse(await readFile(path, 'utf8')) as {pid?: unknown, token?: unknown}
        if (value.pid === pid && value.token === token) await unlink(path)
    } catch { /* already removed or replaced */ }
}

async function projectName(path: string): Promise<string> {
    try {
        const value = JSON.parse(await readFile(resolve(path, 'package.json'), 'utf8')) as {name?: unknown}
        return typeof value.name === 'string' && value.name.trim() ? value.name.trim() : basename(path)
    } catch {
        return basename(path)
    }
}

function compareWorktrees(left: HubWorktree, right: HubWorktree, indexed: Map<string, IndexedProject>): number {
    const leftOpened = indexed.get(left.path)?.lastOpened
    const rightOpened = indexed.get(right.path)?.lastOpened
    if (leftOpened && rightOpened) return rightOpened.localeCompare(leftOpened)
    if (leftOpened) return -1
    if (rightOpened) return 1
    return left.name.localeCompare(right.name)
}

async function pathBody(request: Request): Promise<{path: string}> {
    const body = await jsonBody(request)
    if (typeof body.path !== 'string') throw routeError(400, 'path must be a string.')
    return {path: body.path}
}

async function jsonBody(request: Request): Promise<Record<string, unknown>> {
    let body: unknown
    try {
        body = await request.json()
    } catch {
        throw routeError(400, 'Request body must be JSON.')
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw routeError(400, 'Request body must be an object.')
    return body as Record<string, unknown>
}

async function routeResponse(operation: () => Promise<unknown>): Promise<Response> {
    try {
        return jsonResponse(await operation())
    } catch (error) {
        const status = errorStatus(error)
        return jsonResponse({error: {
            code: status >= 500
                ? 'internal_error'
                : status === 403 ? 'invalid_path' : status === 404 ? 'not_found' : status === 409 ? 'conflict' : 'invalid_request',
            message: status >= 500 ? 'Internal server error' : errorMessage(error),
        }}, status)
    }
}

function routeError(status: number, message: string): Error {
    return Object.assign(new Error(message), {status})
}

function errorStatus(error: unknown): number {
    if (error && typeof error === 'object' && 'status' in error && typeof error.status === 'number') return error.status
    return 500
}

function jsonResponse(body: unknown, status = 200): Response {
    const text = JSON.stringify(body)
    return new Response(text, {
        status,
        headers: {'Content-Type': 'application/json; charset=utf-8', 'Content-Length': String(Buffer.byteLength(text))},
    })
}

async function isFile(path: string): Promise<boolean> {
    try { return (await stat(path)).isFile() } catch { return false }
}

async function pathExists(path: string): Promise<boolean> {
    try { await access(path); return true } catch { return false }
}

function errorCode(error: unknown): string | undefined {
    return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : undefined
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}
