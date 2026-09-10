import assert from 'node:assert/strict'
import {readFileSync, writeFileSync} from 'node:fs'
import {readFile, cp, mkdir, mkdtemp, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {after, test} from 'node:test'
import {rm} from 'node:fs/promises'

import {computeVersion, setVersion} from './set-version.mjs'

const repositoryDirectory = resolve(import.meta.dirname, '..')
const manifestPaths = [
    'package.json',
    'packages/engine/package.json',
    'packages/template/package.json',
    'packages/editor/package.json',
    'packages/blitz/package.json',
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

test('rewrites copied manifests, exact internal pins, and refreshes the lockfile', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'blitz-set-version-test-'))
    temporaryDirectories.push(temporaryDirectory)

    for (const path of manifestPaths) {
        await mkdir(dirname(join(temporaryDirectory, path)), {recursive: true})
        await cp(join(repositoryDirectory, path), join(temporaryDirectory, path))
    }
    await writeFile(join(temporaryDirectory, 'package-lock.json'), '{"lockfileVersion":3,"packages":{}}\n')

    const calls = []
    const runCommand = (command, args) => {
        calls.push([command, args])
        if (command === 'git') return ''
        if (command === 'npm') {
            const lockfile = {lockfileVersion: 3, packages: {}}
            for (const path of manifestPaths) {
                const key = path === 'package.json' ? '' : dirname(path)
                lockfile.packages[key] = JSON.parse(readFileSync(join(temporaryDirectory, path), 'utf8'))
            }
            writeFileSync(join(temporaryDirectory, 'package-lock.json'), `${JSON.stringify(lockfile, null, 2)}\n`)
            return ''
        }
        throw new Error(`Unexpected command: ${command}`)
    }

    await setVersion({
        repositoryDirectory: temporaryDirectory,
        requestedVersion: '0.12.1',
        runCommand,
    })

    assert.deepEqual(calls[0], ['git', ['status', '--porcelain']])
    assert.deepEqual(calls[1], ['npm', [
        'install', '--package-lock-only', '--ignore-scripts', '--cache', '/tmp/blitz-npm-cache',
    ]])

    for (const path of manifestPaths) {
        const manifest = JSON.parse(await readFile(join(temporaryDirectory, path), 'utf8'))
        assert.equal(manifest.version, '0.12.1')
        for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
            for (const [name, version] of Object.entries(manifest[section] ?? {})) {
                if (name.startsWith('@blitzdev/')) assert.equal(version, '0.12.1')
            }
        }
    }

    const lockfile = JSON.parse(await readFile(join(temporaryDirectory, 'package-lock.json'), 'utf8'))
    assert.equal(lockfile.packages['packages/editor'].dependencies['@blitzdev/engine'], '0.12.1')
    assert.equal(lockfile.packages['packages/blitz'].dependencies['@blitzdev/template'], '0.12.1')
})
