import {createHash} from 'node:crypto'
import {describe, expect, it} from 'vitest'
import {
    buildManifest,
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
    CreatedAnonymousGame,
    DeploysFile,
    GameRecord,
    ReleaseManifest,
    ReleaseRecord,
    RuntimeRecord,
} from '../src/index.ts'
import type {PublishApi} from '../src/publish.ts'
import {FakeDirectory} from './fakeDirectory.ts'

describe('walkProject', () => {
    it('uses the fixed exclusions and does not interpret .gitignore', async () => {
        const root = new FakeDirectory('project')
        root.set('main.js', 'main')
        root.set('.env', 'secret')
        root.set('.gitignore', 'keep-me.txt')
        root.set('keep-me.txt', 'kept')
        root.set('.blitz/deploys.json', '{}')
        root.set('.git/config', 'config')
        root.set('node_modules/pkg/index.js', 'dependency')
        root.set('dist/index.js', 'build')
        root.set('assets/.hidden.glb', 'hidden')
        root.set('assets/model.glb', 'model')

        expect((await walkProject(root.asHandle())).map(({path}) => path)).toEqual([
            'assets/model.glb',
            'keep-me.txt',
            'main.js',
        ])
    })
})

describe('release manifests', () => {
    it('matches the fixed cloud contract hash exactly', async () => {
        const entries = [
            {path: 'z.bin', file: new File([Uint8Array.from([1, 2, 3])], 'z.bin')},
            {path: 'index.html', file: new File(['hello'], 'index.html')},
        ]
        const manifest = await buildManifest(entries, {sha256: 'c'.repeat(64), size: 42})
        const contractHash = createHash('sha256').update(canonicalizeManifest(manifest)).digest('hex')
        expect(await manifestHash(manifest)).toBe(contractHash)
        expect(contractHash).toBe('c62d887c03354202dddb0a3387119f5074702b3037911686645fdde8b674c852')
        expect(Object.keys(manifest.files)).toEqual(['_blitz/runtime.js', 'index.html', 'z.bin'])
    })
})

describe('generateIndexHtml', () => {
    it('uses relative runtime paths and maps only declared extra dependencies', () => {
        const html = generateIndexHtml({
            name: 'A <Game>',
            version: '0.12.0',
            dependencies: [
                {key: 'threepipe', version: '0.5.1'},
                {key: 'extra-package', version: '1.2.3'},
            ],
        })
        const importMapText = html.match(/<script type="importmap">(.*?)<\/script>/s)?.[1]
        const importMap = JSON.parse(importMapText || '{}') as {imports: Record<string, string>}
        expect(importMap.imports.threepipe).toBe('./_blitz/runtime.js')
        expect(importMap.imports.three).toBe('./_blitz/runtime.js')
        expect(importMap.imports['extra-package']).toContain('https://esm.sh/extra-package@1.2.3?external=')
        expect(importMap.imports['extra-package']).toContain('threepipe,three,uiconfig.js,ts-browser-helpers,extra-package')
        expect(html).toContain("import {createGame} from './_blitz/runtime.js'")
        expect(html).toContain("base:new URL('./',location.href).href")
        expect(html).not.toContain('"/_blitz/runtime.js"')
        expect(html).toContain('<title>A &lt;Game&gt;</title>')
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
        const api = new MockPublishApi()
        const progress: string[] = []
        const first = await publishProject({
            dirHandle: root.asHandle(),
            api,
            slug: 'sample-game',
            onProgress: ({phase}) => progress.push(phase),
        })

        expect(first).toEqual({
            preview_url: 'https://gateway.example/sample-game/',
            release_hash: 'd'.repeat(64),
        })
        expect(api.order[0]).toBe('create')
        expect(api.order.indexOf('runtime')).toBeLessThan(api.order.indexOf('missing'))
        expect(api.order.lastIndexOf('upload')).toBeLessThan(api.order.indexOf('release'))
        expect(api.maxUploads).toBe(4)
        expect(api.releaseOptions?.base_release).toBeUndefined()
        expect(progress.at(-1)).toBe('complete')
        expect(JSON.parse(await root.text('package.json')).blitz.version).toBe('0.12.0')
        expect(await root.text('index.html')).toContain("./_blitz/runtime.js")
        const stored = await readDeploys(root.asHandle())
        expect(stored.games['sample-game'].last_release_hash).toBe('d'.repeat(64))

        api.order.length = 0
        api.missing = []
        api.nextReleaseHash = 'e'.repeat(64)
        await publishProject({dirHandle: root.asHandle(), api, slug: 'sample-game', message: 'second'})
        expect(api.order).not.toContain('create')
        expect(api.releaseOptions).toEqual({message: 'second', base_release: 'd'.repeat(64)})
    })
})

