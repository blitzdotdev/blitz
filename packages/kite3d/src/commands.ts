import {spawn} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import {createRequire} from 'node:module'
import {mkdir, open, readFile, readdir, stat, unlink, writeFile} from 'node:fs/promises'
import {dirname, relative, resolve, sep} from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
import openBrowser from 'open'
import {Kite3dApi, sanitizeDiagnostic} from './api.ts'
import {resolveBackendUrl} from './backend.ts'
import {readDeploys, writeDeploys} from './deploys.ts'
import {NodeProjectDirectory} from './node-filesystem.ts'
import {publishProject, pullProject} from './publish.ts'
import {createDevServer, type DevServer} from './server.ts'
import type {DeploysFile, PublishProgress} from './types.ts'
import {appendJournalEntry, readJournal, type JournalEntry, type ReadJournalOptions} from './journal.ts'
import {KITE3D_VERSION} from './versions.ts'
import {gitRepositoryRoot, gitTracksProject, initializeGitRepository} from './git.ts'
import {assertLegacyEngineIsHoisted, migrateLegacyProject} from './legacy.ts'
import {screenshotProject, type ScreenshotOptions, type ScreenshotResult} from './screenshot.ts'
import {processIsAlive, readDevelopmentServer, startDetachedDevelopmentServer, stopDevelopmentServer} from './hubRoutes.ts'
import {registerProject} from './projectIndex.ts'

const commandRequire = createRequire(import.meta.url)

export interface PublishFromDiskOptions {
    slug?: string
    name?: string
    message?: string
    backendUrl?: string
    noVerify?: boolean
}

export interface PublicDeployEntry {
    game_id: string
    slug: string
    preview_url: string
    expires_at: string
    last_release_hash?: string
    claimed: boolean
}

export interface PublicClaimEntry {
    slug: string
    claim_url: string
}

export interface PublicDevServer {
    pid: number
    port: number
    age: string
    url: string
}

interface RuntimeProjectTools {
    findRemovedGeneratorNodes(text: string): Array<{nodeName: string}>
    parsePackageJSON(text: string): Record<string, unknown>
    parseAssetsJSONManifest(text: string): unknown
    parsePackageJsonSettingsConfig(json: Record<string, unknown>): Promise<unknown>
    validateSceneSource(path: string, text: string): void
}

interface RuntimeMigration {
    version: string
    migrate(projectRoot: string): void | Promise<void>
}

const TEMPLATE_RENAMES: Readonly<Record<string, string>> = {gitignore: '.gitignore'}

export async function initProject(directory = '.', options: {git?: boolean} = {}): Promise<string> {
    const target = resolve(directory)
    const name = directory === '.' ? target.split(sep).at(-1)! : directory.split(/[\\/]/).filter(Boolean).at(-1)!
    await mkdir(target, {recursive: true})
    const repository = await gitRepositoryRoot(target)
    const shouldInitializeGit = options.git !== false
        && (!repository || (repository !== target && !await gitTracksProject(target)))
    const template = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'template')
    for (const sourceName of await walkTemplate(template)) {
        const destinationName = TEMPLATE_RENAMES[sourceName] || sourceName
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
            const projectManifest = JSON.parse(contents.toString('utf8').replaceAll('__KITE3D_PROJECT_NAME__', packageName(name))) as {
                devDependencies?: Record<string, unknown>
                kite3d?: Record<string, unknown>
            }
            projectManifest.devDependencies = {...projectManifest.devDependencies, 'kite3d': KITE3D_VERSION}
            projectManifest.kite3d = {...projectManifest.kite3d, version: KITE3D_VERSION}
            contents = Buffer.from(`${JSON.stringify(projectManifest, null, 2)}\n`)
        }
        await writeFile(destination, contents)
    }
    if (shouldInitializeGit) await initializeGitRepository(target)
    await registerProject(target)
    return target
}

