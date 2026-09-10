import {readFile, stat, writeFile, mkdir} from 'node:fs/promises'
import {dirname, relative, resolve, sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import openBrowser from 'open'
import {BlitzApi} from './api.ts'
import {readDeploys, writeDeploys} from './deploys.ts'
import {NodeProjectDirectory} from './node-filesystem.ts'
import {publishProject, pullProject} from './publish.ts'
import {createDevServer, type DevServer} from './server.ts'
import type {PublishProgress} from './types.ts'
import {readJournal, type JournalEntry, type ReadJournalOptions} from './journal.ts'

const DEFAULT_BACKEND_URL = 'https://blitz-backend.blitzapp.workers.dev'

export interface PublishFromDiskOptions {
    slug?: string
    name?: string
    message?: string
    backendUrl?: string
}

export interface PublicDeployEntry {
    game_id: string
    slug: string
    preview_url: string
    expires_at: string
    last_release_hash?: string
    claimed: boolean
}

export async function initProject(directory = '.'): Promise<string> {
    const target = resolve(directory)
    const name = directory === '.' ? target.split(sep).at(-1)! : directory.split(/[\\/]/).filter(Boolean).at(-1)!
    await mkdir(target, {recursive: true})
    const template = dirname(fileURLToPath(import.meta.resolve('@blitzdev/template/package.json')))
    const files = [
        ['template/package.json', 'package.json'],
        ['assets.json', 'assets.json'],
        ['main.js', 'main.js'],
        ['AGENTS.md', 'AGENTS.md'],
        ['icon.svg', 'icon.svg'],
        [await templateGitignore(template), '.gitignore'],
        ['assets/main.scene.gltf', 'assets/main.scene.gltf'],
        ['samples/Spin.script.js', 'samples/Spin.script.js'],
    ] as const
    for (const [sourceName, destinationName] of files) {
        const destination = resolve(target, destinationName)
        if (!destination.startsWith(`${target}${sep}`)) throw new Error('Template path escaped target directory')
        try {
            await stat(destination)
            throw new Error(`Refusing to overwrite existing file: ${relative(process.cwd(), destination)}`)
        } catch (error) {
            if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
        }
        await mkdir(dirname(destination), {recursive: true})
        let contents = await readFile(resolve(template, sourceName))
        if (destinationName === 'package.json') {
            contents = Buffer.from(contents.toString('utf8').replaceAll('__BLITZ_PROJECT_NAME__', packageName(name)))
        }
        await writeFile(destination, contents)
    }
    return target
}

export async function runDev(options: {projectRoot?: string, port?: number, noOpen?: boolean, backendUrl?: string} = {}): Promise<DevServer> {
    const projectRoot = resolve(options.projectRoot || process.cwd())
    const server = await createDevServer({
        projectRoot,
        port: options.port,
        backendUrl: options.backendUrl || backendUrl(),
        publish: async (publishOptions, emit) => publishFromDisk(projectRoot, {
            ...publishOptions,
            backendUrl: options.backendUrl || backendUrl(),
        }, emit),
        pull: async () => pullFromDisk(projectRoot),
    })
    if (!options.noOpen) await openBrowser(server.url)
    return server
}

export async function publishFromDisk(
    projectRoot = process.cwd(),
    options: PublishFromDiskOptions | string = {},
    onProgress?: (progress: PublishProgress) => void,
): Promise<{preview_url: string, release_hash: string}> {
    const publishOptions = typeof options === 'string' ? {message: options} : options
    const directory = new NodeProjectDirectory(projectRoot).asHandle()
    const deploys = await readDeploys(directory)
    const existing = Object.entries(deploys.games)[0]
    const packageJson = JSON.parse(await readFile(resolve(projectRoot, 'package.json'), 'utf8')) as {name?: string}
    const slug = publishOptions.slug || existing?.[0] || slugify(packageJson.name || projectRoot.split(sep).at(-1) || 'blitz-game')
    return publishProject({
        dirHandle: directory,
        api: new BlitzApi({baseUrl: publishOptions.backendUrl || backendUrl()}),
        slug,
        name: publishOptions.name,
        message: publishOptions.message,
        onProgress,
    })
}

export async function statusFromDisk(projectRoot = process.cwd()): Promise<PublicDeployEntry[]> {
    const directory = new NodeProjectDirectory(projectRoot).asHandle()
    const deploys = await readDeploys(directory)
    return Object.entries(deploys.games).map(([slug, entry]) => ({
        game_id: entry.game_id,
        slug,
        preview_url: entry.preview_url,
        expires_at: entry.expires_at,
        last_release_hash: entry.last_release_hash,
        claimed: entry.claimed === true,
    }))
}

export async function claimFromDisk(
    options: {email: string, password: string, login?: boolean},
    projectRoot = process.cwd(),
): Promise<PublicDeployEntry[]> {
    const directory = new NodeProjectDirectory(projectRoot).asHandle()
    const deploys = await readDeploys(directory)
    const games = Object.entries(deploys.games)
    if (!games.length) throw new Error('No deploy exists yet. Run blitz publish first.')
    const api = new BlitzApi({baseUrl: backendUrl()})
    const auth = options.login
        ? await api.login({identity: options.email, password: options.password})
        : await api.register({email: options.email, username: usernameFromEmail(options.email), password: options.password})
    api.useToken(auth.token)
    for (const [slug, entry] of games) {
        if (entry.claimed) continue
        await api.claim(slug, entry.claim_secret)
        deploys.games[slug] = {...entry, claimed: true}
        await writeDeploys(directory, deploys)
    }
    return statusFromDisk(projectRoot)
}

export async function pullFromDisk(projectRoot = process.cwd()) {
    const directory = new NodeProjectDirectory(projectRoot).asHandle()
    const deploys = await readDeploys(directory)
    const existing = Object.entries(deploys.games)[0]
    if (!existing) throw new Error('No deploy exists yet. Run blitz publish first.')
    const [, entry] = existing
    return pullProject({
        dirHandle: directory,
        api: new BlitzApi({baseUrl: backendUrl()}),
        entry,
    })
}

export async function openCurrentProject(projectRoot = process.cwd()): Promise<string> {
    const state = JSON.parse(await readFile(resolve(projectRoot, '.blitz/dev.json'), 'utf8')) as {url?: unknown}
    if (typeof state.url !== 'string') throw new Error('.blitz/dev.json does not contain a dev URL')
    await openBrowser(state.url)
    return state.url
}

export async function bakeFromEditor(
    nodeName: string,
    options: {projectRoot?: string, force?: boolean} = {},
): Promise<Record<string, unknown>> {
    if (!nodeName.trim()) throw new Error('A Generator node name is required.')
    const projectRoot = resolve(options.projectRoot || process.cwd())
    let state: {url?: unknown, token?: unknown}
    try {
        state = JSON.parse(await readFile(resolve(projectRoot, '.blitz/dev.json'), 'utf8')) as typeof state
    } catch {
        throw new Error('No Blitz development server is running. Start blitz dev first.')
    }
    if (typeof state.url !== 'string' || typeof state.token !== 'string') {
        throw new Error('.blitz/dev.json does not contain a valid development server connection.')
    }
    const response = await fetch(new URL('/api/bake', state.url), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Blitz-Token': state.token,
            'X-Blitz-Client': 'blitz-bake',
        },
        body: JSON.stringify({nodeName, force: options.force === true}),
    })
    const body = await response.json().catch(() => ({})) as {
        error?: {message?: string}
        [key: string]: unknown
    }
    if (!response.ok) throw new Error(body.error?.message || `Bake failed with status ${response.status}.`)
    return body
}

