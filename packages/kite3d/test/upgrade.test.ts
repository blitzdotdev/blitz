import {access, chmod, cp, mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises'
import {delimiter, resolve} from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {selectProjectMigrations, upgradeProject} from '../src/commands.ts'
import {checkProject} from '../src/check.ts'
import {doctorProject, type DoctorResult} from '../src/doctor.ts'
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
            const restorePath = await useFakeNpm(root, 'hoisted')

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

    it.each([
        ['@blitzdev/engine', 'file:../../blitz-packs/blitzdev-engine-0.12.0.tgz', 'dependencies', undefined,
            `Removed @blitzdev/engine from dependencies; kite3d provides ${KITE3D_VERSION}.`],
        ['@blitzdev/editor', 'link:../../blitz/packages/editor', 'devDependencies', undefined,
            `Removed @blitzdev/editor from devDependencies; kite3d provides ${KITE3D_VERSION}.`],
        ['@blitzdev/template', 'https://example.com/blitzdev-template-0.12.0.tgz', 'dependencies', undefined,
            `Removed @blitzdev/template from dependencies; kite3d provides ${KITE3D_VERSION}.`],
        ['@blitzdev/engine', '0.12.0', 'devDependencies', KITE3D_VERSION,
            `Pinned @blitzdev/engine to ${KITE3D_VERSION} in devDependencies.`],
        ['@blitzdev/editor', '^0.12.0', 'dependencies', KITE3D_VERSION,
            `Pinned @blitzdev/editor to ${KITE3D_VERSION} in dependencies.`],
    ] as const)(
        'migrates direct package %s with specifier %s from %s',
        async (packageName, specifier, section, expected, change) => {
            const root = await legacyUpgradeFixture('0.12.2', 'devDependencies')
            const packagePath = resolve(root, 'package.json')
            const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as {
                dependencies?: Record<string, string>
                devDependencies?: Record<string, string>
            }
            packageJson[section] = {...packageJson[section], [packageName]: specifier}
            await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)

            const changes = await migrateLegacyProject(root, KITE3D_VERSION)
            const migrated = JSON.parse(await readFile(packagePath, 'utf8')) as typeof packageJson

            expect(migrated[section]?.[packageName]).toBe(expected)
            expect(changes).toContain(change)
        },
    )

    it('aligns direct package entries during a normal targeted upgrade', async () => {
        const root = await upgradeFixture()
        const packagePath = resolve(root, 'package.json')
        const packageLockPath = resolve(root, 'package-lock.json')
        const treeMarkerPath = resolve(root, 'node_modules/tree-marker.txt')
        const packageJson = JSON.parse(await readFile(packagePath, 'utf8'))
        packageJson.dependencies = {
            '@blitzdev/editor': '^1.0.0',
            '@blitzdev/template': 'https://example.com/blitzdev-template-1.0.0.tgz',
        }
        packageJson.devDependencies['@blitzdev/engine'] = 'file:../../packs/blitzdev-engine-1.0.0.tgz'
        await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)
        await writeFile(packageLockPath, '{"lockfileVersion":3}\n')
        await writeFile(treeMarkerPath, 'existing install tree\n')
        const restorePath = await useFakeNpm(root)

        let result: Awaited<ReturnType<typeof upgradeProject>>
        try {
            result = await upgradeProject(root, {to: '2.0.0'})
        } finally {
            restorePath()
        }

        expect(result.changes).toEqual([
            'Pinned @blitzdev/editor to 2.0.0 in dependencies.',
            'Removed @blitzdev/template from dependencies; kite3d provides 2.0.0.',
            'Removed @blitzdev/engine from devDependencies; kite3d provides 2.0.0.',
        ])
        expect(JSON.parse(await readFile(packagePath, 'utf8'))).toMatchObject({
            dependencies: {'@blitzdev/editor': '2.0.0'},
            devDependencies: {kite3d: '2.0.0'},
            kite3d: {version: '2.0.0'},
        })
        expect(JSON.parse(await readFile(packagePath, 'utf8')).dependencies)
            .not.toHaveProperty('@blitzdev/template')
        expect(JSON.parse(await readFile(packagePath, 'utf8')).devDependencies)
            .not.toHaveProperty('@blitzdev/engine')
        expect(await readFile(packageLockPath, 'utf8')).toBe('{"lockfileVersion":3}\n')
        expect(await readFile(treeMarkerPath, 'utf8')).toBe('existing install tree\n')
    })

    it('removes legacy install artifacts before installing a hoisted four-pin project', async () => {
        const root = await fourPinLegacyUpgradeFixture()
        const restorePath = await useFakeNpm(root, 'record-clean-and-hoisted')

        let upgrade: Awaited<ReturnType<typeof upgradeProject>>
        try {
            upgrade = await upgradeProject(root)
        } finally {
            restorePath()
        }

        expect(JSON.parse(await readFile(resolve(root, 'install-state.json'), 'utf8'))).toEqual([])
        expect(upgrade.changes).toEqual(expect.arrayContaining([
            'Removed package-lock.json.',
            'Removed node_modules/.',
        ]))
        const result = await doctorProject(root, {
            port: 0,
            fetch: async () => new Response(null, {status: 503}),
            checkPlaywright: async () => 'fixture browser',
        })
        expect(doctorRow(result, 'packages')).toEqual({
            check: 'packages',
            status: 'pass',
            detail: [
                `kite3d ${KITE3D_VERSION}`,
                `@blitzdev/editor ${KITE3D_VERSION}`,
                `@blitzdev/engine ${KITE3D_VERSION}`,
                `@blitzdev/template ${KITE3D_VERSION}`,
            ].join(', '),
        })
    })

    it('rejects a legacy install that nests the engine under kite3d', async () => {
        const root = await fourPinLegacyUpgradeFixture()
        const restorePath = await useFakeNpm(root, 'nested')

        try {
            await expect(upgradeProject(root)).rejects.toThrow(
                'node_modules/kite3d/node_modules/@blitzdev/engine',
            )
        } finally {
            restorePath()
        }
    })

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

