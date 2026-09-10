#!/usr/bin/env node

import {createHash} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

import {loadReleaseEnvironment} from './register-runtime.mjs'

const repositoryDirectory = resolve(fileURLToPath(new URL('..', import.meta.url)))

function sha256(contents) {
    return createHash('sha256').update(contents).digest('hex')
}

export async function uploadAgentsMd({
    rootDirectory = repositoryDirectory,
    environment,
    fetchImplementation = fetch,
} = {}) {
    const releaseEnvironment = environment ?? await loadReleaseEnvironment(rootDirectory)
    const backendUrl = releaseEnvironment.BLITZ_BACKEND_URL?.replace(/\/+$/, '')
    const token = releaseEnvironment.RUNTIME_UPLOAD_TOKEN
    if (!backendUrl) throw new Error('BLITZ_BACKEND_URL is required to upload agents.md (environment or .env.local).')
    if (!token) throw new Error('RUNTIME_UPLOAD_TOKEN is required to upload agents.md (environment or .env.local).')

    const contents = await readFile(resolve(rootDirectory, 'docs/agents.md'))
    const localHash = sha256(contents)
    const uploadResponse = await fetchImplementation(`${backendUrl}/api/v1/agents-md`, {
        method: 'PUT',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'text/markdown',
            'Content-Length': String(contents.byteLength),
        },
        body: contents,
    })
    if (!uploadResponse.ok) {
        const body = (await uploadResponse.text()).slice(0, 1000)
        throw new Error(`agents.md upload failed with ${uploadResponse.status}: ${body}`)
    }

    const uploaded = await uploadResponse.json()
    if (uploaded.sha256 !== localHash || uploaded.size !== contents.byteLength) {
        throw new Error(`agents.md upload verification failed: local ${localHash} (${contents.byteLength} bytes), server ${uploaded.sha256} (${uploaded.size} bytes).`)
    }
    console.log(`Uploaded agents.md (${localHash}, ${contents.byteLength} bytes)`)

    const downloadResponse = await fetchImplementation(`${backendUrl}/agents.md`)
    if (!downloadResponse.ok) {
        const body = (await downloadResponse.text()).slice(0, 1000)
        throw new Error(`agents.md download verification failed with ${downloadResponse.status}: ${body}`)
    }
    const expectedEtag = `"${localHash}"`
    const etag = downloadResponse.headers.get('etag')
    const downloadedContents = Buffer.from(await downloadResponse.arrayBuffer())
    const downloadedHash = sha256(downloadedContents)
    if (etag !== expectedEtag || downloadedHash !== localHash || downloadedContents.byteLength !== contents.byteLength) {
        throw new Error(`agents.md download verification failed: expected ETag ${expectedEtag} and ${localHash} (${contents.byteLength} bytes), received ETag ${etag ?? '<missing>'} and ${downloadedHash} (${downloadedContents.byteLength} bytes).`)
    }
    console.log(`Verified agents.md (${downloadedHash}, ${downloadedContents.byteLength} bytes; ETag ${etag})`)

    return {sha256: localHash, size: contents.byteLength, etag}
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
    try {
        await uploadAgentsMd()
    } catch (error) {
        console.error(`upload-agents-md: ${error.message}`)
        process.exitCode = 1
    }
}
