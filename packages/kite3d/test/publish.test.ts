import {afterEach, describe, expect, it, vi} from 'vitest'
import {chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile} from 'node:fs/promises'
import {createServer} from 'node:http'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import {
    Kite3dApi,
    canonicalizeManifest,
    generateIndexHtml,
    manifestHash,
    NodeProjectDirectory,
    publishFromDisk,
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
    PublishProgress,
    ReleaseManifest,
} from '../src/index.ts'
import {FakeDirectory} from './fakeDirectory.ts'
import manifestGoldenFixtures from './fixtures/manifest-golden.json'
import {KITE3D_VERSION} from '../src/versions.ts'
import {startMockBackend, type MockBackend} from './mockBackend.ts'
import {closeTestServer} from './httpServer.ts'
import {FIXTURE_PLUGIN_NAME, installPackedFixturePlugin} from './pluginFixture.ts'

const backends: MockBackend[] = []
const projectRoots: string[] = []

afterEach(async () => {
    while (backends.length) await backends.pop()!.close()
    while (projectRoots.length) await rm(projectRoots.pop()!, {recursive: true, force: true})
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
        root.set('.kite3d/deploys.json', '{}')
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
            version: KITE3D_VERSION,
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
        expect(importMap.imports['@kite3d/engine']).toBe('./_blitz/runtime.js')
        expect(importMap.imports['extra-package']).toContain('https://esm.sh/extra-package@1.2.3?external=')
        expect(importMap.imports['extra-package']).toContain('threepipe,three,uiconfig.js,ts-browser-helpers,@kite3d/engine,extra-package')
        expect(html).toContain("import {createGame} from './_blitz/runtime.js'")
        expect(html).toContain("base:new URL('./',location.href).href")
        expect(html).not.toContain('"/_blitz/runtime.js"')
        expect(html).toContain('<title>A &lt;Game&gt;</title>')
        expect(html).toContain(`<meta name="kite3d-runtime" content="${KITE3D_VERSION} abc123">`)
        expect(html).toContain('<link rel="icon" href="./icon.svg">')
    })

    it('does not publish file dependency specs or local paths in the import map', () => {
        const html = generateIndexHtml({
            name: 'Tarball Game',
            version: KITE3D_VERSION,
            runtimeHash: 'abc123',
            dependencies: [
                {key: '@kite3d/engine', version: 'file:../../packs/engine.tgz'},
                {key: '@kite3d/editor', version: 'file:../../packs/editor.tgz'},
                {key: 'local-tools', version: 'file:../tools'},
                {key: 'extra-package', version: '^1.2.3'},
            ],
        })
        const importMap = readImportMap(html)

        expect(importMap.imports['@kite3d/engine']).toBe('./_blitz/runtime.js')
        expect(importMap.imports).not.toHaveProperty('@kite3d/editor')
        expect(importMap.imports).not.toHaveProperty('local-tools')
        expect(JSON.stringify(importMap)).not.toContain('../../packs')
    })
})

describe('.kite3d/deploys.json', () => {
    it('round trips the documented schema', async () => {
        const root = new FakeDirectory('project')
        const deploys: DeploysFile = {games: {sample: {
            game_id: 'game-id',
            deploy_token: 'tp_token',
            claim_secret: 'claim-secret',
            claim_url: 'https://blitz.dev/claim/sample?secret=claim-secret',
            preview_url: 'https://gateway.example/sample/',
            expires_at: '2026-09-10 01:00:00',
            last_release_hash: 'a'.repeat(64),
        }}}
        await writeDeploys(root.asHandle(), deploys)
        expect(await readDeploys(root.asHandle())).toEqual(deploys)
    })

    it('creates and repairs the disk file with owner-only permissions', async () => {
        const root = await mkdtemp(resolve(tmpdir(), 'kite3d-deploy-mode-'))
        projectRoots.push(root)
        const path = resolve(root, '.kite3d/deploys.json')
        const handle = new NodeProjectDirectory(root).asHandle()

        await writeDeploys(handle, {games: {}})
        expect((await stat(path)).mode & 0o777).toBe(0o600)

        await chmod(path, 0o644)
        await writeDeploys(handle, {games: {}})

        expect((await stat(path)).mode & 0o777).toBe(0o600)
    })
})