type FakeInstallLayout = 'hoisted' | 'nested' | 'record-clean-and-hoisted'

async function useFakeNpm(root: string, layout?: FakeInstallLayout): Promise<() => void> {
    const bin = resolve(root, 'bin')
    await mkdir(bin)
    const install = layout ? `
import {access, mkdir, readFile, rm, writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
const root = process.cwd()
${layout === 'record-clean-and-hoisted' ? `
const existing = []
for (const name of ['package-lock.json', 'node_modules']) {
    try {
        await access(resolve(root, name))
        existing.push(name)
    } catch (error) {
        if (error.code !== 'ENOENT') throw error
    }
}
await writeFile(resolve(root, 'install-state.json'), JSON.stringify(existing))
` : ''}
await rm(resolve(root, 'node_modules'), {recursive: true, force: true})
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const target = manifest.devDependencies?.kite3d || manifest.dependencies?.kite3d
for (const name of ['kite3d', '@blitzdev/editor', '@blitzdev/engine', '@blitzdev/template']) {
    const direct = manifest.devDependencies?.[name] || manifest.dependencies?.[name]
    const version = name !== 'kite3d' && direct?.startsWith('file:') ? '0.12.0' : target
    const packageRoot = name === 'kite3d' || ${layout !== 'nested'}
        ? resolve(root, 'node_modules', name)
        : resolve(root, 'node_modules/kite3d/node_modules', name)
    await mkdir(packageRoot, {recursive: true})
    const packagePath = resolve(packageRoot, 'package.json')
    const packageJson = JSON.parse(await readFile(packagePath, 'utf8').catch(() => '{}'))
    await writeFile(packagePath, JSON.stringify({...packageJson, name, version}))
}
const engineRoot = ${layout === 'nested'}
    ? resolve(root, 'node_modules/kite3d/node_modules/@blitzdev/engine')
    : resolve(root, 'node_modules/@blitzdev/engine')
await writeFile(resolve(engineRoot, 'package.json'), JSON.stringify({
    name: '@blitzdev/engine',
    version: target,
    type: 'module',
    exports: {
        './package.json': './package.json',
        './projectFormat': './projectFormat.js',
        './migrations': './migrations.js',
    },
}))
await writeFile(resolve(engineRoot, 'projectFormat.js'), \`
export const parsePackageJSON = JSON.parse
export const parseAssetsJSONManifest = JSON.parse
export async function parsePackageJsonSettingsConfig() {}
export function validateSceneSource(_path, text) {
    if (!JSON.parse(text).asset) throw new Error('missing glTF asset')
}
\`)
await writeFile(resolve(engineRoot, 'migrations.js'), 'export const PROJECT_MIGRATIONS = []\\n')
` : ''
    await writeFile(resolve(bin, 'npm'), `#!/usr/bin/env node\n${install}`)
    await chmod(resolve(bin, 'npm'), 0o755)
    const originalPath = process.env.PATH
    process.env.PATH = `${bin}${delimiter}${originalPath || ''}`
    return () => {
        process.env.PATH = originalPath
    }
}

async function fourPinLegacyUpgradeFixture(): Promise<string> {
    const root = await mkdtemp(resolve(import.meta.dirname, 'upgrade-four-pin-'))
    roots.push(root)
    await cp(resolve(import.meta.dirname, 'fixtures/legacy-four-pin-project'), root, {recursive: true})
    await writeFile(resolve(root, 'package-lock.json'), '{"lockfileVersion":3}\n')
    await installRuntimeFixture(root, '0.12.0')
    return root
}

async function installRuntimeFixture(root: string, version: string): Promise<void> {
    for (const name of ['kite3d', '@blitzdev/editor', '@blitzdev/engine', '@blitzdev/template']) {
        const packageRoot = resolve(root, 'node_modules', name)
        await mkdir(packageRoot, {recursive: true})
        await writeFile(resolve(packageRoot, 'package.json'), JSON.stringify({name, version}))
    }
    const engine = resolve(root, 'node_modules/@blitzdev/engine')
    await writeFile(resolve(engine, 'package.json'), JSON.stringify({
        name: '@blitzdev/engine',
        version,
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
    await writeFile(resolve(engine, 'migrations.js'), 'export const PROJECT_MIGRATIONS = []\n')
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
    const root = await mkdtemp(resolve(import.meta.dirname, 'upgrade-legacy-'))
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

function doctorRow(result: DoctorResult, check: DoctorResult['rows'][number]['check']) {
    const found = result.rows.find((candidate) => candidate.check === check)
    if (!found) throw new Error(`Missing doctor row ${check}`)
    return found
}
