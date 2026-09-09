import {readFile, stat} from 'node:fs/promises'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import dotenv from 'dotenv'

const editorDirectory = resolve(fileURLToPath(new URL('..', import.meta.url)))
const repositoryDirectory = resolve(editorDirectory, '../..')
dotenv.config({path: resolve(repositoryDirectory, '.env.local')})

const backendUrl = process.env.BACKEND_URL?.replace(/\/+$/, '')
const token = process.env.RUNTIME_UPLOAD_TOKEN
if (!backendUrl) throw new Error('BACKEND_URL is required to register the runtime.')
if (!token) throw new Error('RUNTIME_UPLOAD_TOKEN is required to register the runtime.')

const packageJson = JSON.parse(await readFile(resolve(editorDirectory, 'package.json'), 'utf8'))
const runtimePath = resolve(editorDirectory, 'dist/runtime.js')
const runtimeStat = await stat(runtimePath)
const runtime = await readFile(runtimePath)
const response = await fetch(`${backendUrl}/api/v1/runtimes/${encodeURIComponent(packageJson.version)}`, {
    method: 'PUT',
    headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/javascript',
        'Content-Length': String(runtimeStat.size),
    },
    body: runtime,
})
if (!response.ok) {
    const body = (await response.text()).slice(0, 1000)
    throw new Error(`Runtime registration failed with ${response.status}: ${body}`)
}
const result = await response.json()
console.log(`Registered runtime ${result.version} (${result.sha256}, ${result.size} bytes)`)