export async function upgradeProject(
    projectRoot = process.cwd(),
): Promise<{from: string, to: string, changes: string[], removedGeneratorNodes: string[], next?: string}> {
    const root = resolve(projectRoot)
    const packagePath = resolve(root, 'package.json')
    const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as Record<string, unknown>
    const devDependencies = record(packageJson.devDependencies)
    const dependencies = record(packageJson.dependencies)
    const legacyConfig = record(packageJson.blitz)
    const legacySpecifier = [
        devDependencies['@blitzdev/blitz'],
        dependencies['@blitzdev/blitz'],
    ].find((value): value is string => typeof value === 'string' && Boolean(value))
    const from = legacySpecifier
        ? legacyProjectVersion(legacyConfig.version, legacySpecifier)
        : [devDependencies.kite3d, dependencies.kite3d]
            .find((value): value is string => typeof value === 'string' && Boolean(value))
    if (!from) throw new Error('package.json must pin kite3d or legacy @blitzdev/blitz in dependencies')
    const to = KITE3D_VERSION
    compareVersions(from, to)
    if (compareVersions(from, to) > 0) throw new Error(`Cannot upgrade from ${from} to older version ${to}`)

    const changes = await migrateLegacyProject(root, to)
    const migratedPackageJson = JSON.parse(await readFile(packagePath, 'utf8')) as Record<string, unknown>
    const migratedDevDependencies = record(migratedPackageJson.devDependencies)
    const migratedDependencies = record(migratedPackageJson.dependencies)
    const dependencySection = Object.prototype.hasOwnProperty.call(migratedDevDependencies, 'kite3d')
        ? 'devDependencies'
        : Object.prototype.hasOwnProperty.call(migratedDependencies, 'kite3d') ? 'dependencies' : 'devDependencies'
    const selectedDependencies = dependencySection === 'devDependencies'
        ? migratedDevDependencies
        : migratedDependencies
    const kite3d = record(migratedPackageJson.kite3d)
    await writeFile(packagePath, `${JSON.stringify({
        ...migratedPackageJson,
        [dependencySection]: {...selectedDependencies, kite3d: to},
        kite3d: {...kite3d, version: to},
    }, null, 2)}\n`, 'utf8')

    await installProjectDependencies(root)
    if (legacySpecifier) await assertLegacyEngineIsHoisted(root)
    const runtime = await loadInstalledRuntime(root)
    for (const migration of selectProjectMigrations(runtime.migrations, from, to)) await migration.migrate(root)

    const packageText = await readFile(packagePath, 'utf8')
    const parsedPackage = runtime.tools.parsePackageJSON(packageText)
    await runtime.tools.parsePackageJsonSettingsConfig(parsedPackage)
    runtime.tools.parseAssetsJSONManifest(await readFile(resolve(root, 'assets.json'), 'utf8'))
    const mainScene = parsedPackage.mainScene
    if (typeof mainScene !== 'string') throw new Error('package.json mainScene must be a string')
    const sceneText = await readFile(resolve(root, mainScene), 'utf8')
    runtime.tools.validateSceneSource(mainScene, sceneText)
    const removedGeneratorNodes = runtime.tools.findRemovedGeneratorNodes(sceneText).map(({nodeName}) => nodeName)
    await appendJournalEntry(root, 'kite3d-upgrade', {upgrade: {from, to}})
    return legacySpecifier && await legacyPackageInstalled(root)
        ? {from, to, changes, removedGeneratorNodes, next: 'npm install'}
        : {from, to, changes, removedGeneratorNodes}
}

export async function runDev(options: {
    projectRoot?: string
    port?: number
    strictPort?: boolean
    noOpen?: boolean
    backendUrl?: string
    force?: boolean
} = {}): Promise<DevServer> {
    const projectRoot = resolve(options.projectRoot || process.cwd())
    const existing = await devStatusFromDisk(projectRoot)
    if (existing && !options.force) {
        console.warn(`[kite3d] A development server is already running for this project (pid ${existing.pid}, port ${existing.port}).`)
        throw new Error('Use kite3d open to open it, or pass --force to start another server.')
    }
    const releaseStartupLock = await acquireDevelopmentStartupLock(projectRoot)
    let server: DevServer | undefined
    try {
        const concurrent = await devStatusFromDisk(projectRoot)
        if (concurrent && !options.force) {
            console.warn(`[kite3d] A development server is already running for this project (pid ${concurrent.pid}, port ${concurrent.port}).`)
            throw new Error('Use kite3d open to open it, or pass --force to start another server.')
        }
        const backendUrl = resolveBackendUrl(options.backendUrl)
        server = await createDevServer({
            projectRoot,
            port: options.port,
            strictPort: options.strictPort,
            backendUrl,
            publish: async (publishOptions, emit) => publishFromDisk(projectRoot, {
                ...publishOptions,
                backendUrl,
            }, emit),
            pull: async () => pullFromDisk(projectRoot),
        })
        await registerProject(projectRoot)
        if (!options.noOpen) await openBrowser(server.url)
        return server
    } catch (error) {
        await server?.close()
        throw error
    } finally {
        await releaseStartupLock()
    }
}

