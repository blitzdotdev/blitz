import {createHash} from 'node:crypto'
import {mkdtemp, mkdir, readFile, rm, stat, writeFile} from 'node:fs/promises'
import {request} from 'node:http'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {createDevServer, type DevServer} from '../src/server.ts'
import {NodeProjectDirectory} from '../src/node-filesystem.ts'
import {readProjectFile, walkProject, writeProjectFile} from '../src/filesystem.ts'

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
        expect(state).toMatchObject({name: 'server-test', server_version: '0.12.0'})
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

    it('starts a real server and serves the editor and runtime from one origin', async () => {
        const {server} = await startServer()
        expect((await fetch(server.url)).status).toBe(200)
        expect(await (await fetch(server.url)).text()).toContain('test editor')
        expect(await (await fetch(`${base(server)}/_blitz/runtime.js`)).text()).toContain('runtime')
        expect((await stat(resolve(server.projectRoot, '.blitz/dev.json'))).isFile()).toBe(true)
    })
})

async function temporaryProject(): Promise<string> {
    const root = await mkdtemp(resolve(tmpdir(), 'blitz-server-'))
    cleanup.push(() => rm(root, {recursive: true, force: true}))
    await writeFile(resolve(root, 'package.json'), '{"name":"server-test"}\n')
    return root
}

async function startServer() {
    const root = await temporaryProject()
    const editor = resolve(root, 'editor')
    await mkdir(editor)
    await writeFile(resolve(editor, 'index.html'), '<!doctype html><title>test editor</title>')
    const runtimePath = resolve(root, 'runtime.js')
    await writeFile(runtimePath, 'export const runtime = true')
    const server = await createDevServer({projectRoot: root, port: 0, token: 'test-token', editorDirectory: editor, runtimePath})
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