export async function journalFromDisk(
    projectRoot = process.cwd(),
    options: ReadJournalOptions = {},
): Promise<JournalEntry[]> {
    return readJournal(resolve(projectRoot), options)
}

export async function sourcesInstructions(projectRoot = process.cwd()): Promise<string> {
    const source = resolve(projectRoot, 'node_modules/threepipe/src')
    try {
        if ((await stat(source)).isDirectory()) return `threepipe source is available at ${source}`
    } catch { /* print fallback below */ }
    return [
        'The installed threepipe tarball does not include src/.',
        'Inspect its package version with: npm ls threepipe',
        'Then fetch the matching tag from https://github.com/repalash/threepipe into .blitz/upstream/threepipe for grepping.',
    ].join('\n')
}

async function templateGitignore(template: string): Promise<string> {
    for (const name of ['.gitignore', 'gitignore']) {
        try { await stat(resolve(template, name)); return name } catch { /* try fallback */ }
    }
    throw new Error('The Blitz template does not contain a gitignore file')
}

function packageName(name: string): string {
    const normalized = name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
    return normalized || 'blitz-game'
}

export function slugify(name: string): string {
    let slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/--+/g, '-')
    if (slug.length < 3) slug = `${slug || 'game'}-game`
    return slug.slice(0, 49).replace(/-+$/, '')
}

function backendUrl(): string {
    return process.env.BLITZ_BACKEND_URL || DEFAULT_BACKEND_URL
}

function usernameFromEmail(email: string): string {
    let username = email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
    if (!/^[a-z]/.test(username)) username = `player_${username}`
    return (username || 'player').slice(0, 30)
}
