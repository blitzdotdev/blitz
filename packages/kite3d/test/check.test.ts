import {mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises'
import {createServer} from 'node:http'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {checkProject, formatCheckTable} from '../src/check.ts'
import {initProject, publishFromDisk} from '../src/commands.ts'
import {KITE3D_VERSION} from '../src/versions.ts'
import {startMockBackend} from './mockBackend.ts'

const cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
    while (cleanup.length) await cleanup.pop()!()
})

describe('kite3d check', () => {
    it('passes a freshly initialized empty project with an authoring warning', async () => {
        const root = await mkdtemp(resolve(tmpdir(), 'kite3d-check-init-'))
        cleanup.push(() => rm(root, {recursive: true, force: true}))
        await initProject(root, {git: false})

        const result = await checkProject(root)

        expect(result).toMatchObject({ok: true, mode: 'headless'})
        expect(result.outcomes).toContainEqual(expect.objectContaining({
            name: 'Editable',
            status: 'pass',
            codes: ['NO_VISIBLE_AUTHORED_CONTENT'],
        }))
    })

    it('falls back to headless checks when a live older server returns 404', async () => {
        const root = await project({}, [{name: 'Triangle', mesh: 0}])
        const olderServer = createServer((request, response) => {
            if (request.url === '/api/state') {
                response.writeHead(200, {'Content-Type': 'application/json'}).end('{"name":"old-server"}')
            } else {
                response.writeHead(404, {'Content-Type': 'text/html'}).end('Not found')
            }
        })
        await new Promise<void>((resolveListen, reject) => {
            olderServer.once('error', reject)
            olderServer.listen(0, '127.0.0.1', () => {
                olderServer.off('error', reject)
                resolveListen()
            })
        })
        cleanup.push(() => new Promise<void>((resolveClose, reject) =>
            olderServer.close((error) => error ? reject(error) : resolveClose())))
        const address = olderServer.address()
        if (!address || typeof address === 'string') throw new Error('Older test server did not bind')
        const oldDev = {
            url: `http://127.0.0.1:${address.port}/?t=old-token`,
            token: 'old-token',
        }
        await mkdir(resolve(root, '.kite3d'), {recursive: true})
        await writeFile(resolve(root, '.kite3d/dev.json'), JSON.stringify(oldDev))
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

        const result = await checkProject(root)

        expect(result.mode).toBe('headless')
        expect(result.ok).toBe(true)
        expect(warning).toHaveBeenCalledOnce()
        expect(warning).toHaveBeenCalledWith(expect.stringContaining('Restart kite3d dev'))
        expect(JSON.parse(await readFile(resolve(root, '.kite3d/check.json'), 'utf8'))).toMatchObject({ok: true})
        expect(JSON.parse(await readFile(resolve(root, '.kite3d/dev.json'), 'utf8'))).toEqual(oldDev)
        warning.mockRestore()
    })

    it('imports configured scripts, lists their types, and validates plugins, generators, and scene components', async () => {
        const root = await project({
            scripts: ['./Player.script.js'],
            plugins: ['./LocalPlugin.js'],
        }, [{
            name: 'Player',
            mesh: 0,
            extras: {EntityComponentPlugin: {
                player: {type: 'PlayerComponent', state: {}},
                generator: {type: 'Generator', state: {module: './generators/level.js'}},
            }},
        }])
        await writeFile(resolve(root, 'Player.script.js'), `
import {Object3DComponent} from 'threepipe'
export class Player extends Object3DComponent { static ComponentType = 'PlayerComponent' }
`)
        await writeFile(resolve(root, 'LocalPlugin.js'), `
import {AViewerPluginSync} from 'threepipe'
export default class LocalPlugin extends AViewerPluginSync { static PluginType = 'LocalPlugin' }
`)
        await mkdir(resolve(root, 'generators'), {recursive: true})
        await writeFile(resolve(root, 'generators/level.js'), `
export default ({engine}) => new engine.Mesh(new engine.BoxGeometry(1, 1, 1), new engine.MeshStandardMaterial())
`)

        const result = await checkProject(root)

        expect(result.ok, JSON.stringify(result, null, 2)).toBe(true)
        expect(result.componentTypes).toContain('PlayerComponent')
        expect(result.mode).toBe('headless')
        expect(result.outcomes).toEqual([
            expect.objectContaining({name: 'Playable', status: 'pass'}),
            expect.objectContaining({name: 'Editable', status: 'pass'}),
            expect.objectContaining({name: 'Persisted', status: 'pass'}),
        ])
        expect(result.rows).toEqual(expect.arrayContaining([
            expect.objectContaining({kind: 'script', status: 'pass', detail: 'PlayerComponent'}),
            expect.objectContaining({kind: 'plugin', status: 'pass'}),
            expect.objectContaining({kind: 'generator', status: 'pass'}),
            expect.objectContaining({kind: 'component', status: 'pass', detail: 'PlayerComponent'}),
        ]))
        expect(JSON.parse(await readFile(resolve(root, '.kite3d/check.json'), 'utf8'))).toMatchObject({ok: true})
        expect(await readFile(resolve(root, '.kite3d/console.log'), 'utf8'))
            .toContain('[kite3d check] Playable=pass Editable=pass Persisted=pass')
    })

    it('resolves exact dependency keys and reports normalized project module paths', async () => {
        const root = await project({
            scripts: ['scripts/Local.script.js', {import: 'declared-script', active: false}],
            plugins: ['plugins/Local.plugin.js'],
        }, [{
            name: 'Player',
            mesh: 0,
            extras: {EntityComponentPlugin: {
                local: {type: 'LocalComponent', state: {}},
            }},
        }])
        const packagePath = resolve(root, 'package.json')
        const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as Record<string, unknown>
        packageJson.dependencies = {'declared-script': '1.0.0'}
        await writeFile(packagePath, JSON.stringify(packageJson))
        await mkdir(resolve(root, 'node_modules/declared-script'), {recursive: true})
        await writeFile(resolve(root, 'node_modules/declared-script/package.json'), JSON.stringify({
            name: 'declared-script', version: '1.0.0', type: 'module', main: './index.js',
        }))
        await writeFile(resolve(root, 'node_modules/declared-script/index.js'), 'export const dependencyLoaded = true\n')
        await mkdir(resolve(root, 'scripts'), {recursive: true})
        await writeFile(resolve(root, 'scripts/Local.script.js'), `
import {Object3DComponent} from 'threepipe'
export class Local extends Object3DComponent { static ComponentType = 'LocalComponent' }
`)
        await mkdir(resolve(root, 'plugins'), {recursive: true})
        await writeFile(resolve(root, 'plugins/Local.plugin.js'), `
import {AViewerPluginSync} from 'threepipe'
export default class LocalPlugin extends AViewerPluginSync { static PluginType = 'LocalPlugin' }
`)

        const result = await checkProject(root)

        expect(result.ok, JSON.stringify(result, null, 2)).toBe(true)
        expect(result.rows).toEqual(expect.arrayContaining([
            expect.objectContaining({kind: 'script', path: 'scripts/Local.script.js', status: 'pass'}),
            expect.objectContaining({kind: 'script', path: 'declared-script', status: 'pass'}),
            expect.objectContaining({kind: 'plugin', path: 'plugins/Local.plugin.js', status: 'pass'}),
        ]))
    })

    it('measures Editable before components hide their authored preview in start', async () => {
        const root = await project({scripts: ['scripts/HidePreview.script.js']}, [{
            name: 'Preview',
            mesh: 0,
            extras: {EntityComponentPlugin: {
                preview: {type: 'HidePreview', state: {}},
            }},
        }])
        await mkdir(resolve(root, 'scripts'), {recursive: true})
        await writeFile(resolve(root, 'scripts/HidePreview.script.js'), `
import {Object3DComponent} from 'threepipe'
export class HidePreview extends Object3DComponent {
    static ComponentType = 'HidePreview'
    start() { this.object.visible = false }
}
`)

        const result = await checkProject(root)

        expect(result.ok, JSON.stringify(result, null, 2)).toBe(true)
        expect(result.outcomes).toContainEqual(expect.objectContaining({name: 'Editable', status: 'pass'}))
    })

    it('records and prints project validation results on Playable pass and fail', async () => {
        const root = await project({}, [{name: 'Triangle', mesh: 0}])
        const writeValidation = (status: 'pass' | 'fail') => writeFile(resolve(root, 'main.js'), `
import {registerGameValidation} from '@blitzdev/engine'
export function main() {
    registerGameValidation(() => ({status: '${status}', summary: 'Fixture validation ${status}.'}))
}
`)

        await writeValidation('pass')
        const passing = await checkProject(root)
        expect(passing.outcomes).toContainEqual(expect.objectContaining({
            name: 'Playable',
            status: 'pass',
            report: expect.objectContaining({projectValidation: expect.objectContaining({status: 'pass'})}),
        }))
        expect(formatCheckTable(passing)).toContain('Project validation PASS: Fixture validation pass.')

        await writeValidation('fail')
        const failing = await checkProject(root)
        expect(failing.outcomes).toContainEqual(expect.objectContaining({
            name: 'Playable',
            status: 'fail',
            report: expect.objectContaining({projectValidation: expect.objectContaining({status: 'fail'})}),
        }))
        expect(formatCheckTable(failing)).toContain('Project validation FAIL: Fixture validation fail.')
    })

    it('records all path, import, and registration failures and blocks publish unless skipped', async () => {
        const root = await project({
            scripts: ['./Broken.script.js'],
            plugins: ['./MissingPlugin.js'],
        }, [{
            name: 'Broken Node',
            extras: {EntityComponentPlugin: {
                unknown: {type: 'UnknownComponent', state: {}},
                generator: {type: 'Generator', state: {module: './generators/missing.js'}},
            }},
        }])
        await writeFile(resolve(root, 'Broken.script.js'), 'throw new Error("top-level failure")\n')
        const backend = await startMockBackend()
        cleanup.push(() => backend.close())

        const result = await checkProject(root)

        expect(result.ok).toBe(false)
        expect(result.rows.filter(({status}) => status === 'fail')).toEqual(expect.arrayContaining([
            expect.objectContaining({kind: 'script', detail: expect.stringContaining('top-level failure')}),
            expect.objectContaining({kind: 'plugin', detail: 'file not found'}),
            expect.objectContaining({kind: 'component', detail: 'UnknownComponent is not registered'}),
            expect.objectContaining({kind: 'generator', detail: 'file not found'}),
        ]))
        await expect(publishFromDisk(root, {slug: 'blocked-check', backendUrl: backend.url}))
            .rejects.toThrow('Project check failed')
        expect(backend.requests).toHaveLength(0)

        await expect(publishFromDisk(root, {slug: 'skipped-check', backendUrl: backend.url, noCheck: true}))
            .resolves.toMatchObject({release_hash: expect.any(String)})
    })
})