describe('publishProject', () => {
    it('publishes only the installed packed plugin files and maps its entry and subpaths', async () => {
        const root = await diskProject()
        await installPackedFixturePlugin(root)
        const packagePath = resolve(root, 'package.json')
        const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as {
            kite3d: {plugins?: string[]}
        }
        packageJson.kite3d.plugins = [FIXTURE_PLUGIN_NAME]
        await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)
        await installDiskEngine(root)
        const {api, backend} = await testApi()

        await publishProject({
            dirHandle: new NodeProjectDirectory(root).asHandle(),
            api,
            slug: 'plugin-package',
        })

        const release = releaseRequest(backend).body as ReleaseManifest
        const pluginRoot = `_blitz/plugins/${FIXTURE_PLUGIN_NAME}`
        expect(Object.keys(release.files).filter((path) => path.startsWith(pluginRoot))).toEqual([
            `${pluginRoot}/Fixture.plugin.js`,
            `${pluginRoot}/README.md`,
            `${pluginRoot}/fixture.worker.js`,
            `${pluginRoot}/package.json`,
            `${pluginRoot}/sidecar.bin`,
        ])
        expect(Object.keys(release.files)).not.toContain(`${pluginRoot}/ignored.js`)
        const html = await readFile(resolve(root, '.kite3d/publish/index.html'), 'utf8')
        const importMap = readImportMap(html)
        expect(importMap.imports[FIXTURE_PLUGIN_NAME])
            .toBe(`./${pluginRoot}/Fixture.plugin.js`)
        expect(importMap.imports[`${FIXTURE_PLUGIN_NAME}/`]).toBe(`./${pluginRoot}/`)
        const packageHash = release.files['package.json'].sha256
        const uploadedPackage = backend.requests.find(({method, path}) =>
            method === 'PUT' && path.endsWith(`/blobs/${packageHash}`))
        expect(JSON.parse((uploadedPackage?.body as Buffer).toString()).dependencies[FIXTURE_PLUGIN_NAME])
            .toBe('1.2.3')
        expect(backend.requests
            .filter(({method, path}) => method === 'GET' && path.includes('/_blitz/plugins/'))
            .map(({path}) => decodeURIComponent(path))).toHaveLength(5)
    })

    it('creates, prepares, uploads four at a time, releases, and reuses the base release', async () => {
        const root = sampleProject()
        const {api, backend} = await testApi()
        const progress: PublishProgress[] = []
        const first = await publishProject({
            dirHandle: root.asHandle(),
            api,
            slug: 'sample-game',
            onProgress: (value) => progress.push(value),
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
        expect(progress.at(-1)?.phase).toBe('complete')
        const uploads = progress.filter(({phase}) => phase === 'uploading')
        expect(uploads.map(({done}) => done)).toEqual(uploads.map((_, index) => index + 1))
        expect(new Set(uploads.map(({path}) => path)).size).toBe(uploads.length)
        expect(JSON.parse(await root.text('package.json')).kite3d.version).toBe(KITE3D_VERSION)
        await expect(root.file('index.html')).rejects.toThrow()
        expect(await root.text('.kite3d/publish/index.html')).toContain("./_blitz/runtime.js")
        const stored = await readDeploys(root.asHandle())
        expect(stored.games['sample-game'].last_release_hash).toBe(first.release_hash)

        const requestCount = backend.requests.length
        await publishProject({dirHandle: root.asHandle(), api, slug: 'sample-game', message: 'second'})
        expect(backend.requests.slice(requestCount).some(({path}) => path.includes('/new-game/'))).toBe(false)
        expect(releaseRequest(backend).body).toMatchObject({message: 'second', base_release: first.release_hash})
        expect(await root.text('.kite3d/publish/index.html')).toContain('<title>Sample Game</title>')
    })

    it('uses kite3d.name by default and preserves the backend game name on updates', async () => {
        const root = sampleProject()
        const packageJson = JSON.parse(await root.text('package.json'))
        packageJson.name = 'package-slug-name'
        packageJson.kite3d.name = 'Configured Game Name'
        root.set('package.json', JSON.stringify(packageJson))
        const {api, backend} = await testApi()

        await publishProject({dirHandle: root.asHandle(), api, slug: 'name-game'})
        expect(backend.games.get('name-game')?.name).toBe('Configured Game Name')

        backend.games.get('name-game')!.name = 'Live Renamed Game'
        await publishProject({dirHandle: root.asHandle(), api, slug: 'name-game'})
        expect(await root.text('.kite3d/publish/index.html')).toContain('<title>Live Renamed Game</title>')

        await publishProject({dirHandle: root.asHandle(), api, slug: 'name-game', name: 'Explicit Update Name'})
        expect(await root.text('.kite3d/publish/index.html')).toContain('<title>Explicit Update Name</title>')
    })

    it('uses the exact project pin for kite3d.version and the runtime lookup', async () => {
        const root = sampleProject()
        const pinned = '9.8.7'
        root.set('package.json', JSON.stringify({
            name: 'Pinned Game',
            devDependencies: {'kite3d': pinned},
            kite3d: {version: '1.2.3'},
        }))
        const {api, backend} = await testApi({runtimeVersions: [pinned]})

        await publishProject({dirHandle: root.asHandle(), api, slug: 'pinned-game'})

        expect(backend.requests.some(({path}) => path.endsWith(`/runtimes/${pinned}`))).toBe(true)
        expect(JSON.parse(await root.text('package.json')).kite3d.version).toBe(pinned)
    })

    it.each(['file:../../kite3d-packs/kite3d.tgz', '^9.8.0'])(
        'uses the installed engine version when the Kite3D spec is %s',
        async (spec) => {
            const root = sampleProject()
            root.set('package.json', JSON.stringify({
                name: 'Installed Version Game',
                devDependencies: {'kite3d': spec},
                kite3d: {version: '1.2.3'},
            }))
            installEngine(root, '9.8.7', 'installed runtime')
            const {api, backend} = await testApi({runtimeVersions: ['9.8.7']})

            await publishProject({dirHandle: root.asHandle(), api, slug: 'installed-version-game'})

            expect(backend.requests.some(({path}) => path.endsWith('/runtimes/9.8.7'))).toBe(true)
            expect(JSON.parse(await root.text('package.json')).kite3d.version).toBe('9.8.7')
        },
    )

    it('publishes installed runtime bytes and only uses the registry for a mismatch warning', async () => {
        const root = sampleProject()
        installEngine(root, KITE3D_VERSION, 'new local runtime with Generator')
        const localRuntime = await root.file('node_modules/@kite3d/engine/dist/runtime.js')
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
        expect(await root.text('.kite3d/publish/index.html')).toContain(`<meta name="kite3d-runtime" content="${KITE3D_VERSION} ${localHash}">`)
        expect(warning).toHaveBeenCalledWith(expect.stringContaining('publishing the installed runtime'))
        warning.mockRestore()
    })

    it('accepts an installed runtime hash found anywhere in the version registry list', async () => {
        const root = sampleProject()
        const localHash = await sha256(await root.file('node_modules/@kite3d/engine/dist/runtime.js'))
        const {api} = await testApi({runtimeHashes: ['f'.repeat(64), localHash]})
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

        await publishProject({dirHandle: root.asHandle(), api, slug: 'registered-runtime'})

        expect(warning).not.toHaveBeenCalled()
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

    it('applies kite3d.publish.exclude to the release manifest', async () => {
        const root = sampleProject()
        const packageJson = JSON.parse(await root.text('package.json'))
        packageJson.kite3d.publish = {exclude: ['tools/**', 'AGENTS.md']}
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

describe('publish reliability', () => {
    it('reports a slug conflict without saving credentials', async () => {
        const root = sampleProject()
        const {api, backend} = await testApi()
        await fetch(`${backend.url}/api/v1/new-game/conflict-game`, {method: 'POST'})

        await expect(publishProject({dirHandle: root.asHandle(), api, slug: 'conflict-game'}))
            .rejects.toMatchObject({status: 409, code: 'slug_taken'})
        expect((await readDeploys(root.asHandle())).games).not.toHaveProperty('conflict-game')
    })

    it.each([
        ['rate limit', {uploadStatuses: [429]}],
        ['server failure', {uploadStatuses: [503]}],
    ] as const)('reconciles and retries a blob upload after a %s', async (_name, fault) => {
        const root = sampleProject()
        const {api, backend} = await testApi(fault)

        await expect(publishProject({dirHandle: root.asHandle(), api, slug: 'retry-upload'}))
            .resolves.toMatchObject({release_hash: expect.any(String)})
        expect(backend.requests.some(({method, path}) => method === 'HEAD' && path.includes('/blobs/'))).toBe(true)
    })

    it('retries a transient release failure', async () => {
        const root = sampleProject()
        const {api, backend} = await testApi({releaseStatuses: [503]})

        await publishProject({dirHandle: root.asHandle(), api, slug: 'retry-release'})

        expect(backend.requests.filter(({method, path}) => method === 'PUT' && path.endsWith('/releases'))).toHaveLength(2)
        expect(backend.releaseCount('retry-release')).toBe(1)
    })

    it('recovers from an upload timeout and connection loss before the write', async () => {
        for (const fault of [{uploadTimeouts: 1}, {uploadConnectionLoss: 'before' as const}]) {
            const root = sampleProject()
            const backend = await startMockBackend(fault)
            backends.push(backend)
            const api = new Kite3dApi({baseUrl: backend.url, requestTimeoutMs: 250})

            await expect(publishProject({dirHandle: root.asHandle(), api, slug: `loss-${backends.length}`}))
                .resolves.toMatchObject({release_hash: expect.any(String)})
            expect(backend.requests.some(({method}) => method === 'HEAD')).toBe(true)
        }
    })

    it('does not repeat an uncertain PUT when reconciliation finds the blob', async () => {
        const root = sampleProject()
        const {api, backend} = await testApi({uploadConnectionLoss: 'after'})

        await publishProject({dirHandle: root.asHandle(), api, slug: 'uncertain-write'})

        const heads = backend.requests.filter(({method, path}) => method === 'HEAD' && path.includes('/blobs/'))
        expect(heads).toHaveLength(1)
        const reconciledHash = heads[0].path.split('/').at(-1)
        expect(backend.requests.filter(({method, path}) => method === 'PUT' && path.endsWith(`/${reconciledHash}`)))
            .toHaveLength(1)
    })

    it('fails on the first public asset whose SHA-256 never matches', async () => {
        const root = sampleProject()
        const {api, backend} = await testApi({corruptPreviewPath: '_blitz/runtime.js'})

        await expect(publishProject({dirHandle: root.asHandle(), api, slug: 'hash-mismatch'}))
            .rejects.toThrow('Published file verification failed for _blitz/runtime.js')
        expect(backend.requests.filter(({path}) => path.startsWith('/preview/hash-mismatch/_blitz/runtime.js')))
            .toHaveLength(5)
    })

    it('skips public asset verification when explicitly disabled', async () => {
        const root = sampleProject()
        const {api, backend} = await testApi({corruptPreviewPath: '_blitz/runtime.js'})

        await expect(publishProject({dirHandle: root.asHandle(), api, slug: 'no-verification', verify: false}))
            .resolves.toMatchObject({release_hash: expect.any(String)})
        expect(backend.requests.some(({path}) => path.startsWith('/preview/no-verification/'))).toBe(false)
    })

    it.each([
        ['playing', {playState: 'playing', dirty: false}, 'Stop Play'],
        ['dirty', {playState: 'stopped', dirty: true}, 'unsaved editor draft'],
    ] as const)('refuses a fresh %s editor state', async (_name, editorState, message) => {
        const root = await diskProject()
        const backend = await startMockBackend()
        backends.push(backend)
        await mkdir(resolve(root, '.kite3d'), {recursive: true})
        await writeFile(resolve(root, '.kite3d/state.json'), JSON.stringify({
            ...editorState,
            updatedAt: new Date().toISOString(),
        }))

        await expect(publishFromDisk(root, {
            slug: `state-${_name}`,
            backendUrl: backend.url,
            noCheck: true,
            noVerify: true,
        })).rejects.toThrow(message)
        expect(backend.games.size).toBe(0)
        expect((await readDeploys(new NodeProjectDirectory(root).asHandle())).last_publish)
            .toMatchObject({status: 'failed'})
    })

    it('allows a stale dirty flag when the in-memory and saved scene hashes match', async () => {
        const root = await diskProject()
        const backend = await startMockBackend()
        backends.push(backend)
        await mkdir(resolve(root, '.kite3d'), {recursive: true})
        await writeFile(resolve(root, '.kite3d/state.json'), JSON.stringify({
            playState: 'stopped',
            dirty: true,
            sourceDraftDirty: false,
            sceneHash: 'a'.repeat(64),
            savedSceneHash: 'a'.repeat(64),
            updatedAt: new Date().toISOString(),
        }))

        await expect(publishFromDisk(root, {
            slug: 'matching-scene-hash',
            backendUrl: backend.url,
            noCheck: true,
            noVerify: true,
        })).resolves.toMatchObject({release_hash: expect.any(String)})
    })

    it('rejects project symlinks before creating a remote game', async () => {
        const root = await diskProject()
        const backend = await startMockBackend()
        backends.push(backend)
        await symlink(resolve(root, 'main.js'), resolve(root, 'linked-main.js'))

        await expect(publishFromDisk(root, {
            slug: 'symlink-game', backendUrl: backend.url, noCheck: true, noVerify: true,
        })).rejects.toThrow('project contains a symlink: linked-main.js')
        expect(backend.games.size).toBe(0)
    })

    it('refuses a fresh publish lock and replaces one older than ten minutes', async () => {
        const root = await diskProject()
        const backend = await startMockBackend()
        backends.push(backend)
        const lockPath = resolve(root, '.kite3d/publish.lock')
        await mkdir(resolve(root, '.kite3d'), {recursive: true})
        await writeFile(lockPath, JSON.stringify({pid: 123, created_at: new Date().toISOString()}))

        await expect(publishFromDisk(root, {
            slug: 'locked-game', backendUrl: backend.url, noCheck: true, noVerify: true,
        })).rejects.toThrow('Another publish is already running by pid 123')

        await writeFile(lockPath, JSON.stringify({
            pid: 123,
            created_at: new Date(Date.now() - 11 * 60_000).toISOString(),
        }))
        await expect(publishFromDisk(root, {
            slug: 'locked-game', backendUrl: backend.url, noCheck: true, noVerify: true,
        })).resolves.toMatchObject({release_hash: expect.any(String)})
        await expect(readFile(lockPath, 'utf8')).rejects.toMatchObject({code: 'ENOENT'})
    })

    it('replaces expired anonymous credentials when recreating a game', async () => {
        const root = await diskProject()
        const backend = await startMockBackend()
        backends.push(backend)
        const directory = new NodeProjectDirectory(root).asHandle()
        await writeDeploys(directory, {games: {'expired-game': {
            game_id: 'expired-id',
            deploy_token: 'tp_expired',
            claim_secret: 'expired-secret',
            preview_url: 'https://expired.invalid/',
            expires_at: '2020-01-01 00:00:00',
        }}})

        await publishFromDisk(root, {
            slug: 'expired-game', backendUrl: backend.url, noCheck: true, noVerify: true,
        })

        const current = await readDeploys(directory)
        expect(current.games['expired-game'].game_id).not.toBe('expired-id')
        expect(backend.games.has('expired-game')).toBe(true)
    })

    it('persists a redacted failed result after release verification fails', async () => {
        const root = await diskProject()
        const backend = await startMockBackend({
            corruptPreviewPath: '_blitz/runtime.js',
            failureMessage: 'unused',
        })
        backends.push(backend)

        await expect(publishFromDisk(root, {
            slug: 'status-game', backendUrl: backend.url, noCheck: true,
        })).rejects.toThrow('Published file verification failed')

        const deploys = await readDeploys(new NodeProjectDirectory(root).asHandle())
        expect(deploys.games['status-game'].last_release_hash).toMatch(/^[a-f\d]{64}$/)
        expect(deploys.last_publish).toMatchObject({slug: 'status-game', status: 'failed'})
        expect(Date.parse(deploys.last_publish!.updated_at)).not.toBeNaN()
    })

    it('writes publishing status to disk before interruptible network work starts', async () => {
        const root = await diskProject()
        let requestStarted!: () => void
        const started = new Promise<void>((resolveStarted) => { requestStarted = resolveStarted })
        const server = createServer(() => requestStarted())
        await new Promise<void>((resolveListen, reject) => {
            server.once('error', reject)
            server.listen(0, '127.0.0.1', () => {
                server.off('error', reject)
                resolveListen()
            })
        })
        const address = server.address()
        if (!address || typeof address === 'string') throw new Error('Interrupt test server did not bind')
        const outcome = publishFromDisk(root, {
            slug: 'interrupted-game',
            backendUrl: `http://127.0.0.1:${address.port}`,
            noCheck: true,
            noVerify: true,
        }).catch((error) => error as Error)

        let publishError: Error | undefined
        try {
            await started
            const deploys = await readDeploys(new NodeProjectDirectory(root).asHandle())
            expect(deploys.last_publish).toMatchObject({slug: 'interrupted-game', status: 'publishing'})
            expect(Date.parse(deploys.last_publish!.updated_at)).not.toBeNaN()
        } finally {
            const serverClosed = closeTestServer(server)
            publishError = await outcome
            await serverClosed
        }
        expect(publishError).toBeInstanceOf(Error)
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
        devDependencies: {'kite3d': KITE3D_VERSION},
        kite3d: {version: KITE3D_VERSION},
        dependencies: {threepipe: '0.5.1', 'extra-package': '1.0.0'},
    }))
    root.set('assets.json', JSON.stringify({files: {}, version: 1}))
    root.set('main.js', 'export async function main() {}')
    root.set('ignored-by-gitignore.txt', 'still published')
    root.set('.gitignore', 'ignored-by-gitignore.txt')
    root.set('assets/main.scene.gltf', '{"asset":{"version":"2.0"}}')
    root.set('Player.script.js', 'export class Player {}')
    installEngine(root, KITE3D_VERSION, 'mock Kite3D runtime')
    return root
}

function installEngine(root: FakeDirectory, version: string, runtime: string): void {
    root.set('node_modules/@kite3d/engine/package.json', JSON.stringify({version}))
    root.set('node_modules/@kite3d/engine/dist/runtime.js', runtime)
}

async function testApi(options: Parameters<typeof startMockBackend>[0] = {}) {
    const backend = await startMockBackend(options)
    backends.push(backend)
    return {api: new Kite3dApi({baseUrl: backend.url}), backend}
}

function releaseRequest(backend: MockBackend) {
    const request = backend.requests.findLast(({method, path}) => method === 'PUT' && path.endsWith('/releases'))
    if (!request) throw new Error('No release request was recorded')
    return request
}

function deployEntry(created: Awaited<ReturnType<Kite3dApi['createAnonymousGame']>>): DeployEntry {
    return {
        game_id: created.game_id,
        deploy_token: created.deploy_token,
        claim_secret: created.claim_secret,
        preview_url: created.preview_url,
        expires_at: created.expires_at,
    }
}

async function putRemoteRelease(api: Kite3dApi, files: Record<string, Blob>) {
    const descriptors = await Promise.all(Object.entries(files).map(async ([path, file]) => {
        const hash = await sha256(file)
        await api.uploadBlob(hash, file)
        return [path, {sha256: hash, size: file.size}] as const
    }))
    return api.putRelease({files: Object.fromEntries(descriptors)})
}

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

function readImportMap(html: string): {imports: Record<string, string>} {
    const text = html.match(/<script type="importmap">(.*?)<\/script>/s)?.[1]
    return JSON.parse(text || '{}') as {imports: Record<string, string>}
}
