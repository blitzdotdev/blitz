import {afterEach, describe, expect, it, vi} from 'vitest'
import {
    BlitzApi,
    canonicalizeManifest,
    generateIndexHtml,
    manifestHash,
    pullProject,
    publishProject,
    readDeploys,
    sha256,
    walkProject,
    writeDeploys,
} from '../src/index.ts'
import type {
    DeployEntry,
    DeploysFile,
    ReleaseManifest,
} from '../src/index.ts'
import {FakeDirectory} from './fakeDirectory.ts'
import manifestGoldenFixtures from './fixtures/manifest-golden.json'
import {BLITZ_VERSION} from '../src/versions.ts'
import {startMockBackend, type MockBackend} from './mockBackend.ts'

const backends: MockBackend[] = []

afterEach(async () => {
    while (backends.length) await backends.pop()!.close()
})

const MANIFEST_GOLDENS = {
    comprehensive: {
        canonical: `{"files":{"_blitz/runtime.js":{"sha256":"${'d'.repeat(64)}","size":98765,"mime":"text/javascript; charset=utf-8"},"assets/models/ship.glb":{"sha256":"${'a'.repeat(64)}","size":2048,"mime":"model/gltf-binary"},"copies/nested/ship.glb":{"sha256":"${'a'.repeat(64)}","size":2048,"mime":"model/gltf-binary"},"index.html":{"sha256":"${'c'.repeat(64)}","size":321,"mime":"text/html; charset=utf-8"},"z-last.bin":{"sha256":"${'b'.repeat(64)}","size":17}}}`,
        releaseHash: 'ac12513ae334cd5a04954f2f22ff324ba6046bf92ff0a38388f8881f80a4b023',
    },
    minimal: {
        canonical: `{"files":{"main.js":{"sha256":"${'e'.repeat(64)}","size":0}}}`,
        releaseHash: '861ff3c694bdac9d86bcf9894294d578ae6dc7334a1f2a06675467d0e852e9a3',
    },
} as const

describe('walkProject', () => {
    it('uses the fixed exclusions and does not interpret .gitignore', async () => {
        const root = new FakeDirectory('project')
        root.set('main.js', 'main')
        root.set('.env', 'secret')
        root.set('.env.production', 'secret')
        root.set('package-lock.json', '{}')
        root.set('debug.log', 'debug')
        root.set('.eslintrc.json', '{}')
        root.set('.gitignore', 'keep-me.txt')
        root.set('keep-me.txt', 'kept')
        root.set('.blitz/deploys.json', '{}')
        root.set('.git/config', 'config')
        root.set('node_modules/pkg/index.js', 'dependency')
        root.set('dist/index.js', 'build')
        root.set('assets/.hidden.glb', 'hidden')
        root.set('assets/model.glb', 'model')
        root.set('AGENTS.md', 'private agent instructions')
        root.set('DESIGN.md', 'private design notes')
        root.set('README.md', 'public readme')
        root.set('samples/example.js', 'sample')
        root.set('tools/build.mjs', 'tool')
        root.set('docs/guide.md', 'nested documentation')

        expect((await walkProject(root.asHandle())).map(({path}) => path)).toEqual([
            'README.md',
            'assets/model.glb',
            'docs/guide.md',
            'keep-me.txt',
            'main.js',
        ])
    })

    it('honors project publish exclusion globs', async () => {
        const root = new FakeDirectory('project')
        root.set('main.js', 'main')
        root.set('tools/build.mjs', 'private tool')
        root.set('notes/draft.txt', 'draft')

        expect((await walkProject(root.asHandle(), {exclude: ['tools/**', '**/*.txt']})).map(({path}) => path))
            .toEqual(['main.js'])
    })
})

describe('release manifests', () => {
    // The private blitz-cloud repo carries an identical copy of these fixtures and constants; both must change together.
    it('matches the backend golden canonical JSON and release hashes', async () => {
        for (const name of ['comprehensive', 'minimal'] as const) {
            const manifest = manifestGoldenFixtures[name] as ReleaseManifest
            expect(canonicalizeManifest(manifest)).toBe(MANIFEST_GOLDENS[name].canonical)
            expect(await manifestHash(manifest)).toBe(MANIFEST_GOLDENS[name].releaseHash)
        }
    })
})