async function project(kite3d: Record<string, unknown>, nodes: unknown[]): Promise<string> {
    const root = await mkdtemp(resolve(tmpdir(), 'kite3d-check-'))
    cleanup.push(() => rm(root, {recursive: true, force: true}))
    await mkdir(resolve(root, 'assets'), {recursive: true})
    await mkdir(resolve(root, 'node_modules/@blitzdev/engine/dist'), {recursive: true})
    await writeFile(resolve(root, 'package.json'), JSON.stringify({
        name: 'check-project',
        type: 'module',
        mainScene: 'assets/main.scene.gltf',
        devDependencies: {'kite3d': KITE3D_VERSION},
        kite3d: {version: KITE3D_VERSION, ...kite3d},
    }))
    await writeFile(resolve(root, 'assets/main.scene.gltf'), JSON.stringify({
        asset: {version: '2.0'},
        scene: 0,
        scenes: [{nodes: nodes.map((_, index) => index)}],
        nodes,
        meshes: [{primitives: [{attributes: {POSITION: 0}}]}],
        accessors: [{bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-1, -1, 0], max: [1, 1, 0]}],
        bufferViews: [{buffer: 0, byteOffset: 0, byteLength: 36, target: 34962}],
        buffers: [{byteLength: 36, uri: 'data:application/octet-stream;base64,AAAAAAAAgD8AAAAAAAAAAAAAAIA/AAAAAAAAAAAAAAAAAACAPwAAAAA='}],
    }))
    await writeFile(resolve(root, 'assets.json'), '{"files":{},"version":1}')
    await writeFile(resolve(root, 'main.js'), 'export async function main() {}\n')
    await writeFile(resolve(root, 'node_modules/@blitzdev/engine/package.json'), JSON.stringify({version: KITE3D_VERSION}))
    await writeFile(resolve(root, 'node_modules/@blitzdev/engine/dist/runtime.js'), 'mock Kite3D runtime')
    await symlink(resolve(import.meta.dirname, '../../../node_modules/threepipe'), resolve(root, 'node_modules/threepipe'))
    return root
}