describe('pullProject', () => {
    it('downloads changed source files, skips generated files, and records the active release', async () => {
        const root = new FakeDirectory('pull')
        root.set('package.json', '{"name":"old"}')
        root.set('main.js', 'same')
        const entry = {
            game_id: 'game-id',
            deploy_token: 'tp_token',
            claim_secret: 'claim-secret',
            preview_url: 'https://gateway.example/pull-game/',
            expires_at: '2026-09-10 01:00:00',
            last_release_hash: 'a'.repeat(64),
        }
        await writeDeploys(root.asHandle(), {games: {'pull-game': entry}})
        const nextPackage = new Blob(['{"name":"new"}'])
        const sameMain = new Blob(['same'])
        const runtime = new Blob(['runtime'])
        const releaseHash = 'b'.repeat(64)
        const blobs = new Map([
            [await sha256(nextPackage), nextPackage],
            [await sha256(sameMain), sameMain],
            [await sha256(runtime), runtime],
        ])
        const downloaded: string[] = []
        const api = {
            useGame: () => undefined,
            getGame: async () => ({id: 'game-id', slug: 'pull-game', name: 'Pull', active_release: releaseHash}),
            getRelease: async () => ({
                release_hash: releaseHash,
                message: 'remote',
                created_at: '2026-09-09 01:00:00',
                active: true,
                files: {
                    'index.html': {sha256: '1'.repeat(64), size: 1},
                    '_blitz/runtime.js': {sha256: await sha256(runtime), size: runtime.size},
                    'package.json': {sha256: await sha256(nextPackage), size: nextPackage.size},
                    'main.js': {sha256: await sha256(sameMain), size: sameMain.size},
                },
            }),
            downloadBlob: async (hash: string) => {
                downloaded.push(hash)
                const blob = blobs.get(hash)
                if (!blob) throw new Error('Missing test blob')
                return blob
            },
        } as PublishApi

        const result = await pullProject({dirHandle: root.asHandle(), api, entry})
        expect(result).toEqual({release_hash: releaseHash, updated: ['package.json']})
        expect(await root.text('package.json')).toBe('{"name":"new"}')
        expect(downloaded).toEqual([await sha256(nextPackage)])
        expect((await readDeploys(root.asHandle())).games['pull-game'].last_release_hash).toBe(releaseHash)
    })
})

function sampleProject(): FakeDirectory {
    const root = new FakeDirectory('sample')
    root.set('package.json', JSON.stringify({
        name: 'Sample Game',
        dependencies: {threepipe: '0.5.1', 'extra-package': '1.0.0'},
    }))
    root.set('assets.json', JSON.stringify({files: {}, version: 1}))
    root.set('main.js', 'export async function main() {}')
    root.set('ignored-by-gitignore.txt', 'still published')
    root.set('.gitignore', 'ignored-by-gitignore.txt')
    root.set('assets/main.scene.glb', Uint8Array.from([1, 2, 3]))
    root.set('Player.script.js', 'export class Player {}')
    return root
}

class MockPublishApi implements PublishApi {
    order: string[] = []
    missing: string[] | undefined
    activeUploads = 0
    maxUploads = 0
    nextReleaseHash = 'd'.repeat(64)
    releaseOptions?: {message?: string; base_release?: string}

    useGame(): void {
        this.order.push('use-game')
    }

    async createAnonymousGame(): Promise<CreatedAnonymousGame> {
        this.order.push('create')
        return {
            game_id: 'game-id',
            slug: 'sample-game',
            name: 'Sample Game',
            state: 'open',
            deploy_token: 'tp_token',
            claim_secret: 'claim-secret',
            preview_url: 'https://gateway.example/sample-game/',
            expires_at: '2026-09-10 01:00:00',
        }
    }

    async getRuntime(): Promise<RuntimeRecord> {
        this.order.push('runtime')
        return {version: '0.12.0', sha256: 'c'.repeat(64), size: 42}
    }

    async missingBlobs(hashes: string[]): Promise<string[]> {
        this.order.push('missing')
        return this.missing ?? hashes.filter((hash) => hash !== 'c'.repeat(64))
    }

    async uploadBlob(): Promise<void> {
        this.order.push('upload')
        this.activeUploads += 1
        this.maxUploads = Math.max(this.maxUploads, this.activeUploads)
        await new Promise((resolve) => setTimeout(resolve, 5))
        this.activeUploads -= 1
    }

    async putRelease(_manifest: ReleaseManifest, options?: {message?: string; base_release?: string}) {
        this.order.push('release')
        this.releaseOptions = options
        return {
            release_hash: this.nextReleaseHash,
            preview_url: 'https://gateway.example/sample-game/',
        }
    }

    async getGame(): Promise<GameRecord> {
        throw new Error('Not used')
    }

    async getRelease(): Promise<ReleaseRecord> {
        throw new Error('Not used')
    }

    async downloadBlob(): Promise<Blob> {
        throw new Error('Not used')
    }
}
