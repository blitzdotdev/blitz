import {createHash} from 'node:crypto'
import {mkdtemp, mkdir, readFile, rm, stat, writeFile} from 'node:fs/promises'
import {createServer as createHttpServer, request} from 'node:http'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {createDevServer, type DevServer, type DevServerOptions} from '../src/server.ts'
import {publishFromDisk} from '../src/commands.ts'
import {readDeploys, writeDeploys} from '../src/deploys.ts'
import {NodeProjectDirectory} from '../src/node-filesystem.ts'
import {readProjectFile, walkProject, writeProjectFile} from '../src/filesystem.ts'
import {startMockBackend} from './mockBackend.ts'
import {BLITZ_SERVER_CLIENT_ID} from '@blitzdev/engine/paths'
import {projectDependencies} from '@blitzdev/engine/importMap'
import {BLITZ_VERSION, EDITOR_VERSION, ENGINE_VERSION} from '../src/versions.ts'
import {generateIndexHtml} from '../src/indexHtml.ts'

const cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
    while (cleanup.length) await cleanup.pop()!()
})

describe('NodeProjectDirectory', () => {
    it('walks, reads, and writes a real project directory', async () => {
        const root = await temporaryProject()
        const directory = new NodeProjectDirectory(root).asHandle()
        await writeProjectFile(directory, 'nested/value.txt', 'value')
        expect(await (await readProjectFile(directory, 'nested/value.txt'))?.text()).toBe('value')
        expect((await walkProject(directory)).map(({path}) => path)).toContain('nested/value.txt')
    })
})