describe('generateIndexHtml', () => {
    it('uses relative runtime paths and maps only declared extra dependencies', () => {
        const html = generateIndexHtml({
            name: 'A <Game>',
            version: BLITZ_VERSION,
            runtimeHash: 'abc123',
            dependencies: [
                {key: 'threepipe', version: '0.5.1'},
                {key: 'extra-package', version: '1.2.3'},
            ],
        })
        const importMapText = html.match(/<script type="importmap">(.*?)<\/script>/s)?.[1]
        const importMap = JSON.parse(importMapText || '{}') as {imports: Record<string, string>}
        expect(importMap.imports.threepipe).toBe('./_blitz/runtime.js')
        expect(importMap.imports.three).toBe('./_blitz/runtime.js')
        expect(importMap.imports['@blitzdev/engine']).toBe('./_blitz/runtime.js')
        expect(importMap.imports['extra-package']).toContain('https://esm.sh/extra-package@1.2.3?external=')
        expect(importMap.imports['extra-package']).toContain('threepipe,three,uiconfig.js,ts-browser-helpers,@blitzdev/engine,extra-package')
        expect(html).toContain("import {createGame} from './_blitz/runtime.js'")
        expect(html).toContain("base:new URL('./',location.href).href")
        expect(html).not.toContain('"/_blitz/runtime.js"')
        expect(html).toContain('<title>A &lt;Game&gt;</title>')
        expect(html).toContain(`<meta name="blitz-runtime" content="${BLITZ_VERSION} abc123">`)
        expect(html).toContain('<link rel="icon" href="./icon.svg">')
    })

    it('does not publish file dependency specs or local paths in the import map', () => {
        const html = generateIndexHtml({
            name: 'Tarball Game',
            version: BLITZ_VERSION,
            runtimeHash: 'abc123',
            dependencies: [
                {key: '@blitzdev/engine', version: 'file:../../packs/engine.tgz'},
                {key: '@blitzdev/editor', version: 'file:../../packs/editor.tgz'},
                {key: 'local-tools', version: 'file:../tools'},
                {key: 'extra-package', version: '^1.2.3'},
            ],
        })
        const importMap = readImportMap(html)

        expect(importMap.imports['@blitzdev/engine']).toBe('./_blitz/runtime.js')
        expect(importMap.imports).not.toHaveProperty('@blitzdev/editor')
        expect(importMap.imports).not.toHaveProperty('local-tools')
        expect(JSON.stringify(importMap)).not.toContain('../../packs')
    })
})

describe('.blitz/deploys.json', () => {
    it('round trips the documented schema', async () => {
        const root = new FakeDirectory('project')
        const deploys: DeploysFile = {games: {sample: {
            game_id: 'game-id',
            deploy_token: 'tp_token',
            claim_secret: 'claim-secret',
            preview_url: 'https://gateway.example/sample/',
            expires_at: '2026-09-10 01:00:00',
            last_release_hash: 'a'.repeat(64),
        }}}
        await writeDeploys(root.asHandle(), deploys)
        expect(await readDeploys(root.asHandle())).toEqual(deploys)
    })
})