export function runDetachedDev(options: {
    projectRoot?: string
    cliPath?: string
    port?: number
    force?: boolean
} = {}) {
    return startDetachedDevelopmentServer(
        resolve(options.projectRoot || process.cwd()),
        resolve(options.cliPath || process.argv[1]),
        {port: options.port, force: options.force},
    )
}

export function stopDev(projectRoot = process.cwd()): Promise<boolean> {
    return stopDevelopmentServer(resolve(projectRoot))
}

async function acquireDevelopmentStartupLock(projectRoot: string): Promise<() => Promise<void>> {
    const directory = resolve(projectRoot, '.kite3d')
    const path = resolve(directory, 'dev-start.lock')
    const owner = {pid: process.pid, created_at: new Date().toISOString(), id: randomUUID()}
    await mkdir(directory, {recursive: true})
    for (let attempt = 0; attempt < 1_200; attempt += 1) {
        try {
            const handle = await open(path, 'wx', 0o600)
            try {
                await handle.writeFile(`${JSON.stringify(owner)}\n`, 'utf8')
            } finally {
                await handle.close()
            }
            return async () => {
                try {
                    const current = JSON.parse(await readFile(path, 'utf8')) as {id?: unknown}
                    if (current.id === owner.id) await unlink(path)
                } catch { /* already released or replaced */ }
            }
        } catch (error) {
            if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
            let current: {pid?: unknown, created_at?: unknown} = {}
            try { current = JSON.parse(await readFile(path, 'utf8')) as typeof current } catch { /* replace below */ }
            const createdAt = typeof current.created_at === 'string' ? Date.parse(current.created_at) : Number.NaN
            if (typeof current.pid !== 'number' || !Number.isInteger(current.pid) || !processIsAlive(current.pid)
                || !Number.isFinite(createdAt) || Date.now() - createdAt > 60_000) {
                await unlink(path).catch(() => undefined)
                continue
            }
            await new Promise((resolveWait) => setTimeout(resolveWait, 50))
        }
    }
    throw new Error(`Timed out waiting to start the development server for ${projectRoot}.`)
}

export async function publishFromDisk(
    projectRoot = process.cwd(),
    options: PublishFromDiskOptions = {},
    onProgress?: (progress: PublishProgress) => void,
): Promise<{preview_url: string, release_hash: string}> {
    const root = resolve(projectRoot)
    const releaseLock = await acquirePublishLock(root)
    const directory = new NodeProjectDirectory(root).asHandle()
    let slug = options.slug || ''
    try {
        const deploys = await readDeploys(directory)
        const existing = Object.entries(deploys.games)[0]
        const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as {name?: string}
        slug ||= existing?.[0] || slugify(packageJson.name || root.split(sep).at(-1) || 'kite3d-game')
        const selected = deploys.games[slug]
        if (selected && !selected.claimed) {
            const hasZone = /[zZ]|[+-]\d\d:\d\d$/.test(selected.expires_at)
            const expiresAt = Date.parse(selected.expires_at.replace(' ', 'T') + (hasZone ? '' : 'Z'))
            if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) delete deploys.games[slug]
        }
        deploys.last_publish = {slug, status: 'publishing', updated_at: new Date().toISOString()}
        await writeDeploys(directory, deploys)
        await assertEditorAllowsPublish(root)

        const result = await publishProject({
            dirHandle: directory,
            api: new Kite3dApi({baseUrl: resolveBackendUrl(options.backendUrl)}),
            slug,
            name: options.name,
            message: options.message,
            verify: options.noVerify !== true,
            onProgress,
        })
        const updated = await readDeploys(directory)
        updated.last_publish = {
            slug,
            status: 'succeeded',
            updated_at: new Date().toISOString(),
            release_hash: result.release_hash,
        }
        await writeDeploys(directory, updated)
        return result
    } catch (error) {
        const current: DeploysFile = await readDeploys(directory).catch(() => ({games: {}}))
        const secrets = Object.values(current.games).flatMap(({deploy_token, claim_secret}) => [deploy_token, claim_secret])
        const message = sanitizeDiagnostic(error instanceof Error ? error.message : error, secrets)
        const status = error && typeof error === 'object' && 'status' in error && typeof error.status === 'number'
            ? error.status
            : undefined
        const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
            ? error.code
            : undefined
        if (slug) {
            current.last_publish = {
                slug,
                status: 'failed',
                updated_at: new Date().toISOString(),
                error: message,
                ...(status === undefined ? {} : {error_status: status}),
                ...(code === undefined ? {} : {error_code: code}),
            }
            await writeDeploys(directory, current).catch(() => undefined)
        }
        const safeError = new Error(message)
        if (status !== undefined) Object.assign(safeError, {status})
        if (code !== undefined) Object.assign(safeError, {code})
        throw safeError
    } finally {
        await releaseLock()
    }
}

