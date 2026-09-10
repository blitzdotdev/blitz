import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {upgradeProject} from '../src/commands.ts'

const roots: string[] = []

afterEach(async () => {
    while (roots.length) await rm(roots.pop()!, {recursive: true, force: true})
})

describe('upgradeProject', () => {
    it('rewrites both version fields, runs migrations, validates once, and journals', async () => {
        const root = await mkdtemp(resolve(tmpdir(), 'blitz-upgrade-'))
        roots.push(root)
        await mkdir(resolve(root, 'assets'))
        await writeFile(resolve(root, 'package.json'), JSON.stringify({
            name: 'upgrade-test',
            mainScene: 'assets/main.scene.gltf',
            devDependencies: {'@blitzdev/blitz': '1.0.0'},
            blitz: {version: '1.0.0'},
        }))
        await writeFile(resolve(root, 'assets.json'), '{"files":{},"version":1}')
        await writeFile(resolve(root, 'assets/main.scene.gltf'), '{"asset":{"version":"2.0"}}')
        const install = vi.fn(async () => undefined)
        const migrate = vi.fn(async () => undefined)
        const validateSceneSource = vi.fn(() => undefined)

        const result = await upgradeProject(root, {
            to: '2.0.0',
            install,
            loadRuntime: async () => ({
                migrations: [{version: '2.0.0', migrate}],
                tools: {
                    parsePackageJSON: (text) => JSON.parse(text) as Record<string, unknown>,
                    parseAssetsJSONManifest: (text) => JSON.parse(text) as unknown,
                    parsePackageJsonSettingsConfig: async () => ({}),
                    validateSceneSource,
                },
            }),
        })

        expect(result).toEqual({from: '1.0.0', to: '2.0.0'})
        expect(install).toHaveBeenCalledWith(root)
        expect(migrate).toHaveBeenCalledWith(root)
        expect(validateSceneSource).toHaveBeenCalledOnce()
        const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as {
            devDependencies: Record<string, string>, blitz: {version: string}
        }
        expect(packageJson.devDependencies['@blitzdev/blitz']).toBe('2.0.0')
        expect(packageJson.blitz.version).toBe('2.0.0')
        const journal = (await readFile(resolve(root, '.blitz/journal.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse)
        expect(journal).toMatchObject([{client: 'blitz-upgrade', summary: {upgrade: {from: '1.0.0', to: '2.0.0'}}}])
    })
})
