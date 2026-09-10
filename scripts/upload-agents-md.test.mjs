import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {createServer} from 'node:http'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {after, test} from 'node:test'

import {uploadAgentsMd} from './upload-agents-md.mjs'

const temporaryDirectories = []
const servers = []

after(async () => {
    await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))))
    await Promise.all(temporaryDirectories.map(path => rm(path, {recursive: true, force: true})))
})

async function fixture(handler) {
    const rootDirectory = await mkdtemp(join(tmpdir(), 'blitz-upload-agents-md-test-'))
    temporaryDirectories.push(rootDirectory)
    await mkdir(join(rootDirectory, 'docs'))
    const contents = Buffer.from('# Tiny agents guide\n')
    await writeFile(join(rootDirectory, 'docs/agents.md'), contents)

    const server = createServer(handler)
    servers.push(server)
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const {port} = server.address()
    return {
        contents,
        rootDirectory,
        environment: {BLITZ_BACKEND_URL: `http://127.0.0.1:${port}`, RUNTIME_UPLOAD_TOKEN: 'test-token'},
    }
}

test('uploads agents.md and verifies the response hash and public ETag', async () => {
    let stored
    const data = await fixture((request, response) => {
        if (request.method === 'PUT' && request.url === '/api/v1/agents-md') {
            assert.equal(request.headers.authorization, 'Bearer test-token')
            assert.equal(request.headers['content-type'], 'text/markdown')
            const chunks = []
            request.on('data', chunk => chunks.push(chunk))
            request.on('end', () => {
                stored = Buffer.concat(chunks)
                const hash = createHash('sha256').update(stored).digest('hex')
                response.setHeader('Content-Type', 'application/json')
                response.end(JSON.stringify({sha256: hash, size: stored.byteLength}))
            })
            return
        }
        assert.equal(request.method, 'GET')
        assert.equal(request.url, '/agents.md')
        const hash = createHash('sha256').update(stored).digest('hex')
        response.setHeader('Content-Type', 'text/markdown')
        response.setHeader('ETag', `"${hash}"`)
        response.end(stored)
    })

    const result = await uploadAgentsMd(data)
    assert.deepEqual(stored, data.contents)
    assert.equal(result.size, data.contents.byteLength)
    assert.equal(result.etag, `"${result.sha256}"`)
})

test('rejects a mismatched upload hash', async () => {
    const data = await fixture((request, response) => {
        request.resume()
        request.on('end', () => {
            response.setHeader('Content-Type', 'application/json')
            response.end(JSON.stringify({sha256: '0'.repeat(64), size: data.contents.byteLength}))
        })
    })
    await assert.rejects(uploadAgentsMd(data), /upload verification failed/)
})

test('rejects a mismatched public ETag', async () => {
    const data = await fixture((request, response) => {
        if (request.method === 'PUT') {
            request.resume()
            request.on('end', () => {
                const hash = createHash('sha256').update(data.contents).digest('hex')
                response.setHeader('Content-Type', 'application/json')
                response.end(JSON.stringify({sha256: hash, size: data.contents.byteLength}))
            })
            return
        }
        response.setHeader('ETag', '"wrong"')
        response.end(data.contents)
    })
    await assert.rejects(uploadAgentsMd(data), /download verification failed/)
})
