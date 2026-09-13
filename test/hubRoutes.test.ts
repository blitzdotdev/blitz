import {execFile} from 'node:child_process'
import {mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises'
import {homedir} from 'node:os'
import {resolve} from 'node:path'
import {promisify} from 'node:util'
import {afterEach, describe, expect, it} from 'vitest'
import {initProject, runDev} from '../src/commands.ts'
import {processIsAlive, readDevelopmentServer, stopDevelopmentServer} from '../src/hubRoutes.ts'
import {kite3dHomeDirectory, readProjectIndex} from '../src/projectIndex.ts'
import {KITE3D_VERSION} from '../src/versions.ts'

const executeFile = promisify(execFile)
const cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
    while (cleanup.length) await cleanup.pop()!()
})

describe('hub routes on a development server', () => {
    it('lists, starts, stops, creates, and adds projects within home', async () => {
        await rm(resolve(kite3dHomeDirectory(), 'projects.json'), {force: true})
        const parent = await mkdtemp(resolve(homedir(), 'kite3d hub routes '))
        cleanup.push(() => rm(parent, {recursive: true, force: true}))
        const main = resolve(parent, 'main project')
        const linked = resolve(parent, 'linked worktree')
        await initProject(main)
        await executeFile('git', ['-C', main, 'worktree', 'add', '-qb', 'hub-feature', linked])
        await mkdir(resolve(linked, 'node_modules'), {recursive: true})
        await symlink(resolve(import.meta.dirname, '..'), resolve(linked, 'node_modules/kite3d'), 'dir')
        await mkdir(resolve(parent, '.hidden'))
        await mkdir(resolve(parent, 'node_modules'))

        const mainServer = await runDev({projectRoot: main, port: 0, noOpen: true})
        cleanup.push(() => mainServer.close())
        cleanup.push(async () => { await stopDevelopmentServer(linked).catch(() => undefined) })
        const base = `http://127.0.0.1:${mainServer.port}`
        const headers = {'X-Kite3D-Token': mainServer.token}

        expect((await fetch(`${base}/api/hub/projects`)).status).toBe(401)
        const projectsResponse = await fetch(`${base}/api/hub/projects`, {headers})
        expect(projectsResponse.status).toBe(200)
        const projects = await projectsResponse.json() as HubProjects
        expect(projects.active).toEqual([
            expect.objectContaining({path: main, name: 'main-project', url: mainServer.url}),
        ])
        expect(projects.repos).toEqual([
            expect.objectContaining({
                name: 'main-project',
                root: main,
                worktrees: expect.arrayContaining([
                    expect.objectContaining({path: main, running: true, url: mainServer.url}),
                    expect.objectContaining({path: linked, branch: 'hub-feature', running: false, url: null}),
                ]),
            }),
        ])
        expect(projects.loose).toEqual([])

        const defaultFolders = await (await fetch(`${base}/api/hub/folders`, {headers})).json() as FolderListing
        expect(defaultFolders.path).toBe(parent)
        const foldersResponse = await fetch(`${base}/api/hub/folders?path=${encodeURIComponent(parent)}`, {headers})
        const folders = await foldersResponse.json() as FolderListing
        expect(folders.folders.map(({name}) => name)).not.toEqual(expect.arrayContaining(['.hidden', 'node_modules']))
        expect(folders.folders).toEqual(expect.arrayContaining([
            expect.objectContaining({name: 'main project', path: main, isProject: true, isRepo: true}),
            expect.objectContaining({name: 'linked worktree', path: linked, isProject: true, isRepo: true}),
        ]))
        expect((await fetch(`${base}/api/hub/folders?path=${encodeURIComponent('/private/tmp')}`, {headers})).status).toBe(403)

        const [start, concurrentStart] = await Promise.all([
            post(base, headers, '/api/hub/projects/start', {path: linked}),
            post(base, headers, '/api/hub/projects/start', {path: linked}),
        ])
        expect(start.response.status).toBe(200)
        expect(concurrentStart.response.status).toBe(200)
        expect(concurrentStart.body).toEqual(start.body)
        expect(start.body).toMatchObject({url: expect.stringContaining('http://127.0.0.1:')})
        const linkedServer = await readDevelopmentServer(linked)
        expect(linkedServer).not.toBeNull()
        const runningProjects = await (await fetch(`${base}/api/hub/projects`, {headers})).json() as HubProjects
        expect(runningProjects.active.map(({path}) => path)).toEqual([linked, main])
        expect(runningProjects.repos[0].worktrees.find(({path}) => path === linked)).toMatchObject({running: true})

        const stop = await post(base, headers, '/api/hub/projects/stop', {path: linked})
        expect(stop.response.status).toBe(200)
        expect(stop.body).toEqual({stopped: true})
        expect(await readDevelopmentServer(linked)).toBeNull()

        const createdName = 'created project'
        const createdPath = resolve(parent, createdName)
        const created = await post(base, headers, '/api/hub/projects/create', {parent, name: createdName})
        expect(created.response.status).toBe(200)
        expect(created.body).toEqual({path: createdPath})
        expect(JSON.parse(await readFile(resolve(createdPath, 'package.json'), 'utf8'))).toMatchObject({
            name: 'created-project',
            devDependencies: {kite3d: KITE3D_VERSION},
        })
        expect(await readDevelopmentServer(createdPath)).toBeNull()
        const missingInstall = await post(base, headers, '/api/hub/projects/start', {path: createdPath})
        expect(missingInstall.response.status).toBe(409)
        expect(missingInstall.body).toMatchObject({error: {message: `Run npm install in ${createdPath} first.`}})

        const previousGitCeiling = process.env.GIT_CEILING_DIRECTORIES
        process.env.GIT_CEILING_DIRECTORIES = parent
        cleanup.push(async () => {
            if (previousGitCeiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES
            else process.env.GIT_CEILING_DIRECTORIES = previousGitCeiling
        })
        const addedPath = resolve(parent, 'added project')
        await writeKite3dProject(addedPath, 'added-project')
        const added = await post(base, headers, '/api/hub/projects/add', {path: addedPath})
        expect(added.response.status).toBe(200)
        expect(added.body).toEqual({path: addedPath})
        expect((await readProjectIndex()).projects.map(({path}) => path)).toContain(addedPath)
        const withLooseProject = await (await fetch(`${base}/api/hub/projects`, {headers})).json() as HubProjects
        expect(withLooseProject.loose).toContainEqual(expect.objectContaining({path: addedPath}))

        const ordinaryFolder = resolve(parent, 'ordinary')
        await mkdir(ordinaryFolder)
        const refused = await post(base, headers, '/api/hub/projects/add', {path: ordinaryFolder})
        expect(refused.response.status).toBe(409)
        expect(refused.body).toMatchObject({error: {message: `Not a Kite3D project: ${ordinaryFolder}`}})
    })
})

describe('starting pinned development servers', () => {
    it('starts and stops a pinned CLI that only accepts dev --no-open', async () => {
        const fixture = await hubFixture('plain-arguments')
        const project = await fakeCliProject(fixture.parent, 'plain pinned project', `
const fs = require('node:fs')
const path = require('node:path')
const args = process.argv.slice(2)
if (args.length !== 2 || args[0] !== 'dev' || args[1] !== '--no-open') {
    console.error('unsupported arguments: ' + args.join(' '))
    process.exit(1)
}
const directory = path.join(process.cwd(), '.kite3d')
fs.mkdirSync(directory, {recursive: true})
const token = 'fake-token'
fs.writeFileSync(path.join(directory, 'dev.json'), JSON.stringify({
    pid: process.pid,
    port: 43210,
    url: 'http://127.0.0.1:43210/?t=' + token,
    token,
    started_at: new Date().toISOString(),
}))
process.on('SIGTERM', () => process.exit(0))
setInterval(() => {}, 1000)
`)

        const start = await post(fixture.base, fixture.headers, '/api/hub/projects/start', {path: project})

        expect(start.response.status).toBe(200)
        expect(start.body).toEqual({url: 'http://127.0.0.1:43210/?t=fake-token'})
        const state = await readDevelopmentServer(project)
        expect(state).not.toBeNull()

        const stop = await post(fixture.base, fixture.headers, '/api/hub/projects/stop', {path: project})
        expect(stop.response.status).toBe(200)
        expect(stop.body).toEqual({stopped: true})
        expect(processIsAlive(state!.pid)).toBe(false)
    })

    it('returns the pinned CLI failure from the log', async () => {
        const fixture = await hubFixture('failed-start')
        const project = await fakeCliProject(fixture.parent, 'broken pinned project', `
console.error('fake pinned CLI could not start')
process.exit(1)
`)

        const start = await post(fixture.base, fixture.headers, '/api/hub/projects/start', {path: project})

        expect(start.response.status).toBe(502)
        expect(start.body).toEqual({error: {
            code: 'start_failed',
            message: `Could not start the development server for ${project}: "fake pinned CLI could not start"`,
        }})
    })

    it('returns the last log line when the pinned CLI times out', async () => {
        const fixture = await hubFixture('timed-out-start')
        const project = await fakeCliProject(fixture.parent, 'hanging pinned project', `
const fs = require('node:fs')
const path = require('node:path')
if (process.argv.includes('--detach')) {
    console.error('unknown option --detach')
    process.exit(1)
}
const directory = path.join(process.cwd(), '.kite3d')
fs.mkdirSync(directory, {recursive: true})
fs.writeFileSync(path.join(directory, 'fake.pid'), String(process.pid))
console.error('fake pinned CLI stayed alive without dev.json')
process.on('SIGTERM', () => process.exit(0))
setInterval(() => {}, 1000)
`)
        const previousTimeout = process.env.KITE3D_DEV_START_TIMEOUT_MS
        process.env.KITE3D_DEV_START_TIMEOUT_MS = '250'
        cleanup.push(async () => {
            if (previousTimeout === undefined) delete process.env.KITE3D_DEV_START_TIMEOUT_MS
            else process.env.KITE3D_DEV_START_TIMEOUT_MS = previousTimeout
        })

        const start = await post(fixture.base, fixture.headers, '/api/hub/projects/start', {path: project})

        expect(start.response.status).toBe(502)
        expect(start.body).toEqual({error: {
            code: 'start_failed',
            message: `Could not start the development server for ${project}: "fake pinned CLI stayed alive without dev.json"`,
        }})
        const pid = Number(await readFile(resolve(project, '.kite3d/fake.pid'), 'utf8'))
        expect(processIsAlive(pid)).toBe(false)
    })
})

interface HubProjects {
    active: Array<{path: string, name: string, branch: string | null, url: string}>
    repos: Array<{name: string, root: string, worktrees: Array<{
                path: string, name: string, branch: string | null, running: boolean, url: string | null
    }>}>
    loose: Array<{path: string}>
}

interface FolderListing {
    path: string
    parent: string | null
    folders: Array<{name: string, path: string, isProject: boolean, isRepo: boolean}>
}

async function post(
    base: string,
    tokenHeaders: Record<string, string>,
    path: string,
    body: Record<string, string>,
): Promise<{response: Response, body: Record<string, unknown>}> {
    const response = await fetch(base + path, {
        method: 'POST',
        headers: {...tokenHeaders, 'Content-Type': 'application/json'},
        body: JSON.stringify(body),
    })
    return {response, body: await response.json() as Record<string, unknown>}
}

async function writeKite3dProject(path: string, name: string): Promise<void> {
    await mkdir(resolve(path, 'assets'), {recursive: true})
    await writeFile(resolve(path, 'package.json'), `${JSON.stringify({
        name,
        devDependencies: {kite3d: KITE3D_VERSION},
    })}\n`)
    await writeFile(resolve(path, 'assets/main.scene.gltf'), '{}\n')
}

async function hubFixture(name: string): Promise<{
    parent: string
    base: string
    headers: Record<string, string>
}> {
    const parent = await mkdtemp(resolve(homedir(), `kite3d hub ${name} `))
    cleanup.push(() => rm(parent, {recursive: true, force: true}))
    const host = resolve(parent, 'hub host')
    await initProject(host, {git: false})
    const server = await runDev({projectRoot: host, port: 0, noOpen: true})
    cleanup.push(() => server.close())
    return {
        parent,
        base: `http://127.0.0.1:${server.port}`,
        headers: {'X-Kite3D-Token': server.token},
    }
}

async function fakeCliProject(parent: string, name: string, source: string): Promise<string> {
    const project = resolve(parent, name)
    await writeKite3dProject(project, name.replaceAll(' ', '-'))
    const cli = resolve(project, 'node_modules/kite3d/dist/cli.js')
    await mkdir(resolve(cli, '..'), {recursive: true})
    await writeFile(cli, source.trimStart())
    return project
}