export async function statusFromDisk(projectRoot = process.cwd()): Promise<PublicDeployEntry[]> {
    const directory = new NodeProjectDirectory(projectRoot).asHandle()
    const deploys = await readDeploys(directory)
    await reconcileClaimedDeploys(directory, deploys)
    return Object.entries(deploys.games).map(([slug, entry]) => ({
        game_id: entry.game_id,
        slug,
        preview_url: entry.preview_url,
        expires_at: entry.expires_at,
        last_release_hash: entry.last_release_hash,
        claimed: entry.claimed === true,
    }))
}

export async function devStatusFromDisk(projectRoot = process.cwd()): Promise<PublicDevServer | undefined> {
    const state = await readDevelopmentServer(resolve(projectRoot))
    if (!state) return undefined
    const started = Date.parse(state.startedAt)
    let publicUrl: string
    try {
        const url = new URL(state.url)
        url.searchParams.delete('t')
        publicUrl = url.toString()
    } catch {
        return undefined
    }
    return {
        pid: state.pid,
        port: state.port,
        age: formatAge(Math.max(0, Date.now() - started)),
        url: publicUrl,
    }
}

export async function claimFromDisk(projectRoot = process.cwd()): Promise<PublicClaimEntry[]> {
    const directory = new NodeProjectDirectory(projectRoot).asHandle()
    const deploys = await readDeploys(directory)
    if (!Object.keys(deploys.games).length) throw new Error('No deploy exists yet. Run kite3d publish first.')
    await reconcileClaimedDeploys(directory, deploys)
    const backendUrl = resolveBackendUrl()
    return Object.entries(deploys.games).flatMap(([slug, entry]) => entry.claimed ? [] : [{
        slug,
        claim_url: entry.claim_url
            ?? `${backendUrl}/claim/${encodeURIComponent(slug)}?secret=${encodeURIComponent(entry.claim_secret)}`,
    }])
}

async function reconcileClaimedDeploys(
    directory: FileSystemDirectoryHandle,
    deploys: DeploysFile,
): Promise<void> {
    const backendUrl = resolveBackendUrl()
    let changed = false
    for (const [slug, entry] of Object.entries(deploys.games)) {
        if (entry.claimed) continue
        try {
            const api = new Kite3dApi({
                baseUrl: backendUrl,
                gameId: entry.game_id,
                token: entry.deploy_token,
            })
            const game = await api.getGame()
            if (game.expires_at !== null && game.expires_at !== undefined) continue
            deploys.games[slug] = {...entry, claimed: true}
            changed = true
        } catch {
            // Claim reconciliation is best-effort. Keep the local state and claim URL usable.
        }
    }
    if (changed) await writeDeploys(directory, deploys)
}

