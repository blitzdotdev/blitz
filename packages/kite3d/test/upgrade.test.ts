import {access, chmod, cp, mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises'
import {delimiter, resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {afterEach, describe, expect, it} from 'vitest'
import {selectProjectMigrations, upgradeProject} from '../src/commands.ts'
import {checkProject} from '../src/check.ts'
import {migrateLegacyProject} from '../src/legacy.ts'
import {KITE3D_VERSION} from '../src/versions.ts'

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

    it.each([
        ['an exact version', '0.12.2', 'devDependencies'],
        ['a range', '^0.12.0', 'dependencies'],
        ['a file tarball', 'file:../../blitz-packs/blitzdev-blitz-0.12.0.tgz', 'devDependencies'],
        ['a link', 'link:../../blitz', 'dependencies'],
        ['a tarball URL', 'https://example.com/blitzdev-blitz-0.12.0.tgz', 'devDependencies'],
    ] as const)(
        'migrates a legacy dependency with %s from %s',
        async (_label, specifier, section) => {
            const root = await legacyUpgradeFixture(specifier, section)
            const restorePath = await useFakeNpm(root)

            let result: Awaited<ReturnType<typeof upgradeProject>>
            try {
                result = await upgradeProject(root)
            } finally {
                restorePath()
            }

            expect(result).toMatchObject({from: '0.12.2', to: KITE3D_VERSION})
            expect(result.changes).toEqual([
                'Renamed .blitz/ to .kite3d/.',
                'Moved package.json key "blitz" to "kite3d".',
                `Replaced @blitzdev/blitz with kite3d ${KITE3D_VERSION} in ${section}.`,
                'Rewrote 1 legacy rootPath value in assets/main.scene.gltf.',
            ])
            await expect(access(resolve(root, '.blitz'))).rejects.toMatchObject({code: 'ENOENT'})
            expect(JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))).toMatchObject({
                [section]: {kite3d: KITE3D_VERSION},
                kite3d: {version: KITE3D_VERSION},
            })
            expect(await readFile(resolve(root, 'assets/main.scene.gltf'), 'utf8')).toContain('/kite3d/@legacy/')
            expect((await checkProject(root)).ok).toBe(true)
        },
    )

    it('leaves the legacy project unchanged when an asset rewrite is not writable', async () => {
        const root = await legacyUpgradeFixture('0.12.2', 'devDependencies')
        const packagePath = resolve(root, 'package.json')
        const assetPath = resolve(root, 'assets/main.scene.gltf')
        const before = {
            package: await readFile(packagePath, 'utf8'),
            asset: await readFile(assetPath, 'utf8'),
            deploys: await readFile(resolve(root, '.blitz/deploys.json'), 'utf8'),
        }
        await chmod(assetPath, 0o444)

        await expect(migrateLegacyProject(root, KITE3D_VERSION)).rejects.toThrow(
            'rewrite legacy root paths in assets/main.scene.gltf',
        )

        expect(await readFile(packagePath, 'utf8')).toBe(before.package)
        expect(await readFile(assetPath, 'utf8')).toBe(before.asset)
        expect(await readFile(resolve(root, '.blitz/deploys.json'), 'utf8')).toBe(before.deploys)
        await expect(access(resolve(root, '.kite3d'))).rejects.toMatchObject({code: 'ENOENT'})
    })

    it('keeps the exact-version rule for --to on a normal upgrade', async () => {
        const root = await upgradeFixture()
        const packagePath = resolve(root, 'package.json')
        const before = await readFile(packagePath, 'utf8')

        await expect(upgradeProject(root, {to: '^2.0.0'})).rejects.toThrow(
            'Kite3D version must be an exact x.y.z version: ^2.0.0',
        )
        expect(await readFile(packagePath, 'utf8')).toBe(before)
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

async function legacyUpgradeFixture(
    specifier: string,
    section: 'dependencies' | 'devDependencies',
): Promise<string> {
    const root = await mkdtemp(resolve(tmpdir(), 'kite3d-legacy-upgrade-'))
    roots.push(root)
    await cp(resolve(import.meta.dirname, 'fixtures/legacy-project'), root, {recursive: true})
    await mkdir(resolve(root, '.blitz'))
    await writeFile(resolve(root, '.blitz/deploys.json'), '{"games":{}}\n')
    const packagePath = resolve(root, 'package.json')
    const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as {
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
    }
    delete packageJson.devDependencies?.['@blitzdev/blitz']
    packageJson[section] = {...packageJson[section], '@blitzdev/blitz': specifier}
    await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)
    return root
}
