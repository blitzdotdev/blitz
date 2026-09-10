/* eslint-env node */

import {createReadStream} from 'node:fs'
import {stat} from 'node:fs/promises'
import {createServer} from 'node:http'
import {extname, normalize, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const runtimeDirectory = fileURLToPath(new URL('.', import.meta.url))
const engineDirectory = resolve(runtimeDirectory, '../..')
const fixtureDirectory = resolve(runtimeDirectory, '../../../editor/test/fixtures/sample-project')
const gateFixtureDirectory = resolve(runtimeDirectory, 'fixtures')
const port = Number(process.argv[2] || 4177)

const contentTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.gltf': 'model/gltf+json',
    '.bin': 'application/octet-stream',
}

createServer(async (request, response) => {
    try {
        const pathname = new URL(request.url || '/', `http://${request.headers.host}`).pathname
        const filePath = resolveRequest(pathname)
        if (!filePath || !(await stat(filePath)).isFile()) {
            response.writeHead(404).end('Not found')
            return
        }

        response.writeHead(200, {
            'Content-Type': contentTypes[extname(filePath)] || 'application/octet-stream',
            'Cache-Control': 'no-store',
        })
        createReadStream(filePath).pipe(response)
    } catch {
        response.writeHead(404).end('Not found')
    }
}).listen(port, '127.0.0.1')

function resolveRequest(pathname) {
    if (pathname === '/' || pathname === '/index.html') {
        return resolve(runtimeDirectory, 'index.html')
    }
    if (pathname === '/test-shell.html') return resolve(runtimeDirectory, 'test-shell.html')
    if (pathname === '/runtime.js') return resolve(engineDirectory, 'dist/runtime.js')
    if (pathname.startsWith('/sample-project/')) {
        return resolveFixture(fixtureDirectory, pathname.slice('/sample-project/'.length))
    }
    if (pathname.startsWith('/fixtures/')) {
        return resolveFixture(gateFixtureDirectory, pathname.slice('/fixtures/'.length))
    }
    return undefined
}

function resolveFixture(root, encodedPath) {
    const relativePath = normalize(decodeURIComponent(encodedPath))
    if (relativePath.startsWith('..') || relativePath.startsWith('/')) return undefined
    return resolve(root, relativePath)
}