export async function pullFromDisk(projectRoot = process.cwd(), options: {force?: boolean} = {}) {
    const directory = new NodeProjectDirectory(projectRoot).asHandle()
    const deploys = await readDeploys(directory)
    const existing = Object.entries(deploys.games)[0]
    if (!existing?.[1].last_release_hash) return {release_hash: undefined, updated: [], kept: []}
    const [, entry] = existing
    return pullProject({
        dirHandle: directory,
        api: new Kite3dApi({baseUrl: resolveBackendUrl()}),
        entry,
        force: options.force === true,
    })
}

const EDITOR_HEARTBEAT_FRESH_MS = 15_000
const PUBLISH_LOCK_STALE_MS = 10 * 60_000

async function assertEditorAllowsPublish(root: string): Promise<void> {
    let state: {
        playState?: unknown
        dirty?: unknown
        sourceDraftDirty?: unknown
        sceneHash?: unknown
        savedSceneHash?: unknown
        updatedAt?: unknown
    }
    try {
        state = JSON.parse(await readFile(resolve(root, '.kite3d/state.json'), 'utf8')) as typeof state
    } catch {
        return
    }
    if (typeof state.updatedAt !== 'string') return
    const updatedAt = Date.parse(state.updatedAt)
    if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > EDITOR_HEARTBEAT_FRESH_MS) return
    if (state.playState === 'playing') {
        throw Object.assign(new Error('Stop Play in the editor before publishing.'), {
            status: 409,
            code: 'editor_playing',
        })
    }
    const sceneHashesMatch = typeof state.sceneHash === 'string'
        && typeof state.savedSceneHash === 'string'
        && state.sceneHash === state.savedSceneHash
    if (state.sourceDraftDirty === true || state.dirty === true && !sceneHashesMatch) {
        throw Object.assign(new Error('Save the unsaved editor draft before publishing.'), {
            status: 409,
            code: 'editor_dirty',
        })
    }
}

async function acquirePublishLock(root: string): Promise<() => Promise<void>> {
    const lockPath = resolve(root, '.kite3d/publish.lock')
    const owner = {pid: process.pid, created_at: new Date().toISOString(), id: randomUUID()}
    await mkdir(resolve(root, '.kite3d'), {recursive: true})
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            const handle = await open(lockPath, 'wx', 0o600)
            try {
                await handle.writeFile(`${JSON.stringify(owner)}\n`, 'utf8')
            } finally {
                await handle.close()
            }
            return async () => {
                try {
                    const current = JSON.parse(await readFile(lockPath, 'utf8')) as {id?: unknown}
                    if (current.id === owner.id) await unlink(lockPath)
                } catch { /* already released or replaced */ }
            }
        } catch (error) {
            if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
            const metadata = await stat(lockPath).catch(() => undefined)
            if (!metadata) continue
            let value: {pid?: unknown, created_at?: unknown} = {}
            try { value = JSON.parse(await readFile(lockPath, 'utf8')) as typeof value } catch { /* use mtime */ }
            const createdAt = typeof value.created_at === 'string' ? Date.parse(value.created_at) : metadata.mtimeMs
            const age = Math.max(0, Date.now() - (Number.isFinite(createdAt) ? createdAt : metadata.mtimeMs))
            if (age <= PUBLISH_LOCK_STALE_MS) {
                const pid = Number.isInteger(value.pid) ? ` by pid ${value.pid}` : ''
                throw Object.assign(new Error(`Another publish is already running${pid} (${formatAge(age)} old).`), {
                    status: 409,
                    code: 'publish_locked',
                })
            }
            await unlink(lockPath).catch(() => undefined)
        }
    }
    throw new Error('Could not acquire .kite3d/publish.lock after replacing a stale lock.')
}

