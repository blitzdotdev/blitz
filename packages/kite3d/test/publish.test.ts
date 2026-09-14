import {afterEach, expect, it} from 'vitest'
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import {NodeProjectDirectory, publishFromDisk, readDeploys} from '../src/index.ts'
import {KITE3D_VERSION} from '../src/versions.ts'
import {startMockBackend, type MockBackend} from './mockBackend.ts'

const backends: MockBackend[] = []

const projectRoots: string[] = []

afterEach(async () => {
    while (backends.length) await backends.pop()!.close()
    while (projectRoots.length) await rm(projectRoots.pop()!, {recursive: true, force: true})
})

// Guards the owner's report: release verification failures were not persisted safely.
it('persists a redacted failed result after release verification fails', async () => {
        const root = await diskProject()
        const backend = await startMockBackend({
            corruptPreviewPath: '_blitz/runtime.js',
            failureMessage: 'unused',
        })
        backends.push(backend)

        await expect(publishFromDisk(root, {
            slug: 'status-game', backendUrl: backend.url,
        })).rejects.toThrow('Published file verification failed')

        const deploys = await readDeploys(new NodeProjectDirectory(root).asHandle())
        expect(deploys.games['status-game'].last_release_hash).toMatch(/^[a-f\d]{64}$/)
        expect(deploys.last_publish).toMatchObject({slug: 'status-game', status: 'failed'})
        expect(Date.parse(deploys.last_publish!.updated_at)).not.toBeNaN()
    })

async function diskProject(): Promise<string> {
    const root = await mkdtemp(resolve(tmpdir(), 'kite3d-publish-reliability-'))
    projectRoots.push(root)
    await writeFile(resolve(root, 'package.json'), JSON.stringify({
        name: 'Reliability Game',
        mainScene: 'assets/main.scene.gltf',
        devDependencies: {'kite3d': KITE3D_VERSION},
        kite3d: {version: KITE3D_VERSION},
    }))
    await writeFile(resolve(root, 'assets.json'), JSON.stringify({files: {}, version: 1}))
    await writeFile(resolve(root, 'main.js'), 'export async function main() {}\n')
    await mkdir(resolve(root, 'assets'), {recursive: true})
    await writeFile(resolve(root, 'assets/main.scene.gltf'), '{"asset":{"version":"2.0"}}\n')
    await installDiskEngine(root)
    return root
}

async function installDiskEngine(root: string): Promise<void> {
    const engine = resolve(root, 'node_modules/@kite3d/engine')
    await mkdir(resolve(engine, 'dist'), {recursive: true})
    await writeFile(resolve(engine, 'package.json'), JSON.stringify({version: KITE3D_VERSION}))
    await writeFile(resolve(engine, 'dist/runtime.js'), 'mock Kite3D runtime')
}
