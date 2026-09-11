import {createHash} from 'node:crypto'
import {mkdtemp, mkdir, open, readFile, rm, stat, writeFile} from 'node:fs/promises'
import {createServer as createHttpServer, request} from 'node:http'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {createDevServer, type DevServer, type DevServerOptions} from '../src/server.ts'
import {devStatusFromDisk, publishFromDisk, runDev} from '../src/commands.ts'
import {readDeploys, writeDeploys} from '../src/deploys.ts'
import {NodeProjectDirectory} from '../src/node-filesystem.ts'
import {readProjectFile, walkProject, writeProjectFile} from '../src/filesystem.ts'
import {startMockBackend} from './mockBackend.ts'
import {KITE3D_SERVER_CLIENT_ID} from '@blitzdev/engine/paths'
import {projectDependencies} from '@blitzdev/engine/importMap'
import {KITE3D_VERSION, EDITOR_VERSION, ENGINE_VERSION} from '../src/versions.ts'
import {generateIndexHtml} from '../src/indexHtml.ts'
import {initializeGitRepository} from '../src/git.ts'
import {FIXTURE_PLUGIN_NAME, installPackedFixturePlugin} from './pluginFixture.ts'

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

describe('Kite3D dev server', () => {
    it('maps and serves installed plugin entries and sidecars from the plugin route', async () => {
        const {server, root, headers} = await startServer()
        await installPackedFixturePlugin(root)
        const packagePath = resolve(root, 'package.json')
        const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as {
            kite3d: {plugins?: string[]}
        }
        packageJson.kite3d.plugins = [FIXTURE_PLUGIN_NAME]
        await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)

        const importMap = await (await fetch(`${base(server)}/api/import-map`, {headers})).json() as {
            imports: Record<string, string>
        }
        expect(importMap.imports[FIXTURE_PLUGIN_NAME])
            .toBe(`/kite3d/plugins/${FIXTURE_PLUGIN_NAME}/Fixture.plugin.js`)
        expect(importMap.imports[`${FIXTURE_PLUGIN_NAME}/`])
            .toBe(`/kite3d/plugins/${FIXTURE_PLUGIN_NAME}/`)
        expect(await (await fetch(`${base(server)}/kite3d/plugins/${FIXTURE_PLUGIN_NAME}/sidecar.bin`, {headers})).text())
            .toBe('*\n')
        expect((await fetch(`${base(server)}/kite3d/plugins/${FIXTURE_PLUGIN_NAME}/sidecar.bin`)).status).toBe(401)
    })

    it('proxies slug checks and account authentication through the configured backend', async () => {
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

        const google = await fetch(`${base(server)}/api/auth/google`, {
            method: 'POST',
            headers: {...headers, Cookie: 'g_csrf_token=google-csrf', 'Content-Type': 'application/json'},
            body: JSON.stringify({credential: 'google-credential', g_csrf_token: 'google-csrf', select_by: 'btn'}),
        })
        expect(google.status).toBe(200)
        expect(await google.json()).toMatchObject({token: 'jwt-google', user: {username: 'google-player'}})
        expect(backend.requests.map(({path}) => path)).toEqual(expect.arrayContaining([
            '/api/v1/slugs/proxy-game',
            '/api/v1/auth/register',
            '/api/v1/auth/login',
            '/api/v1/table/users/auth/google-login',
        ]))
        const googleRequest = backend.requests.find(({path}) => path.endsWith('/google-login'))!
        expect(Object.fromEntries(new URLSearchParams((googleRequest.body as Buffer).toString('utf8')))).toEqual({
            credential: 'google-credential',
            g_csrf_token: 'google-csrf',
            select_by: 'btn',
        })
        expect(googleRequest.cookie).toBe('g_csrf_token=google-csrf')
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

    it('streams publish progress and returns the result through the local route', async () => {
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
        expect(response.status, await response.clone().text()).toBe(200)
        expect(response.headers.get('content-type')).toContain('text/event-stream')
        const events = parseSse(await response.text())
        expect(events).toContainEqual({
            event: 'publish:progress',
            data: expect.objectContaining({phase: 'walking', done: 0, total: 1}),
        })
        expect(events).toContainEqual({
            event: 'publish:progress',
            data: expect.objectContaining({phase: 'verifying', done: expect.any(Number), total: expect.any(Number)}),
        })
        expect(events.at(-1)).toEqual({
            event: 'publish:result',
            data: expect.objectContaining({preview_url: `${backend.url}/preview/route-game/`}),
        })
        expect(backend.games.get('route-game')?.name).toBe('Route Game')
        expect(backend.releaseCount('route-game')).toBe(1)
        expect(backend.requests.find(({path}) => path.endsWith('/releases'))?.body).toMatchObject({message: 'from proxy'})
    })

    it('refuses a duplicate publish request while one is streaming', async () => {
        let started!: () => void
        const isStarted = new Promise<void>((resolveStarted) => { started = resolveStarted })
        let finish!: () => void
        const canFinish = new Promise<void>((resolveFinish) => { finish = resolveFinish })
        const {server, headers} = await startServer({
            publish: async (_options, emit) => {
                emit({phase: 'walking', done: 0, total: 1})
                started()
                await canFinish
                return {preview_url: 'https://example.test/game/', release_hash: 'a'.repeat(64)}
            },
        })
        const first = fetch(`${base(server)}/api/publish`, {
            method: 'POST',
            headers: {...headers, 'Content-Type': 'application/json'},
            body: JSON.stringify({slug: 'first'}),
        })
        await isStarted

        try {
            const duplicate = await fetch(`${base(server)}/api/publish`, {
                method: 'POST',
                headers: {...headers, 'Content-Type': 'application/json'},
                body: JSON.stringify({slug: 'second'}),
            })

            expect(duplicate.status).toBe(409)
            expect(await duplicate.json()).toMatchObject({error: {code: 'publish_locked'}})
        } finally {
            finish()
        }
        expect(parseSse(await (await first).text()).at(-1)?.event).toBe('publish:result')
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
            method: 'PUT', headers: {...headers, 'If-Match': etag, 'X-Kite3D-Client': 'test-client'}, body: 'changed',
        })
        expect(written.status).toBe(200)
        expect(await readFile(resolve(root, 'hello.js'), 'utf8')).toBe('changed')
        const state = await (await fetch(`${base(server)}/api/state`, {headers})).json() as {name: string, server_version: string}
        expect(state).toMatchObject({
            name: 'server-test',
            server_version: KITE3D_VERSION,
            versions: {kite3d: KITE3D_VERSION, editor: EDITOR_VERSION, engine: ENGINE_VERSION},
        })
    })

    it('rewrites relative static, re-export, and dynamic imports in versioned modules', async () => {
        const {server, root, headers} = await startServer()
        await mkdir(resolve(root, 'modules/nested'), {recursive: true})
        const source = [
            "import './static.js'",
            "export {value} from '../shared.mjs?mode=dev#named'",
            "export const load = () => import('./dynamic.js')",
            "import 'bare-package'",
            "export const computed = (name) => import(name)",
            "import './missing.js'",
        ].join('\n')
        await writeFile(resolve(root, 'modules/nested/entry.mjs'), source)
        await writeFile(resolve(root, 'modules/nested/static.js'), 'export const value = 1\n')
        await writeFile(resolve(root, 'modules/nested/dynamic.js'), 'export const value = 2\n')
        await writeFile(resolve(root, 'modules/shared.mjs'), 'export const value = 3\n')

        const revisions = Object.fromEntries(await Promise.all([
            'modules/nested/entry.mjs',
            'modules/nested/static.js',
            'modules/nested/dynamic.js',
            'modules/shared.mjs',
        ].map(async (path) => [path, createHash('sha256').update(await readFile(resolve(root, path))).digest('hex')])))
        const raw = await fetch(`${base(server)}/files/modules/nested/entry.mjs`, {headers})
        expect(await raw.text()).toBe(source)

        const versioned = await fetch(
            `${base(server)}/files/modules/nested/entry.mjs?v=${revisions['modules/nested/entry.mjs']}&r=first`,
            {headers},
        )
        const rewritten = await versioned.text()
        expect(rewritten).toContain(`import './static.js?v=${revisions['modules/nested/static.js']}&r=first'`)
        expect(rewritten).toContain(`from '../shared.mjs?mode=dev&v=${revisions['modules/shared.mjs']}&r=first#named'`)
        expect(rewritten).toContain(`import("./dynamic.js?v=${revisions['modules/nested/dynamic.js']}&r=first")`)
        expect(rewritten).toContain("import 'bare-package'")
        expect(rewritten).toContain('import(name)')
        expect(rewritten).toContain("import './missing.js'")
        expect(versioned.headers.get('etag')).toBe(`"${revisions['modules/nested/entry.mjs']}"`)
        expect(Number(versioned.headers.get('content-length'))).toBe(Buffer.byteLength(rewritten))

        await writeFile(resolve(root, 'modules/nested/static.js'), 'export const value = 4\n')
        const nextStaticRevision = createHash('sha256').update('export const value = 4\n').digest('hex')
        const rewrittenAgain = await (await fetch(
            `${base(server)}/files/modules/nested/entry.mjs?v=${revisions['modules/nested/entry.mjs']}&r=second`,
            {headers},
        )).text()
        expect(rewrittenAgain).toContain(`./static.js?v=${nextStaticRevision}&r=second`)
    })

    it('returns sanitized JSON 404 errors for missing file reads and deletes', async () => {
        const {server, root, headers} = await startServer()
        for (const method of ['GET', 'DELETE']) {
            const response = await fetch(`${base(server)}/files/missing/nothing.txt`, {method, headers})
            expect(response.status).toBe(404)
            expect(response.headers.get('content-type')).toContain('application/json')
            const body = await response.json()
            expect(body).toEqual({error: {code: 'not_found', message: 'File not found.'}})
            expect(JSON.stringify(body)).not.toContain(root)
        }
    })

    it('accepts the query token on GET API routes', async () => {
        const {server} = await startServer()
        const query = `t=${encodeURIComponent(server.token)}`
        expect((await fetch(`${base(server)}/api/state?${query}`)).status).toBe(200)
        expect((await fetch(`${base(server)}/api/files?${query}`)).status).toBe(200)
        const controller = new AbortController()
        const events = await fetch(`${base(server)}/api/events?${query}`, {signal: controller.signal})
        expect(events.status).toBe(200)
        controller.abort()
    })

    it('keeps local deploy and dev credentials out of file APIs', async () => {
        const {server, root, headers} = await startServer()
        await writeFile(resolve(root, '.kite3d/deploys.json'), '{"secret":"deploy"}')
        const manifest = await (await fetch(`${base(server)}/api/files`, {headers})).json() as Array<{path: string}>
        expect(manifest.map(({path}) => path)).not.toContain('.kite3d/deploys.json')
        expect(manifest.map(({path}) => path)).not.toContain('.kite3d/dev.json')
        for (const path of ['.kite3d/deploys.json', '.kite3d/dev.json']) {
            expect((await fetch(`${base(server)}/files/${path}`, {headers})).status).toBe(403)
            expect((await fetch(`${base(server)}/files/${path}`, {
                method: 'DELETE',
                headers,
            })).status).toBe(403)
        }
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
            kite3d: {version: KITE3D_VERSION},
        }
        await writeFile(resolve(root, 'package.json'), JSON.stringify(packageJson))

        const development = await (await fetch(`${base(server)}/api/import-map`, {headers})).json() as {
            imports: Record<string, string>
        }
        const publishedHtml = generateIndexHtml({
            name: packageJson.name,
            version: KITE3D_VERSION,
            runtimeHash: 'abc123',
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
            headers: {...headers, 'If-Match': '*', 'X-Kite3D-Client': 'editor-one'},
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
            data: {path: 'pulled.txt', client: KITE3D_SERVER_CLIENT_ID},
        })
    })

    it('creates and restores Git checkpoints through authenticated server routes', async () => {
        const {server, root, headers} = await startServer()
        await writeFile(resolve(root, '.gitignore'), '.kite3d/\nnode_modules/\n')
        await initializeGitRepository(root)
        const original = await readFile(resolve(root, 'main.js'), 'utf8')
        const checkpoint = await fetch(`${base(server)}/api/checkpoint`, {
            method: 'POST',
            headers: {...headers, 'Content-Type': 'application/json'},
            body: JSON.stringify({label: 'editor route'}),
        })
        expect(checkpoint.status).toBe(200)
        expect(await checkpoint.json()).toMatchObject({hash: expect.stringMatching(/^[a-f\d]+$/), label: 'editor route'})
        const latestCheckpoint = await fetch(`${base(server)}/api/checkpoint`, {headers})
        expect(latestCheckpoint.status).toBe(200)
        expect(await latestCheckpoint.json()).toMatchObject({
            checkpoint: {hash: expect.stringMatching(/^[a-f\d]+$/), label: 'editor route'},
        })

        await writeFile(resolve(root, 'main.js'), 'changed after checkpoint\n')
        const restored = await fetch(`${base(server)}/api/restore`, {
            method: 'POST',
            headers: {...headers, 'Content-Type': 'application/json'},
            body: '{}',
        })
        expect(restored.status, await restored.clone().text()).toBe(200)
        expect(await restored.json()).toMatchObject({hash: expect.stringMatching(/^[a-f\d]+$/)})
        expect(await readFile(resolve(root, 'main.js'), 'utf8')).toBe(original)

        await writeFile(resolve(root, '.kite3d/publish.lock'), '{}')
        const locked = await fetch(`${base(server)}/api/restore`, {method: 'POST', headers, body: '{}'})
        expect(locked.status).toBe(409)
        expect(await locked.json()).toMatchObject({error: {code: 'publish_locked'}})
    })

    it('serves the editor, its shared runtime bridge, and favicon from one origin', async () => {
        const {server, root} = await startServer()
        expect((await fetch(server.url)).status).toBe(200)
        expect(await (await fetch(server.url)).text()).toContain('Kite3D Editor')
        expect((await fetch(`${base(server)}/editor-runtime.js`)).status).toBe(200)
        expect((await fetch(`${base(server)}/_blitz/runtime.js`)).status).toBe(404)
        expect((await fetch(`${base(server)}/favicon.ico`)).status).toBe(200)
        expect((await stat(resolve(server.projectRoot, '.kite3d/dev.json'))).isFile()).toBe(true)
        const dev = JSON.parse(await readFile(resolve(root, '.kite3d/dev.json'), 'utf8')) as {
            origin: string
            url: string
        }
        expect(dev.origin).toBe(base(server))
        expect(new URL(dev.url).searchParams.has('t')).toBe(true)
        expect(dev.origin).not.toContain('?')
        expect(dev.origin).not.toContain(server.token)
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
        const fallback = await createDevServer({
            projectRoot: root,
            port: address.port,
        })
        cleanup.push(() => fallback.close())
        expect(fallback.port).toBe(address.port + 1)

        await expect(createDevServer({
            projectRoot: root,
            port: address.port,
            strictPort: true,
        })).rejects.toThrow(`Port ${address.port} is already in use`)
    })

    it('reports a live project server and refuses a second dev server unless forced', async () => {
        const {server, root} = await startServer()
        const status = await devStatusFromDisk(root)
        expect(status).toMatchObject({pid: process.pid, port: server.port, url: base(server) + '/'})
        expect(status?.age).toMatch(/^\d+s$/)
        expect(JSON.stringify(status)).not.toContain(server.token)

        const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        await expect(runDev({projectRoot: root, noOpen: true})).rejects.toThrow('pass --force')
        expect(warning).toHaveBeenCalledWith(expect.stringContaining('already running for this project'))
        warning.mockRestore()

        const forced = await runDev({projectRoot: root, port: 0, noOpen: true, force: true})
        cleanup.push(() => forced.close())
        expect(forced.port).toBeGreaterThan(0)
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
        const check = await fetch(`${base(server)}/api/check`, {method: 'POST', headers})
        expect(check.status).toBe(409)
        expect(await check.json()).toMatchObject({error: {code: 'editor_not_connected'}})
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
                'X-Kite3D-Client': 'editor-journal-test',
            },
            body: JSON.stringify({
                asset: {version: '2.0'},
                nodes: [{name: 'Authored triangle', mesh: 0}, {name: 'Human node'}],
            }),
        })
        expect(response.status).toBe(200)
        const journalPath = resolve(root, '.kite3d/journal.jsonl')
        await expect.poll(async () => readJournalLines(journalPath)).toMatchObject([{
            client: 'editor-journal-test',
            summary: {nodesAdded: [{name: 'Human node'}]},
        }])

        await writeFile(scenePath, JSON.stringify({asset: {version: '2.0'}, nodes: [{name: 'Agent node'}]}))
        await expect.poll(async () => (await readJournalLines(journalPath)).length, {timeout: 3_000}).toBe(2)
        expect(await readJournalLines(journalPath)).toMatchObject([
            {client: 'editor-journal-test'},
            {client: 'external'},
        ])
    })

    // This passes on macOS with either watcher; Linux CI proves the watcher survives atomic file replacements.
    it('continues watching a scene after repeated atomic API replacements', async () => {
        const {server, root, headers} = await startServer()
        const relativeScenePath = 'assets/main.scene.gltf'
        for (let save = 1; save <= 4; save += 1) {
            const response = await fetch(`${base(server)}/files/${relativeScenePath}`, {
                method: 'PUT',
                headers: {...headers, 'If-Match': '*', 'X-Kite3D-Client': 'editor-atomic-scene'},
                body: JSON.stringify({asset: {version: '2.0'}, nodes: [{name: `Editor save ${save}`}]}),
            })
            expect(response.status).toBe(200)
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 300))

        const controller = new AbortController()
        const eventsResponse = await fetch(`${base(server)}/api/events`, {headers, signal: controller.signal})
        const eventPromise = readEvent(eventsResponse, controller, relativeScenePath)
        await writeFile(resolve(root, relativeScenePath), JSON.stringify({
            asset: {version: '2.0'},
            nodes: [{name: 'External save'}],
        }))

        const event = await eventPromise
        expect(event).toMatchObject({type: 'change', data: {path: relativeScenePath}})
        expect(event.data.client).toBeUndefined()
        const journal = await readJournalLines(resolve(root, '.kite3d/journal.jsonl'))
        expect(journal.filter(({client}) => client === 'editor-atomic-scene')).toHaveLength(4)
        expect(journal.some((entry) => entry.client === 'external' &&
            JSON.stringify(entry).includes('External save'))).toBe(true)
    })

    // This passes on macOS with either watcher; Linux CI proves the watcher survives atomic file replacements.
    it('continues watching a script after repeated atomic API replacements', async () => {
        const {server, root, headers} = await startServer()
        const relativeScriptPath = 'main.js'
        for (let save = 1; save <= 2; save += 1) {
            const response = await fetch(`${base(server)}/files/${relativeScriptPath}`, {
                method: 'PUT',
                headers: {...headers, 'If-Match': '*', 'X-Kite3D-Client': 'editor-atomic-script'},
                body: `export const editorSave = ${save}\n`,
            })
            expect(response.status).toBe(200)
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 300))

        const controller = new AbortController()
        const eventsResponse = await fetch(`${base(server)}/api/events`, {headers, signal: controller.signal})
        const eventPromise = readEvent(eventsResponse, controller, relativeScriptPath)
        await writeFile(resolve(root, relativeScriptPath), 'export const externalSave = true\n')

        const event = await eventPromise
        expect(event).toMatchObject({type: 'change', data: {path: relativeScriptPath}})
        expect(event.data.client).toBeUndefined()
    })

    it('settles split external scene writes before journaling', async () => {
        const {root} = await startServer()
        const scenePath = resolve(root, 'assets/main.scene.gltf')
        const journalPath = resolve(root, '.kite3d/journal.jsonl')
        const scene = JSON.stringify({
            asset: {version: '2.0'},
            nodes: [{name: 'Authored triangle', mesh: 0}, {name: 'Agent node'}],
        })
        const handle = await open(scenePath, 'w')
        await new Promise((resolveWait) => setTimeout(resolveWait, 300))
        await handle.writeFile(scene)
        await handle.close()

        await expect.poll(async () => (await readJournalLines(journalPath)).some((entry) =>
            entry.client === 'external' && JSON.stringify(entry).includes('Agent node'),
        ), {timeout: 3_000}).toBe(true)
        await new Promise((resolveWait) => setTimeout(resolveWait, 300))
        const externalEntries = (await readJournalLines(journalPath)).filter(({client}) => client === 'external')
        expect.soft(externalEntries).toHaveLength(1)
        expect.soft(externalEntries[0]).toMatchObject({
            summary: {nodesAdded: [{name: 'Agent node'}]},
        })
        expect.soft(externalEntries.some(journalEntryHasErrors)).toBe(false)
    })

    it('keeps invalid watcher states out of later server scene diffs', async () => {
        const root = await temporaryProject()
        const scenePath = resolve(root, 'assets/main.scene.gltf')
        const journalPath = resolve(root, '.kite3d/journal.jsonl')
        const externalScene = {asset: {version: '2.0'}, nodes: [{name: 'Agent node'}]}
        await writeFile(scenePath, JSON.stringify(externalScene))
        const server = await createDevServer({
            projectRoot: root,
            port: 0,
            pull: async () => {
                await writeFile(scenePath, JSON.stringify({
                    ...externalScene,
                    nodes: [...externalScene.nodes, {name: 'API node'}],
                }))
                return {release_hash: 'release', updated: ['assets/main.scene.gltf']}
            },
        })
        cleanup.push(() => server.close())
        const headers = {'X-Kite3D-Token': server.token}
        const controller = new AbortController()
        const eventsResponse = await fetch(`${base(server)}/api/events`, {headers, signal: controller.signal})
        const eventPromise = readEvent(eventsResponse, controller, 'assets/main.scene.gltf')

        const handle = await open(scenePath, 'w')
        await new Promise((resolveWait) => setTimeout(resolveWait, 300))
        await handle.close()
        await eventPromise

        const pulled = await fetch(`${base(server)}/api/pull`, {method: 'POST', headers})
        expect(pulled.status).toBe(200)
        await expect.poll(async () => (await readJournalLines(journalPath)).some(({client}) =>
            client === KITE3D_SERVER_CLIENT_ID,
        ), {timeout: 3_000}).toBe(true)
        await new Promise((resolveWait) => setTimeout(resolveWait, 300))
        const entries = await readJournalLines(journalPath)
        expect.soft(entries.filter(({client}) => client === 'external')).toEqual([])
        expect.soft(entries.filter(({client}) => client === KITE3D_SERVER_CLIENT_ID)).toMatchObject([{
            summary: {nodesAdded: [{name: 'API node'}]},
        }])
        expect.soft(entries.some(journalEntryHasErrors)).toBe(false)
    })
})

