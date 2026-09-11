import assert from 'node:assert/strict'
import {readFile, cp, mkdir, mkdtemp} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {after, test} from 'node:test'
import {rm} from 'node:fs/promises'

import {computeVersion, rewriteManifests} from './set-version.mjs'

const repositoryDirectory = resolve(import.meta.dirname, '..')
const manifestPaths = [
    'package.json',
    'packages/engine/package.json',
    'packages/editor/package.json',
    'packages/kite3d/package.json',
]
const temporaryDirectories = []

after(async () => Promise.all(temporaryDirectories.map(path => rm(path, {recursive: true, force: true}))))

test('computes stable semantic version bumps', () => {
    assert.equal(computeVersion('0.12.0', 'patch'), '0.12.1')
    assert.equal(computeVersion('0.12.0', 'minor'), '0.13.0')
    assert.equal(computeVersion('0.12.0', 'major'), '1.0.0')
    assert.equal(computeVersion('0.12.0', '2.3.4'), '2.3.4')
    assert.throws(() => computeVersion('0.12.0', '^1.0.0'), /Version must be/)
})

test('rewrites copied manifests and exact internal pins', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'kite3d-set-version-test-'))
    temporaryDirectories.push(temporaryDirectory)

    for (const path of manifestPaths) {
        await mkdir(dirname(join(temporaryDirectory, path)), {recursive: true})
        await cp(join(repositoryDirectory, path), join(temporaryDirectory, path))
    }
    await rewriteManifests(temporaryDirectory, '0.12.1')

    for (const path of manifestPaths) {
        const manifest = JSON.parse(await readFile(join(temporaryDirectory, path), 'utf8'))
        assert.equal(manifest.version, '0.12.1')
        for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
            for (const [name, version] of Object.entries(manifest[section] ?? {})) {
                if (['kite3d', '@blitzdev/engine', '@blitzdev/editor'].includes(name)) {
                    assert.equal(version, '0.12.1')
                }
            }
        }
    }
})
