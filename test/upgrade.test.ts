import {access, chmod, cp, mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises'
import {delimiter, resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {afterEach, describe, expect, it} from 'vitest'
import {selectProjectMigrations, upgradeProject} from '../src/commands.ts'
import {checkProject} from '../src/check.ts'

const roots: string[] = []

afterEach(async () => {
    while (roots.length) await rm(roots.pop()!, {recursive: true, force: true})
})

describe('upgradeProject', () => {
    it('selects migrations newer than the project through the target version', () => {
        const migrations = ['0.9.0', '1.0.0', '1.5.0', '2.0.0', '2.1.0']
            .map((version) => ({version, migrate() {}}))

        expect(selectProjectMigrations(migrations, '1.0.0', '2.0.0').map(({version}) => version))
            .toEqual(['1.5.0', '2.0.0'])
    })

    it('installs, loads the installed runtime, migrates, validates, and journals', async () => {
        const root = await upgradeFixture()
        const bin = resolve(root, 'bin')
        const npm = resolve(bin, 'npm')
        await mkdir(bin)
        await writeFile(npm, '#!/bin/sh\nexit 0\n')
        await chmod(npm, 0o755)
        const originalPath = process.env.PATH
        process.env.PATH = `${bin}${delimiter}${originalPath || ''}`

        try {
            const result = await upgradeProject(root, {to: '2.0.0'})
            expect(result).toEqual({from: '1.0.0', to: '2.0.0', changes: []})
        } finally {
            process.env.PATH = originalPath
        }

        expect(await readFile(resolve(root, 'migration.txt'), 'utf8')).toBe('1.5.0')
        const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as {
            devDependencies: Record<string, string>, kite3d: {version: string}
        }
        expect(packageJson.devDependencies['kite3d']).toBe('2.0.0')
        expect(packageJson.kite3d.version).toBe('2.0.0')
        const journal = (await readFile(resolve(root, '.kite3d/journal.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse)
        expect(journal).toMatchObject([{client: 'kite3d-upgrade', summary: {upgrade: {from: '1.0.0', to: '2.0.0'}}}])
    })

    it('migrates the legacy fixture and then passes kite3d check', async () => {
        const root = await mkdtemp(resolve(tmpdir(), 'kite3d-legacy-upgrade-'))
        roots.push(root)
        await cp(resolve(import.meta.dirname, 'fixtures/legacy-project'), root, {recursive: true})
        await mkdir(resolve(root, '.blitz'))
        await writeFile(resolve(root, '.blitz/deploys.json'), '{"games":{}}\n')
        const restorePath = await useFakeNpm(root)

        let result: Awaited<ReturnType<typeof upgradeProject>>
        try {
            result = await upgradeProject(root)
        } finally {
            restorePath()
        }

        expect(result).toMatchObject({from: '0.12.2', to: '0.13.0'})
        expect(result.changes).toEqual([
            'Renamed .blitz/ to .kite3d/.',
            'Moved package.json key "blitz" to "kite3d".',
            'Replaced @blitzdev/blitz with kite3d 0.13.0 in devDependencies.',
            'Rewrote 1 legacy rootPath value in assets/main.scene.gltf.',
        ])
        await expect(access(resolve(root, '.blitz'))).rejects.toMatchObject({code: 'ENOENT'})
        expect(JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))).toMatchObject({
            devDependencies: {kite3d: '0.13.0'},
            kite3d: {version: '0.13.0'},
        })
        expect(await readFile(resolve(root, 'assets/main.scene.gltf'), 'utf8')).toContain('/kite3d/@legacy/')
        expect((await checkProject(root)).ok).toBe(true)
    })
})

async function useFakeNpm(root: string): Promise<() => void> {
    const bin = resolve(root, 'bin')
    await mkdir(bin)
    await writeFile(resolve(bin, 'npm'), '#!/bin/sh\nexit 0\n')
    await chmod(resolve(bin, 'npm'), 0o755)
    const originalPath = process.env.PATH
    process.env.PATH = `${bin}${delimiter}${originalPath || ''}`
    return () => {
        process.env.PATH = originalPath
    }
}

async function upgradeFixture(): Promise<string> {
    const root = await mkdtemp(resolve(import.meta.dirname, 'upgrade-'))
    roots.push(root)
    await mkdir(resolve(root, 'assets'))
    await mkdir(resolve(root, 'node_modules/@blitzdev/engine'), {recursive: true})
    await writeFile(resolve(root, 'package.json'), JSON.stringify({
        name: 'upgrade-test',
        mainScene: 'assets/main.scene.gltf',
        devDependencies: {'kite3d': '1.0.0'},
        kite3d: {version: '1.0.0'},
    }))
    await writeFile(resolve(root, 'assets.json'), '{"files":{},"version":1}')
    await writeFile(resolve(root, 'assets/main.scene.gltf'), '{"asset":{"version":"2.0"}}')
    const engine = resolve(root, 'node_modules/@blitzdev/engine')
    await writeFile(resolve(engine, 'package.json'), JSON.stringify({
        name: '@blitzdev/engine',
        type: 'module',
        exports: {
            './package.json': './package.json',
            './projectFormat': './projectFormat.js',
            './migrations': './migrations.js',
        },
    }))
    await writeFile(resolve(engine, 'projectFormat.js'), `
export const parsePackageJSON = JSON.parse
export const parseAssetsJSONManifest = JSON.parse
export async function parsePackageJsonSettingsConfig() {}
export function validateSceneSource(_path, text) {
    if (!JSON.parse(text).asset) throw new Error('missing glTF asset')
}
`)
    await writeFile(resolve(engine, 'migrations.js'), `
import {writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
export const PROJECT_MIGRATIONS = [
    {version: '0.9.0', migrate() { throw new Error('old migration ran') }},
    {version: '1.5.0', migrate(root) { return writeFile(resolve(root, 'migration.txt'), '1.5.0') }},
    {version: '2.1.0', migrate() { throw new Error('future migration ran') }},
]
`)
    return root
}