describe('Blitz dev server', () => {
    it('proxies slug checks, registration, and login through the configured backend', async () => {
        const backend = await startMockBackend()
        cleanup.push(() => backend.close())
        const {server, headers} = await startServer({backendUrl: backend.url})

        const slug = await fetch(`${base(server)}/api/slug/proxy-game`, {headers})
        expect(slug.status).toBe(200)
        expect(await slug.json()).toEqual({slug: 'proxy-game', available: true})

        const register = await fetch(`${base(server)}/api/auth/register`, {
            method: 'POST',
            headers: {...headers, 'Content-Type': 'application/json'},
            body: JSON.stringify({email: 'new@example.com', username: 'new_player', password: 'password123'}),
        })
        expect(register.status).toBe(201)
        const registerBody = await register.json()
        expect(registerBody).toMatchObject({token: 'jwt-register', user: {username: 'new_player'}})
        expect(JSON.stringify(registerBody)).not.toContain('refresh-register')

        const login = await fetch(`${base(server)}/api/auth/login`, {
            method: 'POST',
            headers: {...headers, 'Content-Type': 'application/json'},
            body: JSON.stringify({identity: 'new@example.com', password: 'password123'}),
        })
        expect(login.status).toBe(200)
        expect(await login.json()).toMatchObject({token: 'jwt-login'})
        expect(backend.requests.map(({path}) => path)).toEqual(expect.arrayContaining([
            '/api/v1/slugs/proxy-game',
            '/api/v1/auth/register',
            '/api/v1/auth/login',
        ]))
    })

    it('claims with the in-memory JWT and local claim secret, then omits secrets from deploys', async () => {
        const backend = await startMockBackend()
        cleanup.push(() => backend.close())
        const created = await fetch(`${backend.url}/api/v1/new-game/claim-game?name=Claim`, {method: 'POST'})
        const game = await created.json() as {
            game_id: string, deploy_token: string, claim_secret: string, preview_url: string, expires_at: string
        }
        const {server, root, headers} = await startServer({backendUrl: backend.url})
        const directory = new NodeProjectDirectory(root).asHandle()
        await writeDeploys(directory, {games: {'claim-game': game}})

        await fetch(`${base(server)}/api/auth/login`, {
            method: 'POST',
            headers: {...headers, 'Content-Type': 'application/json'},
            body: JSON.stringify({identity: 'player@example.com', password: 'password123'}),
        })
        const claim = await fetch(`${base(server)}/api/claim`, {
            method: 'POST',
            headers: {...headers, 'Content-Type': 'application/json'},
            body: JSON.stringify({slug: 'claim-game'}),
        })
        expect(claim.status).toBe(200)
        expect(await claim.json()).toMatchObject({slug: 'claim-game', claimed: true})

        const publicDeploys = await (await fetch(`${base(server)}/api/deploys`, {headers})).json() as unknown
        expect(publicDeploys).toMatchObject({games: [{slug: 'claim-game', game_id: game.game_id, claimed: true}]})
        expect(JSON.stringify(publicDeploys)).not.toContain('deploy_token')
        expect(JSON.stringify(publicDeploys)).not.toContain('claim_secret')
        expect((await readDeploys(directory)).games['claim-game'].claimed).toBe(true)
        expect(backend.requests.find(({path}) => path.endsWith('/claim'))?.authorization).toBe('Bearer jwt-login')
    })

    it('publishes with slug, name, and message through the local route and mocked backend', async () => {
        const backend = await startMockBackend()
        cleanup.push(() => backend.close())
        let projectRoot = ''
        const started = await startServer({
            backendUrl: backend.url,
            publish: (options, emit) => publishFromDisk(projectRoot, {...options, backendUrl: backend.url}, emit),
        })
        projectRoot = started.root
        const response = await fetch(`${base(started.server)}/api/publish`, {
            method: 'POST',
            headers: {...started.headers, 'Content-Type': 'application/json'},
            body: JSON.stringify({slug: 'route-game', name: 'Route Game', message: 'from proxy'}),
        })
        expect(response.status).toBe(200)
        expect(await response.json()).toMatchObject({preview_url: `${backend.url}/preview/route-game/`})
        expect(backend.games.get('route-game')?.name).toBe('Route Game')
        expect(backend.releaseCount('route-game')).toBe(1)
        expect(backend.requests.find(({path}) => path.endsWith('/releases'))?.body).toMatchObject({message: 'from proxy'})
    })

    it('serves a manifest, MIME, ETags, conditional writes, and state', async () => {
        const {server, root, headers} = await startServer()
        await writeFile(resolve(root, 'hello.js'), 'export const hello = true\n')
        await writeFile(resolve(root, '.env'), 'secret')
        await mkdir(resolve(root, 'node_modules/pkg'), {recursive: true})
        await writeFile(resolve(root, 'node_modules/pkg/index.js'), 'ignored')

        const manifestResponse = await fetch(`${base(server)}/api/files`, {headers})
        expect(manifestResponse.status).toBe(200)
        const manifest = await manifestResponse.json() as Array<{path: string, sha256: string}>
        expect(manifest.map(({path}) => path)).toContain('hello.js')
        expect(manifest.map(({path}) => path)).not.toContain('.env')
        expect(manifest.some(({path}) => path.startsWith('node_modules/'))).toBe(false)

        const fileResponse = await fetch(`${base(server)}/files/hello.js`, {headers})
        expect(fileResponse.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
        const etag = fileResponse.headers.get('etag')!
        expect(etag).toBe(`"${createHash('sha256').update('export const hello = true\n').digest('hex')}"`)
        expect((await fetch(`${base(server)}/files/hello.js`, {headers: {...headers, 'If-None-Match': etag}})).status).toBe(304)

        const mismatch = await fetch(`${base(server)}/files/hello.js`, {
            method: 'PUT', headers: {...headers, 'If-Match': '"wrong"'}, body: 'changed',
        })
        expect(mismatch.status).toBe(412)
        expect(await readFile(resolve(root, 'hello.js'), 'utf8')).toContain('hello')

        const written = await fetch(`${base(server)}/files/hello.js`, {
            method: 'PUT', headers: {...headers, 'If-Match': etag, 'X-Blitz-Client': 'test-client'}, body: 'changed',
        })
        expect(written.status).toBe(200)
        expect(await readFile(resolve(root, 'hello.js'), 'utf8')).toBe('changed')
        const state = await (await fetch(`${base(server)}/api/state`, {headers})).json() as {name: string, server_version: string}
        expect(state).toMatchObject({
            name: 'server-test',
            server_version: BLITZ_VERSION,
            versions: {blitz: BLITZ_VERSION, editor: EDITOR_VERSION, engine: ENGINE_VERSION},
            asset_library_proxy_url: expect.stringContaining('blitz-asset-library-proxy'),
        })
    })

    it('injects the same dependency map used by published games', async () => {
        const {server, root, headers} = await startServer()
        const packageJson = {
            name: 'import-map-test',
            dependencies: {
                '@blitzdev/engine': 'file:../../packs/engine.tgz',
                gsap: '^3.12.5',
                local: 'file:../local',
            },
            blitz: {version: BLITZ_VERSION},
        }
        await writeFile(resolve(root, 'package.json'), JSON.stringify(packageJson))

        const development = await (await fetch(`${base(server)}/api/import-map`, {headers})).json() as {
            imports: Record<string, string>
        }
        const publishedHtml = generateIndexHtml({
            name: packageJson.name,
            version: BLITZ_VERSION,
            dependencies: projectDependencies(packageJson),
        })
        const published = JSON.parse(publishedHtml.match(/<script type="importmap">(.*?)<\/script>/s)?.[1] || '{}') as {
            imports: Record<string, string>
        }
        const normalizeRuntime = (imports: Record<string, string>) => Object.fromEntries(
            Object.entries(imports).map(([key, value]) => [key, value.replace('/editor-runtime.js', './_blitz/runtime.js')]),
        )

        expect(normalizeRuntime(development.imports)).toEqual(published.imports)
        expect(JSON.stringify(development)).not.toContain('../../packs')
    })

    it('rejects bad tokens, non-local Host headers, traversal, and symlinks', async () => {
        const {server, root, headers} = await startServer()
        expect((await fetch(`${base(server)}/api/files`)).status).toBe(401)
        expect(await statusWithHost(server.port, '/api/files', 'example.com', server.token)).toBe(403)
        expect((await fetch(`${base(server)}/files/..%2Foutside`, {headers})).status).toBe(403)
        await writeFile(resolve(root, 'outside'), 'target')
        const {symlink} = await import('node:fs/promises')
        await symlink(resolve(root, 'outside'), resolve(root, 'linked'))
        expect((await fetch(`${base(server)}/files/linked`, {headers})).status).toBe(403)
    })

    it('debounces SSE and records the writer client id', async () => {
        const {server, headers} = await startServer()
        const controller = new AbortController()
        const eventsResponse = await fetch(`${base(server)}/api/events`, {headers, signal: controller.signal})
        const eventPromise = readEvent(eventsResponse, controller, 'live.script.js')
        const put = () => fetch(`${base(server)}/files/live.script.js`, {
            method: 'PUT',
            headers: {...headers, 'If-Match': '*', 'X-Blitz-Client': 'editor-one'},
            body: `export const value = ${Date.now()}`,
        })
        await put()
        await put()
        const event = await eventPromise
        expect(event.data.path).toBe('live.script.js')
        expect(event.type).toBe('add')
        expect(event.data).toMatchObject({path: 'live.script.js', client: 'editor-one'})
        expect(event.data.sha256).toMatch(/^[a-f0-9]{64}$/)
    })

    it('labels files written by a server mutation', async () => {
        let root = ''
        const started = await startServer({
            pull: async () => {
                await writeFile(resolve(root, 'pulled.txt'), 'from server')
                return {release_hash: 'release', updated: ['pulled.txt']}
            },
        })
        root = started.root
        const {server, headers} = started
        const controller = new AbortController()
        const eventsResponse = await fetch(`${base(server)}/api/events`, {headers, signal: controller.signal})
        const eventPromise = readEvent(eventsResponse, controller, 'pulled.txt')

        const pulled = await fetch(`${base(server)}/api/pull`, {method: 'POST', headers})
        expect(pulled.status).toBe(200)
        const event = await eventPromise
        expect(event).toMatchObject({
            type: 'add',
            data: {path: 'pulled.txt', client: BLITZ_SERVER_CLIENT_ID},
        })
    })

    it('serves the editor, its shared runtime bridge, and favicon from one origin', async () => {
        const {server} = await startServer()
        expect((await fetch(server.url)).status).toBe(200)
        expect(await (await fetch(server.url)).text()).toContain('test editor')
        expect(await (await fetch(`${base(server)}/editor-runtime.js`)).text()).toContain('editor runtime')
        expect((await fetch(`${base(server)}/_blitz/runtime.js`)).status).toBe(404)
        expect((await fetch(`${base(server)}/favicon.ico`)).status).toBe(200)
        expect((await stat(resolve(server.projectRoot, '.blitz/dev.json'))).isFile()).toBe(true)
    })

    it('tries the next port by default and treats an explicit port as strict', async () => {
        const blocker = createHttpServer()
        await new Promise<void>((resolveListen, reject) => {
            blocker.once('error', reject)
            blocker.listen(0, '127.0.0.1', resolveListen)
        })
        cleanup.push(() => new Promise<void>((resolveClose, reject) =>
            blocker.close((error) => error ? reject(error) : resolveClose())))
        const address = blocker.address()
        if (!address || typeof address === 'string') throw new Error('Test blocker did not bind')
        const root = await temporaryProject()
        const editor = resolve(root, 'editor')
        await mkdir(editor)
        await writeFile(resolve(editor, 'index.html'), '<!doctype html><head></head><title>test editor</title>')

        const fallback = await createDevServer({
            projectRoot: root,
            editorDirectory: editor,
            port: address.port,
        })
        cleanup.push(() => fallback.close())
        expect(fallback.port).toBe(address.port + 1)

        await expect(createDevServer({
            projectRoot: root,
            editorDirectory: editor,
            port: address.port,
            strictPort: true,
        })).rejects.toThrow(`Port ${address.port} is already in use`)
    })

    it('fails bake clearly when no editor is connected', async () => {
        const {server, headers} = await startServer()
        const response = await fetch(`${base(server)}/api/bake`, {
            method: 'POST',
            headers: {...headers, 'Content-Type': 'application/json'},
            body: JSON.stringify({nodeName: 'Forest'}),
        })
        expect(response.status).toBe(409)
        expect(await response.json()).toMatchObject({
            error: {code: 'editor_not_connected', message: expect.stringContaining('No editor is connected')},
        })
    })

    it('journals API and watcher scene writes with semantic summaries', async () => {
        const {server, root, headers} = await startServer()
        const scenePath = resolve(root, 'assets/main.scene.gltf')
        const current = await fetch(`${base(server)}/files/assets/main.scene.gltf`, {headers})
        const response = await fetch(`${base(server)}/files/assets/main.scene.gltf`, {
            method: 'PUT',
            headers: {
                ...headers,
                'If-Match': current.headers.get('etag')!,
                'X-Blitz-Client': 'editor-journal-test',
            },
            body: JSON.stringify({asset: {version: '2.0'}, nodes: [{name: 'Human node'}]}),
        })
        expect(response.status).toBe(200)
        const journalPath = resolve(root, '.blitz/journal.jsonl')
        await expect.poll(async () => readJournalLines(journalPath)).toMatchObject([{
            client: 'editor-journal-test',
            summary: {nodesAdded: [{name: 'Human node'}]},
        }])

        await writeFile(scenePath, JSON.stringify({asset: {version: '2.0'}, nodes: [{name: 'Agent node'}]}))
        await expect.poll(async () => (await readJournalLines(journalPath)).length).toBe(2)
        expect(await readJournalLines(journalPath)).toMatchObject([
            {client: 'editor-journal-test'},
            {client: 'external'},
        ])
    })
})

async function temporaryProject(): Promise<string> {
    const root = await mkdtemp(resolve(tmpdir(), 'blitz-server-'))
    cleanup.push(() => rm(root, {recursive: true, force: true}))
    await writeFile(resolve(root, 'package.json'), `${JSON.stringify({
        name: 'server-test',
        devDependencies: {'@blitzdev/blitz': BLITZ_VERSION},
        blitz: {version: BLITZ_VERSION},
    })}\n`)
    await writeFile(resolve(root, 'assets.json'), '{"files":{},"version":1}\n')
    await writeFile(resolve(root, 'main.js'), 'export async function main() {}\n')
    await mkdir(resolve(root, 'assets'), {recursive: true})
    await writeFile(resolve(root, 'assets/main.scene.gltf'), '{"asset":{"version":"2.0"},"nodes":[]}\n')
    await mkdir(resolve(root, 'node_modules/@blitzdev/engine/dist'), {recursive: true})
    await writeFile(resolve(root, 'node_modules/@blitzdev/engine/package.json'), JSON.stringify({version: BLITZ_VERSION}))
    await writeFile(resolve(root, 'node_modules/@blitzdev/engine/dist/runtime.js'), 'installed runtime')
    return root
}

async function readJournalLines(path: string): Promise<Array<Record<string, unknown>>> {
    try {
        return (await readFile(path, 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>)
    } catch {
        return []
    }
}

async function startServer(options: Pick<DevServerOptions, 'publish' | 'pull' | 'backendUrl'> = {}) {
    const root = await temporaryProject()
    const editor = resolve(root, 'editor')
    await mkdir(editor)
    await writeFile(resolve(editor, 'index.html'), '<!doctype html><head><script type="importmap">{"imports":{}}</script></head><title>test editor</title>')
    await writeFile(resolve(editor, 'editor-runtime.js'), 'export const editor = "editor runtime"')
    await writeFile(resolve(editor, 'favicon.ico'), 'icon')
    const server = await createDevServer({
        projectRoot: root,
        port: 0,
        token: 'test-token',
        editorDirectory: editor,
        ...options,
    })
    cleanup.push(() => server.close())
    return {server, root, headers: {'X-Blitz-Token': server.token}}
}

function base(server: DevServer): string {
    return `http://127.0.0.1:${server.port}`
}

async function statusWithHost(port: number, path: string, host: string, token: string): Promise<number> {
    return new Promise((resolveStatus, reject) => {
        const req = request({hostname: '127.0.0.1', port, path, headers: {Host: host, 'X-Blitz-Token': token}}, (response) => {
            response.resume()
            resolveStatus(response.statusCode || 0)
        })
        req.on('error', reject)
        req.end()
    })
}

async function readEvent(
    response: Response,
    controller: AbortController,
    expectedPath: string,
): Promise<{type: string, data: Record<string, unknown>}> {
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let buffered = ''
    const timeout = setTimeout(() => controller.abort(), 5_000)
    try {
        while (!controller.signal.aborted) {
            const {done, value} = await reader.read()
            if (done) throw new Error('SSE ended before an event')
            buffered += decoder.decode(value, {stream: true})
            let boundary = buffered.indexOf('\n\n')
            while (boundary >= 0) {
                const frame = buffered.slice(0, boundary)
                buffered = buffered.slice(boundary + 2)
                const match = frame.match(/event: ([^\n]+)\ndata: ([^\n]+)/)
                if (match) {
                    const data = JSON.parse(match[2]) as Record<string, unknown>
                    if (data.path === expectedPath) return {type: match[1], data}
                }
                boundary = buffered.indexOf('\n\n')
            }
        }
        throw new Error('SSE aborted before an event')
    } finally {
        clearTimeout(timeout)
        controller.abort()
    }
}