function formatAge(milliseconds: number): string {
    const seconds = Math.floor(milliseconds / 1_000)
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`
    const hours = Math.floor(minutes / 60)
    return `${hours}h ${minutes % 60}m`
}

export function screenshotFromDisk(
    projectRoot = process.cwd(),
    options: ScreenshotOptions = {},
): Promise<ScreenshotResult> {
    return screenshotProject(projectRoot, options)
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
        'Then fetch the matching tag from https://github.com/repalash/threepipe into .kite3d/upstream/threepipe for grepping.',
    ].join('\n')
}

async function walkTemplate(root: string): Promise<string[]> {
    const files: string[] = []
    await visit(root, '')
    return files.sort()

    async function visit(directory: string, prefix: string): Promise<void> {
        for (const entry of await readdir(directory, {withFileTypes: true})) {
            const path = prefix ? `${prefix}/${entry.name}` : entry.name
            if (entry.isDirectory()) await visit(resolve(directory, entry.name), path)
            else if (entry.isFile()) files.push(path)
        }
    }
}

function packageName(name: string): string {
    const normalized = name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
    return normalized || 'kite3d-game'
}

export function slugify(name: string): string {
    let slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/--+/g, '-')
    if (slug.length < 3) slug = `${slug || 'game'}-game`
    return slug.slice(0, 49).replace(/-+$/, '')
}

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function compareVersions(left: string, right: string): number {
    const parseVersion = (value: string): [number, number, number, string | null, number] => {
        const match = /^(\d+)\.(\d+)\.(\d+)(?:-([A-Za-z][0-9A-Za-z-]*)\.(\d+))?$/.exec(value)
        if (!match) throw new Error(`Kite3D version must be an exact x.y.z or x.y.z-word.n version: ${value}`)
        return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] ?? null, Number(match[5] ?? 0)]
    }
    const leftParts = parseVersion(left)
    const rightParts = parseVersion(right)
    const numericPairs = [
        [leftParts[0], rightParts[0]],
        [leftParts[1], rightParts[1]],
        [leftParts[2], rightParts[2]],
    ]
    for (const [leftPart, rightPart] of numericPairs) {
        if (leftPart !== rightPart) return leftPart - rightPart
    }
    if (leftParts[3] === null || rightParts[3] === null) return leftParts[3] === rightParts[3] ? 0 : leftParts[3] === null ? 1 : -1
    return leftParts[3].localeCompare(rightParts[3]) || leftParts[4] - rightParts[4]
}

function legacyProjectVersion(configured: unknown, specifier: string): string {
    return [configured, specifier]
        .find((value): value is string => typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value))
        || '0.0.0'
}

async function legacyPackageInstalled(root: string): Promise<boolean> {
    try {
        return (await stat(resolve(root, 'node_modules/@blitzdev/blitz'))).isDirectory()
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
        throw error
    }
}

export function selectProjectMigrations(
    migrations: readonly RuntimeMigration[],
    from: string,
    to: string,
): readonly RuntimeMigration[] {
    return migrations.filter(({version}) => compareVersions(version, from) > 0 && compareVersions(version, to) <= 0)
}

function installProjectDependencies(projectRoot: string): Promise<void> {
    return new Promise((resolveInstall, reject) => {
        const child = spawn('npm', ['install', '--ignore-scripts'], {cwd: projectRoot, stdio: 'inherit'})
        child.once('error', reject)
        child.once('exit', (code, signal) => {
            if (code === 0) resolveInstall()
            else reject(new Error(`npm install --ignore-scripts failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}`))
        })
    })
}

async function loadInstalledRuntime(projectRoot: string): Promise<{
    tools: RuntimeProjectTools
    migrations: readonly RuntimeMigration[]
}> {
    const projectRequire = createRequire(resolve(projectRoot, 'package.json'))
    let manifestPath: string
    try {
        manifestPath = projectRequire.resolve('@kite3d/engine/package.json')
    } catch {
        manifestPath = commandRequire.resolve('@kite3d/engine/package.json')
    }
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
        exports?: Record<string, string | {import?: string, default?: string}>
    }
    const resolveExport = (name: string): string => {
        const entry = manifest.exports?.[`./${name}`]
        const target = typeof entry === 'string' ? entry : entry?.import || entry?.default
        if (!target) throw new Error(`@kite3d/engine does not export ./${name}`)
        return resolve(dirname(manifestPath), target)
    }
    const cacheKey = `upgrade=${Date.now()}`
    const tools = await import(`${pathToFileURL(resolveExport('projectFormat')).href}?${cacheKey}`) as RuntimeProjectTools
    const migrationModule = await import(`${pathToFileURL(resolveExport('migrations')).href}?${cacheKey}`) as {
        PROJECT_MIGRATIONS?: readonly RuntimeMigration[]
    }
    return {tools, migrations: migrationModule.PROJECT_MIGRATIONS || []}
}
