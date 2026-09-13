import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {homedir} from 'node:os'
import {resolve} from 'node:path'
import {afterEach, expect, it} from 'vitest'
import {initProject, runDev} from '../src/commands.ts'
import {KITE3D_VERSION} from '../src/versions.ts'

const cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
    while (cleanup.length) await cleanup.pop()!()
})

// Guards the owner's launcher report: an older pinned CLI failure surfaced as a bare 500.
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
