#!/usr/bin/env node

import {readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const repositoryDirectory = resolve(fileURLToPath(new URL('..', import.meta.url)))

function parseEnvironment(contents) {
    const result = {}
    for (const rawLine of contents.split(/\r?\n/)) {
        const line = rawLine.trim()
        if (!line || line.startsWith('#')) continue
        const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
        if (!match) continue
        let value = match[2].trim()
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1)
        } else {
            value = value.replace(/\s+#.*$/, '').trim()
        }
        result[match[1]] = value
    }
    return result
}

async function loadReleaseEnvironment(rootDirectory) {
    let localEnvironment = {}
    try {
        localEnvironment = parseEnvironment(await readFile(resolve(rootDirectory, '.env.local'), 'utf8'))
    } catch (error) {
        if (error.code !== 'ENOENT') throw error
    }
    return {...localEnvironment, ...process.env}
}

export async function registerRuntime() {
    const environment = await loadReleaseEnvironment(repositoryDirectory)
    const backendUrl = environment.BLITZ_BACKEND_URL?.replace(/\/+$/, '')
    const token = environment.RUNTIME_UPLOAD_TOKEN
    if (!backendUrl) throw new Error('BLITZ_BACKEND_URL is required to register the runtime (environment or .env.local).')
    if (!token) throw new Error('RUNTIME_UPLOAD_TOKEN is required to register the runtime (environment or .env.local).')

    const engineDirectory = resolve(repositoryDirectory, 'packages/engine')
    const packageJson = JSON.parse(await readFile(resolve(engineDirectory, 'package.json'), 'utf8'))
    const runtimePath = resolve(engineDirectory, 'dist/runtime.js')
    const runtime = await readFile(runtimePath)
    const response = await fetch(`${backendUrl}/api/v1/runtimes/${encodeURIComponent(packageJson.version)}`, {
        method: 'PUT',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/javascript',
            'Content-Length': String(runtime.byteLength),
        },
        body: runtime,
    })
    if (!response.ok) {
        const body = (await response.text()).slice(0, 1000)
        throw new Error(`Runtime registration failed with ${response.status}: ${body}`)
    }

    const result = await response.json()
    console.log(`Registered runtime ${result.version} (${result.sha256}, ${result.size} bytes)`)
    return result
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
    try {
        await registerRuntime()
    } catch (error) {
        console.error(`register-runtime: ${error.message}`)
        process.exitCode = 1
    }
}