describe('publishProject', () => {
    it('creates, prepares, uploads four at a time, releases, and reuses the base release', async () => {
        const root = sampleProject()
        const {api, backend} = await testApi()
        const progress: string[] = []
        const first = await publishProject({
            dirHandle: root.asHandle(),
            api,
            slug: 'sample-game',
            onProgress: ({phase}) => progress.push(phase),
        })

        expect(first).toEqual({
            preview_url: `${backend.url}/preview/sample-game/`,
            release_hash: `${'0'.repeat(63)}1`,
        })
        const paths = backend.requests.map(({path}) => path)
        expect(paths[0]).toContain('/api/v1/new-game/sample-game')
        expect(paths.findIndex((path) => path.includes('/runtimes/')))
            .toBeLessThan(paths.findIndex((path) => path.endsWith('/blobs/missing')))
        expect(paths.findLastIndex((path) => path.includes('/blobs/')))
            .toBeLessThan(paths.findIndex((path) => path.endsWith('/releases')))
        expect(backend.maxActiveUploads).toBe(4)
        expect(releaseRequest(backend).body).not.toHaveProperty('base_release')
        expect(progress.at(-1)).toBe('complete')
        expect(JSON.parse(await root.text('package.json')).blitz.version).toBe(BLITZ_VERSION)
        expect(await root.text('index.html')).toContain("./_blitz/runtime.js")
        const stored = await readDeploys(root.asHandle())
        expect(stored.games['sample-game'].last_release_hash).toBe(first.release_hash)

        const requestCount = backend.requests.length
        await publishProject({dirHandle: root.asHandle(), api, slug: 'sample-game', message: 'second'})
        expect(backend.requests.slice(requestCount).some(({path}) => path.includes('/new-game/'))).toBe(false)
        expect(releaseRequest(backend).body).toMatchObject({message: 'second', base_release: first.release_hash})
        expect(await root.text('index.html')).toContain('<title>Sample Game</title>')
    })

    it('uses blitz.name by default and preserves the backend game name on updates', async () => {
        const root = sampleProject()
        const packageJson = JSON.parse(await root.text('package.json'))
        packageJson.name = 'package-slug-name'
        packageJson.blitz.name = 'Configured Game Name'
        root.set('package.json', JSON.stringify(packageJson))
        const {api, backend} = await testApi()

        await publishProject({dirHandle: root.asHandle(), api, slug: 'name-game'})
        expect(backend.games.get('name-game')?.name).toBe('Configured Game Name')

        backend.games.get('name-game')!.name = 'Live Renamed Game'
        await publishProject({dirHandle: root.asHandle(), api, slug: 'name-game'})
        expect(await root.text('index.html')).toContain('<title>Live Renamed Game</title>')

        await publishProject({dirHandle: root.asHandle(), api, slug: 'name-game', name: 'Explicit Update Name'})
        expect(await root.text('index.html')).toContain('<title>Explicit Update Name</title>')
    })

    it('uses the exact project pin for blitz.version and the runtime lookup', async () => {
        const root = sampleProject()
        const pinned = '9.8.7'
        root.set('package.json', JSON.stringify({
            name: 'Pinned Game',
            devDependencies: {'@blitzdev/blitz': pinned},
            blitz: {version: '1.2.3'},
        }))
        const {api, backend} = await testApi({runtimeVersions: [pinned]})

        await publishProject({dirHandle: root.asHandle(), api, slug: 'pinned-game'})

        expect(backend.requests.some(({path}) => path.endsWith(`/runtimes/${pinned}`))).toBe(true)
        expect(JSON.parse(await root.text('package.json')).blitz.version).toBe(pinned)
    })

    it.each(['file:../../blitz-packs/blitzdev-blitz.tgz', '^9.8.0'])(
        'uses the installed engine version when the Blitz spec is %s',
        async (spec) => {
            const root = sampleProject()
            root.set('package.json', JSON.stringify({
                name: 'Installed Version Game',
                devDependencies: {'@blitzdev/blitz': spec},
                blitz: {version: '1.2.3'},
            }))
            installEngine(root, '9.8.7', 'installed runtime')
            const {api, backend} = await testApi({runtimeVersions: ['9.8.7']})

            await publishProject({dirHandle: root.asHandle(), api, slug: 'installed-version-game'})

            expect(backend.requests.some(({path}) => path.endsWith('/runtimes/9.8.7'))).toBe(true)
            expect(JSON.parse(await root.text('package.json')).blitz.version).toBe('9.8.7')
        },
    )

    it('publishes installed runtime bytes and only uses the registry for a mismatch warning', async () => {
        const root = sampleProject()
        installEngine(root, BLITZ_VERSION, 'new local runtime with Generator')
        const localRuntime = await root.file('node_modules/@blitzdev/engine/dist/runtime.js')
        const localHash = await sha256(localRuntime)
        const {api, backend} = await testApi()
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

        await publishProject({dirHandle: root.asHandle(), api, slug: 'local-runtime'})

        const release = releaseRequest(backend).body as ReleaseManifest
        expect(release.files['_blitz/runtime.js']).toMatchObject({
            sha256: localHash,
            size: localRuntime.size,
            mime: 'text/javascript; charset=utf-8',
        })
        const upload = backend.requests.find(({method, path}) => method === 'PUT' && path.endsWith(`/blobs/${localHash}`))
        expect((upload?.body as Buffer).toString()).toBe('new local runtime with Generator')
        expect(await root.text('index.html')).toContain(`<meta name="blitz-runtime" content="${BLITZ_VERSION} ${localHash}">`)
        expect(warning).toHaveBeenCalledWith(expect.stringContaining('publishing the installed runtime'))
        warning.mockRestore()
    })

    it('uploads a sanitized package manifest and sends its description as release metadata', async () => {
        const root = sampleProject()
        const packageJson = JSON.parse(await root.text('package.json'))
        packageJson.description = 'A tiny sample world.'
        packageJson.devDependencies.extra = 'file:../private-dev-tool'
        packageJson.dependencies.local = 'file:../local-package'
        packageJson.peerDependencies = {shared: 'file:../shared', public: '^1.0.0'}
        root.set('package.json', JSON.stringify(packageJson))
        const {api, backend} = await testApi()

        await publishProject({dirHandle: root.asHandle(), api, slug: 'sanitized-package'})

        const request = releaseRequest(backend)
        expect(request.body).toMatchObject({metadata: {description: 'A tiny sample world.'}})
        const release = request.body as ReleaseManifest
        const packageHash = release.files['package.json'].sha256
        const packageUpload = backend.requests.find(({method, path}) => method === 'PUT' && path.endsWith(`/blobs/${packageHash}`))
        const uploadedPackage = JSON.parse((packageUpload?.body as Buffer).toString())
        expect(uploadedPackage).not.toHaveProperty('devDependencies')
        expect(uploadedPackage.dependencies).not.toHaveProperty('local')
        expect(uploadedPackage.peerDependencies).toEqual({public: '^1.0.0'})
        expect(JSON.parse(await root.text('package.json'))).toHaveProperty('devDependencies')
    })

    it('applies blitz.publish.exclude to the release manifest', async () => {
        const root = sampleProject()
        const packageJson = JSON.parse(await root.text('package.json'))
        packageJson.blitz.publish = {exclude: ['tools/**', 'AGENTS.md']}
        root.set('package.json', JSON.stringify(packageJson))
        root.set('tools/build.mjs', 'private build helper')
        root.set('AGENTS.md', 'private instructions')
        root.set('public.txt', 'ship this')
        const {api, backend} = await testApi()

        await publishProject({dirHandle: root.asHandle(), api, slug: 'exclude-game'})

        const release = releaseRequest(backend).body as ReleaseManifest
        expect(release.files).toHaveProperty('public.txt')
        expect(release.files).not.toHaveProperty('tools/build.mjs')
        expect(release.files).not.toHaveProperty('AGENTS.md')
    })

    it('continues when the installed runtime version is not registered', async () => {
        const root = sampleProject()
        const {api} = await testApi({runtimeVersions: []})
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

        await expect(publishProject({dirHandle: root.asHandle(), api, slug: 'missing-runtime'}))
            .resolves.toMatchObject({release_hash: expect.any(String)})
        expect(warning).toHaveBeenCalledWith(expect.stringContaining('is not registered'))
        warning.mockRestore()
    })

    it('leaves strict runtime enforcement to the release endpoint', async () => {
        const root = sampleProject()
        const {api} = await testApi({runtimeStatus: 503, releaseStatus: 409})
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

        await expect(publishProject({dirHandle: root.asHandle(), api, slug: 'strict-runtime'}))
            .rejects.toThrow('unregistered_runtime')
        expect(warning).toHaveBeenCalledWith(expect.stringContaining('Could not compare runtime'))
        warning.mockRestore()
    })
})

