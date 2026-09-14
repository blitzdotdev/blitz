import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises'
import {request} from 'node:http'
import {createConnection} from 'node:net'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import {afterEach, expect, it} from 'vitest'
import {createDevServer, type DevServer, type DevServerOptions} from '../src/server.ts'
import {KITE3D_VERSION} from '../src/versions.ts'

const cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
    while (cleanup.length) await cleanup.pop()!()
})

// Guards the owner's manual flake: Ctrl-C hung while connections remained open.
it('closes within two seconds with an unread event stream and a stalled keep-alive request', async () => {
        const {server, headers} = await startServer()
        const controller = new AbortController()
        const events = await fetch(`${base(server)}/api/events`, {headers, signal: controller.signal})
        expect(events.status).toBe(200)

        const socket = createConnection({host: '127.0.0.1', port: server.port})
        await new Promise<void>((resolveConnect, reject) => {
            socket.once('connect', resolveConnect)
            socket.once('error', reject)
        })
        const requestReceived = new Promise<void>((resolveRequest) => server.server.once('request', () => resolveRequest()))
        socket.write([
            'PUT /files/stalled.txt HTTP/1.1',
            `Host: 127.0.0.1:${server.port}`,
            `X-Kite3D-Token: ${server.token}`,
            'If-Match: *',
            'Content-Type: application/json',
            'Content-Length: 100',
            'Connection: keep-alive',
            '',
            '{',
        ].join('\r\n'))
        await requestReceived

        try {
            await resolveWithin(server.close(), 2_000)
        } finally {
            controller.abort()
            socket.destroy()
        }
    })

// Guards the owner's security report: the local server accepted unauthenticated or unsafe file requests.
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

// Guards the owner's manual Linux flake: repeated atomic scene saves stopped watcher events.
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
    await mkdir(resolve(root, 'node_modules/@kite3d/engine/dist'), {recursive: true})
    await writeFile(resolve(root, 'node_modules/@kite3d/engine/package.json'), JSON.stringify({version: KITE3D_VERSION}))
    await writeFile(resolve(root, 'node_modules/@kite3d/engine/dist/runtime.js'), 'installed runtime')
    return root
}

async function startServer(options: DevServerOptions = {}) {
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

async function resolveWithin(promise: Promise<void>, milliseconds: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
        await Promise.race([
            promise,
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error(`Close did not resolve within ${milliseconds}ms`)), milliseconds)
            }),
        ])
    } finally {
        clearTimeout(timer)
    }
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
