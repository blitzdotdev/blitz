/* eslint-env node */

import {createReadStream} from 'node:fs'
import {stat} from 'node:fs/promises'
import {createServer} from 'node:http'
import {extname, normalize, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const runtimeDirectory = fileURLToPath(new URL('.', import.meta.url))
const editorDirectory = resolve(runtimeDirectory, '../..')
const fixtureDirectory = resolve(runtimeDirectory, '../fixtures/sample-project')
const port = Number(process.argv[2] || 4177)

const contentTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.gltf': 'model/gltf+json',
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
    if (pathname === '/runtime.js') return resolve(editorDirectory, 'dist/runtime.js')
    if (!pathname.startsWith('/sample-project/')) return undefined

    const relativePath = normalize(decodeURIComponent(pathname.slice('/sample-project/'.length)))
    if (relativePath.startsWith('..')) return undefined
    return resolve(fixtureDirectory, relativePath)
}
