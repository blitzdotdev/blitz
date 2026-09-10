import {chmod, mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises'
import {delimiter, resolve} from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {selectProjectMigrations, upgradeProject} from '../src/commands.ts'

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
            expect(result).toEqual({from: '1.0.0', to: '2.0.0'})
        } finally {
            process.env.PATH = originalPath
        }

        expect(await readFile(resolve(root, 'migration.txt'), 'utf8')).toBe('1.5.0')
        const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as {
            devDependencies: Record<string, string>, blitz: {version: string}
        }
        expect(packageJson.devDependencies['@blitzdev/blitz']).toBe('2.0.0')
        expect(packageJson.blitz.version).toBe('2.0.0')
        const journal = (await readFile(resolve(root, '.blitz/journal.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse)
        expect(journal).toMatchObject([{client: 'blitz-upgrade', summary: {upgrade: {from: '1.0.0', to: '2.0.0'}}}])
    })
})

async function upgradeFixture(): Promise<string> {
    const root = await mkdtemp(resolve(import.meta.dirname, 'upgrade-'))
    roots.push(root)
    await mkdir(resolve(root, 'assets'))
    await mkdir(resolve(root, 'node_modules/@blitzdev/engine'), {recursive: true})
    await writeFile(resolve(root, 'package.json'), JSON.stringify({
        name: 'upgrade-test',
        mainScene: 'assets/main.scene.gltf',
        devDependencies: {'@blitzdev/blitz': '1.0.0'},
        blitz: {version: '1.0.0'},
    }))
    await writeFile(resolve(root, 'assets.json'), '{"files":{},"version":1}')
    await writeFile(resolve(root, 'assets/main.scene.gltf'), '{"asset":{"version":"2.0"}}')
    const engine = resolve(root, 'node_modules/@blitzdev/engine')
    await writeFile(resolve(engine, 'package.json'), JSON.stringify({
        name: '@blitzdev/engine',
        type: 'module',
        exports: {
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