async function temporaryProject(): Promise<string> {
    const root = await mkdtemp(resolve(tmpdir(), 'kite3d-server-'))
    cleanup.push(() => rm(root, {recursive: true, force: true}))
    await writeFile(resolve(root, 'package.json'), `${JSON.stringify({
        name: 'server-test',
        mainScene: 'assets/main.scene.gltf',
        devDependencies: {'kite3d': KITE3D_VERSION},
        kite3d: {version: KITE3D_VERSION},
    })}\n`)
    await writeFile(resolve(root, 'assets.json'), '{"files":{},"version":1}\n')
    await writeFile(resolve(root, 'main.js'), 'export async function main() {}\n')
    await mkdir(resolve(root, 'assets'), {recursive: true})
    await writeFile(resolve(root, 'assets/main.scene.gltf'), `${JSON.stringify({
        asset: {version: '2.0'},
        scene: 0,
        scenes: [{nodes: [0]}],
        nodes: [{name: 'Authored triangle', mesh: 0}],
        meshes: [{primitives: [{attributes: {POSITION: 0}}]}],
        accessors: [{bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-1, -1, 0], max: [1, 1, 0]}],
        bufferViews: [{buffer: 0, byteOffset: 0, byteLength: 36, target: 34962}],
        buffers: [{byteLength: 36, uri: 'data:application/octet-stream;base64,AAAAAAAAgD8AAAAAAAAAAAAAAIA/AAAAAAAAAAAAAAAAAACAPwAAAAA='}],
    })}\n`)
    await mkdir(resolve(root, 'node_modules/@blitzdev/engine/dist'), {recursive: true})
    await writeFile(resolve(root, 'node_modules/@blitzdev/engine/package.json'), JSON.stringify({version: KITE3D_VERSION}))
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

function journalEntryHasErrors(entry: Record<string, unknown>): boolean {
    return typeof entry.summary === 'object' && entry.summary !== null && 'errors' in entry.summary
}

function parseSse(value: string): Array<{event: string, data: Record<string, unknown>}> {
    return value.trim().split(/\r?\n\r?\n/).map((block) => {
        const lines = block.split(/\r?\n/)
        const event = lines.find((line) => line.startsWith('event:'))?.slice('event:'.length).trim() || ''
        const data = lines.filter((line) => line.startsWith('data:'))
            .map((line) => line.slice('data:'.length).trimStart()).join('\n')
        return {event, data: JSON.parse(data) as Record<string, unknown>}
    }).filter(({event}) => Boolean(event))
}

async function startServer(options: Pick<DevServerOptions, 'publish' | 'pull' | 'backendUrl'> = {}) {
    const root = await temporaryProject()
    const server = await createDevServer({
        projectRoot: root,
        port: 0,
        ...options,
    })
    cleanup.push(() => server.close())
    return {server, root, headers: {'X-Kite3D-Token': server.token}}
}

function base(server: DevServer): string {
    return `http://127.0.0.1:${server.port}`
}

async function statusWithHost(port: number, path: string, host: string, token: string): Promise<number> {
    return new Promise((resolveStatus, reject) => {
        const req = request({hostname: '127.0.0.1', port, path, headers: {Host: host, 'X-Kite3D-Token': token}}, (response) => {
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