describe('pullProject', () => {
    it('reports nothing to pull when a game was created but has no published release', async () => {
        const root = new FakeDirectory('pull-before-publish')
        const {api} = await testApi()
        const entry = deployEntry(await api.createAnonymousGame({slug: 'pull-before-publish'}))
        await writeDeploys(root.asHandle(), {games: {'pull-before-publish': entry}})

        await expect(pullProject({dirHandle: root.asHandle(), api, entry}))
            .rejects.toThrow('There is nothing to pull before the first publish')
    })

    it('downloads changed source files, skips generated files, and records the active release', async () => {
        const root = new FakeDirectory('pull')
        root.set('package.json', '{"name":"old"}')
        root.set('main.js', 'same')
        const {api, backend} = await testApi()
        const entry = deployEntry(await api.createAnonymousGame({slug: 'pull-game'}))
        const nextPackage = new Blob(['{"name":"new"}'])
        const sameMain = new Blob(['same'])
        const runtime = new Blob(['runtime'])
        const previous = await putRemoteRelease(api, {
            'package.json': new Blob(['{"name":"old"}']),
            'main.js': sameMain,
        })
        const remote = await putRemoteRelease(api, {
            'index.html': new Blob(['x']),
            '_blitz/runtime.js': runtime,
            'package.json': nextPackage,
            'main.js': sameMain,
        })
        entry.last_release_hash = previous.release_hash
        await writeDeploys(root.asHandle(), {games: {'pull-game': entry}})

        const result = await pullProject({dirHandle: root.asHandle(), api, entry})
        expect(result).toEqual({release_hash: remote.release_hash, updated: ['package.json'], kept: []})
        expect(await root.text('package.json')).toBe('{"name":"new"}')
        expect(backend.requests.filter(({method, path}) => method === 'GET' && path.includes('/blobs/')).map(({path}) => path))
            .toEqual([expect.stringContaining(await sha256(nextPackage))])
        expect((await readDeploys(root.asHandle())).games['pull-game'].last_release_hash).toBe(remote.release_hash)
    })

    it('keeps files changed since the last release unless force is set', async () => {
        const root = new FakeDirectory('pull-conflict')
        root.set('main.js', 'local edit')
        const previous = new Blob(['published'])
        const remote = new Blob(['remote edit'])
        const {api} = await testApi()
        const entry = deployEntry(await api.createAnonymousGame({slug: 'pull-conflict'}))
        const previousRelease = await putRemoteRelease(api, {'main.js': previous})
        const remoteRelease = await putRemoteRelease(api, {'main.js': remote})
        entry.last_release_hash = previousRelease.release_hash
        await writeDeploys(root.asHandle(), {games: {'pull-conflict': entry}})

        const kept = await pullProject({dirHandle: root.asHandle(), api, entry})
        expect(kept).toEqual({release_hash: remoteRelease.release_hash, updated: [], kept: ['main.js']})
        expect(await root.text('main.js')).toBe('local edit')

        const forced = await pullProject({dirHandle: root.asHandle(), api, entry, force: true})
        expect(forced).toEqual({release_hash: remoteRelease.release_hash, updated: ['main.js'], kept: []})
        expect(await root.text('main.js')).toBe('remote edit')
    })
})

