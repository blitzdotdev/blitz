import {mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {checkProject} from '../src/check.ts'
import {publishFromDisk} from '../src/commands.ts'
import {BLITZ_VERSION} from '../src/versions.ts'
import {startMockBackend} from './mockBackend.ts'

const cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
    while (cleanup.length) await cleanup.pop()!()
})

describe('blitz check', () => {
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
        expect(JSON.parse(await readFile(resolve(root, '.blitz/check.json'), 'utf8'))).toMatchObject({ok: true})
        expect(await readFile(resolve(root, '.blitz/console.log'), 'utf8'))
            .toContain('[blitz check] Playable=pass Editable=pass Persisted=pass')
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

async function project(blitz: Record<string, unknown>, nodes: unknown[]): Promise<string> {
    const root = await mkdtemp(resolve(tmpdir(), 'blitz-check-'))
    cleanup.push(() => rm(root, {recursive: true, force: true}))
    await mkdir(resolve(root, 'assets'), {recursive: true})
    await mkdir(resolve(root, 'node_modules/@blitzdev/engine/dist'), {recursive: true})
    await writeFile(resolve(root, 'package.json'), JSON.stringify({
        name: 'check-project',
        type: 'module',
        mainScene: 'assets/main.scene.gltf',
        devDependencies: {'@blitzdev/blitz': BLITZ_VERSION},
        blitz: {version: BLITZ_VERSION, ...blitz},
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
    await writeFile(resolve(root, 'node_modules/@blitzdev/engine/package.json'), JSON.stringify({version: BLITZ_VERSION}))
    await writeFile(resolve(root, 'node_modules/@blitzdev/engine/dist/runtime.js'), 'mock Blitz runtime')
    await symlink(resolve(import.meta.dirname, '../../../node_modules/threepipe'), resolve(root, 'node_modules/threepipe'))
    return root
}