function sampleProject(): FakeDirectory {
    const root = new FakeDirectory('sample')
    root.set('package.json', JSON.stringify({
        name: 'Sample Game',
        devDependencies: {'@blitzdev/blitz': BLITZ_VERSION},
        blitz: {version: BLITZ_VERSION},
        dependencies: {threepipe: '0.5.1', 'extra-package': '1.0.0'},
    }))
    root.set('assets.json', JSON.stringify({files: {}, version: 1}))
    root.set('main.js', 'export async function main() {}')
    root.set('ignored-by-gitignore.txt', 'still published')
    root.set('.gitignore', 'ignored-by-gitignore.txt')
    root.set('assets/main.scene.gltf', '{"asset":{"version":"2.0"}}')
    root.set('Player.script.js', 'export class Player {}')
    installEngine(root, BLITZ_VERSION, 'mock Blitz runtime')
    return root
}

function installEngine(root: FakeDirectory, version: string, runtime: string): void {
    root.set('node_modules/@blitzdev/engine/package.json', JSON.stringify({version}))
    root.set('node_modules/@blitzdev/engine/dist/runtime.js', runtime)
}

async function testApi(options: Parameters<typeof startMockBackend>[0] = {}) {
    const backend = await startMockBackend(options)
    backends.push(backend)
    return {api: new BlitzApi({baseUrl: backend.url}), backend}
}

function releaseRequest(backend: MockBackend) {
    const request = backend.requests.findLast(({method, path}) => method === 'PUT' && path.endsWith('/releases'))
    if (!request) throw new Error('No release request was recorded')
    return request
}

function deployEntry(created: Awaited<ReturnType<BlitzApi['createAnonymousGame']>>): DeployEntry {
    return {
        game_id: created.game_id,
        deploy_token: created.deploy_token,
        claim_secret: created.claim_secret,
        preview_url: created.preview_url,
        expires_at: created.expires_at,
    }
}

async function putRemoteRelease(api: BlitzApi, files: Record<string, Blob>) {
    const descriptors = await Promise.all(Object.entries(files).map(async ([path, file]) => {
        const hash = await sha256(file)
        await api.uploadBlob(hash, file)
        return [path, {sha256: hash, size: file.size}] as const
    }))
    return api.putRelease({files: Object.fromEntries(descriptors)})
}

function readImportMap(html: string): {imports: Record<string, string>} {
    const text = html.match(/<script type="importmap">(.*?)<\/script>/s)?.[1]
    return JSON.parse(text || '{}') as {imports: Record<string, string>}
}
