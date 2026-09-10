import {findDeploySlug, readDeploys, writeDeploys} from './deploys.ts'
import {projectDependencies} from '@blitzdev/engine/importMap'
import {readProjectFile, walkProject, writeProjectFile} from './filesystem.ts'
import {generateIndexHtml} from './indexHtml.ts'
import {buildManifest, sha256} from './manifest.ts'
import {BlitzApi, sanitizeDiagnostic} from './api.ts'
import type {
    CreatedAnonymousGame,
    DeployEntry,
    ProjectEntry,
    PublishProgress,
} from './types.ts'

export interface PublishProjectOptions {
    dirHandle: FileSystemDirectoryHandle
    api: BlitzApi
    slug: string
    message?: string
    name?: string
    verify?: boolean
    onProgress?: (progress: PublishProgress) => void
}

export interface PullProjectOptions {
    dirHandle: FileSystemDirectoryHandle
    api: BlitzApi
    entry: DeployEntry
    force?: boolean
}

export async function publishProject({
    dirHandle,
    api,
    slug,
    message,
    name,
    verify = true,
    onProgress,
}: PublishProjectOptions): Promise<{preview_url: string; release_hash: string}> {
    const deploys = await readDeploys(dirHandle)
    let entry: DeployEntry | undefined = deploys.games[slug]
    const packageFile = await readProjectFile(dirHandle, 'package.json')
    if (!packageFile) throw new Error('package.json is required to publish a project.')
    let packageJson = parsePackageJson(await packageFile.text())
    const versionResult = await usePinnedRuntimeVersion(dirHandle, packageJson)
    packageJson = versionResult.packageJson
    let releaseName = name || packageDisplayName(packageJson, slug)

    onProgress?.({phase: 'walking', done: 0, total: 1})
    let projectEntries = await walkProject(dirHandle, {exclude: publishExcludes(packageJson)})
    onProgress?.({phase: 'walking', done: 1, total: 1})

    if (versionResult.changed) {
        const updated = await writeProjectFile(
            dirHandle,
            'package.json',
            `${JSON.stringify(packageJson, null, 2)}\n`,
        )
        projectEntries = replaceEntry(projectEntries, {path: 'package.json', file: updated})
    }
    projectEntries = replaceEntry(projectEntries, {
        path: 'package.json',
        file: publishedPackageFile(packageJson),
    })

    if (!entry) {
        onProgress?.({phase: 'creating', done: 0, total: 1})
        const created = await api.createAnonymousGame({
            slug,
            name: releaseName,
        })
        releaseName = created.name || releaseName
        entry = deployEntryFromCreated(created)
        deploys.games[slug] = entry
        await writeDeploys(dirHandle, deploys)
        onProgress?.({phase: 'creating', done: 1, total: 1, preview_url: entry.preview_url})
    }
    api.useGame(entry.game_id, entry.deploy_token)
    if (entry.last_release_hash && !name) {
        const existingGame = await api.getGame(entry.game_id)
        if (existingGame.name) releaseName = existingGame.name
    }

    const version = versionResult.version
    const installedRuntime = await readProjectFile(dirHandle, 'node_modules/@blitzdev/engine/dist/runtime.js')
    if (!installedRuntime) {
        throw new Error('The installed Blitz runtime is missing. Run npm install before publishing.')
    }
    const runtimeHash = await sha256(installedRuntime)
    try {
        const registered = await api.getRuntime(version)
        const registeredHashes = registered.runtimes?.map(({sha256: hash}) => hash) || [registered.sha256]
        if (!registeredHashes.includes(runtimeHash)) {
            console.warn(`[blitz] Installed runtime ${runtimeHash} differs from registered ${version} runtime ${registered.sha256}; publishing the installed runtime.`)
        }
    } catch (error) {
        if (isHttpNotFound(error)) {
            console.warn(`[blitz] Runtime ${version} is not registered; publishing the installed runtime. A strict backend may reject this release.`)
        } else {
            const detail = sanitizeDiagnostic(error instanceof Error ? error.message : error, [
                entry.deploy_token,
                entry.claim_secret,
            ])
            console.warn(`[blitz] Could not compare runtime ${version} with the registry: ${detail}. Publishing the installed runtime.`)
        }
    }
    const indexHtml = generateIndexHtml({
        name: releaseName,
        version,
        runtimeHash,
        dependencies: projectDependencies(packageJson),
    })
    const indexFile = await writeProjectFile(dirHandle, 'index.html', indexHtml)
    projectEntries = replaceEntry(projectEntries, {path: 'index.html', file: indexFile})
    projectEntries = replaceEntry(projectEntries, {path: '_blitz/runtime.js', file: installedRuntime})

    onProgress?.({phase: 'hashing', done: 0, total: projectEntries.length})
    const manifest = await buildManifest(projectEntries)
    onProgress?.({phase: 'hashing', done: projectEntries.length, total: projectEntries.length})

    const hashes = [...new Set(Object.values(manifest.files).map(({sha256: hash}) => hash))]
    const missing = await api.missingBlobs(hashes)
    const uploadByHash = new Map<string, ProjectEntry>()
    for (const projectEntry of projectEntries) {
        const descriptor = manifest.files[projectEntry.path]
        if (descriptor && !uploadByHash.has(descriptor.sha256)) uploadByHash.set(descriptor.sha256, projectEntry)
    }
    const uploads = missing.map((hash) => {
        const projectEntry = uploadByHash.get(hash)
        if (!projectEntry) throw new Error(`The release blob ${hash} is missing from the project upload set.`)
        return {hash, ...projectEntry}
    })
    await api.uploadBlobs(
        uploads.map(({hash, file, path}) => ({sha256: hash, file, path})),
        ({completed, total, path}) => onProgress?.({phase: 'uploading', done: completed, total, path}),
    )

    onProgress?.({phase: 'releasing', done: 0, total: 1})
    const release = await api.putRelease(manifest, {
        message: message ?? (entry.last_release_hash ? 'update' : 'initial'),
        base_release: entry.last_release_hash,
        metadata: typeof packageJson.description === 'string'
            ? {description: packageJson.description}
            : undefined,
    })
    entry.last_release_hash = release.release_hash
    deploys.games[slug] = entry
    await writeDeploys(dirHandle, deploys)
    onProgress?.({phase: 'releasing', done: 1, total: 1})
    const previewUrl = release.preview_url || entry.preview_url
    if (verify) await verifyRelease(api, previewUrl, manifest, onProgress)
    onProgress?.({phase: 'complete', done: 1, total: 1})
    return {preview_url: previewUrl, release_hash: release.release_hash}
}

export async function pullProject({
    dirHandle,
    api,
    entry,
    force = false,
}: PullProjectOptions): Promise<{release_hash: string; updated: string[]; kept: string[]}> {
    const deploys = await readDeploys(dirHandle)
    const slug = findDeploySlug(deploys, entry)
    if (!slug) throw new Error('The deploy entry is not present in .blitz/deploys.json.')
    if (!entry.last_release_hash) throw new Error('There is nothing to pull before the first publish.')
    api.useGame(entry.game_id, entry.deploy_token)
    const game = await api.getGame(entry.game_id)
    if (!game.active_release) throw new Error('The game does not have an active release to pull.')
    const release = await api.getRelease(game.active_release)
    const previousRelease = await api.getRelease(entry.last_release_hash)
    const updated: string[] = []
    const kept: string[] = []
    for (const path of Object.keys(release.files).sort()) {
        if (path === 'index.html' || path.startsWith('_blitz/')) continue
        const local = await readProjectFile(dirHandle, path)
        const localHash = local ? await sha256(local) : undefined
        if (localHash === release.files[path].sha256) continue
        const previousHash = previousRelease?.files[path]?.sha256
        const modifiedLocally = localHash !== previousHash
        if (modifiedLocally && !force) {
            kept.push(path)
            continue
        }
        const blob = await api.downloadBlob(release.files[path].sha256)
        await writeProjectFile(dirHandle, path, blob)
        updated.push(path)
    }
    entry.last_release_hash = release.release_hash
    deploys.games[slug] = {...deploys.games[slug], last_release_hash: release.release_hash}
    await writeDeploys(dirHandle, deploys)
    return {release_hash: release.release_hash, updated, kept}
}

function parsePackageJson(text: string): Record<string, unknown> {
    const value: unknown = JSON.parse(text)
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('package.json must contain an object.')
    }
    return value as Record<string, unknown>
}

function publishedPackageFile(packageJson: Record<string, unknown>): File {
    const published = {...packageJson}
    delete published.devDependencies
    for (const section of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
        const dependencies = published[section]
        if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) continue
        const filtered = Object.fromEntries(Object.entries(dependencies as Record<string, unknown>)
            .filter(([, spec]) => typeof spec !== 'string' || !spec.startsWith('file:')))
        if (Object.keys(filtered).length) published[section] = filtered
        else delete published[section]
    }
    return new File([`${JSON.stringify(published, null, 2)}\n`], 'package.json', {type: 'application/json'})
}

function packageDisplayName(packageJson: Record<string, unknown>, fallback: string): string {
    const blitz = packageJson.blitz
    if (blitz && typeof blitz === 'object' && !Array.isArray(blitz)) {
        const configured = (blitz as Record<string, unknown>).name
        if (typeof configured === 'string' && configured.trim()) return configured
    }
    return typeof packageJson.name === 'string' && packageJson.name.trim() ? packageJson.name : fallback
}

export function publishExcludes(packageJson: Record<string, unknown>): string[] {
    const blitz = packageJson.blitz
    if (!blitz || typeof blitz !== 'object' || Array.isArray(blitz)) return []
    const publish = (blitz as Record<string, unknown>).publish
    if (publish === undefined) return []
    if (!publish || typeof publish !== 'object' || Array.isArray(publish)) {
        throw new Error('package.json blitz.publish must be an object.')
    }
    const exclude = (publish as Record<string, unknown>).exclude
    if (exclude === undefined) return []
    if (!Array.isArray(exclude) || exclude.some((value) => typeof value !== 'string')) {
        throw new Error('package.json blitz.publish.exclude must be an array of glob strings.')
    }
    return exclude as string[]
}

async function usePinnedRuntimeVersion(dirHandle: FileSystemDirectoryHandle, packageJson: Record<string, unknown>): Promise<{
    packageJson: Record<string, unknown>
    version: string
    changed: boolean
}> {
    const devDependencies = packageJson.devDependencies
    if (!devDependencies || typeof devDependencies !== 'object' || Array.isArray(devDependencies)) {
        throw new Error('package.json must pin @blitzdev/blitz in devDependencies.')
    }
    const spec = (devDependencies as Record<string, unknown>)['@blitzdev/blitz']
    if (typeof spec !== 'string' || !spec) {
        throw new Error('package.json must specify @blitzdev/blitz in devDependencies.')
    }
    let version = spec
    if (!/^\d+\.\d+\.\d+$/.test(spec)) {
        const enginePackageFile = await readProjectFile(dirHandle, 'node_modules/@blitzdev/engine/package.json')
        if (!enginePackageFile) {
            throw new Error(`Project uses @blitzdev/blitz ${spec}, but @blitzdev/engine is not installed. Run npm install before publishing.`)
        }
        const enginePackage = parsePackageJson(await enginePackageFile.text())
        if (typeof enginePackage.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(enginePackage.version)) {
            throw new Error('Installed @blitzdev/engine package.json must have an exact x.y.z version.')
        }
        version = enginePackage.version
    }
    const rawBlitz = packageJson.blitz
    if (rawBlitz !== undefined && (!rawBlitz || typeof rawBlitz !== 'object' || Array.isArray(rawBlitz))) {
        throw new Error('package.json blitz must be an object.')
    }
    const blitz = rawBlitz ? {...rawBlitz as Record<string, unknown>} : {}
    if (blitz.version !== undefined && typeof blitz.version !== 'string') {
        throw new Error('package.json blitz.version must be a string.')
    }
    const changed = blitz.version !== version
    if (changed) blitz.version = version
    return {
        packageJson: changed ? {...packageJson, blitz} : packageJson,
        version,
        changed,
    }
}

function isHttpNotFound(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && 'status' in error && error.status === 404)
}

function replaceEntry(entries: ProjectEntry[], next: ProjectEntry): ProjectEntry[] {
    return [...entries.filter(({path}) => path !== next.path), next]
        .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
}

function deployEntryFromCreated(created: CreatedAnonymousGame): DeployEntry {
    return {
        game_id: created.game_id,
        deploy_token: created.deploy_token,
        claim_secret: created.claim_secret,
        preview_url: created.preview_url,
        expires_at: created.expires_at,
    }
}

async function verifyRelease(
    api: BlitzApi,
    previewUrl: string,
    manifest: Awaited<ReturnType<typeof buildManifest>>,
    onProgress?: (progress: PublishProgress) => void,
): Promise<void> {
    const files = Object.entries(manifest.files).sort(([left], [right]) => left.localeCompare(right))
    onProgress?.({phase: 'verifying', done: 0, total: files.length})
    for (const [index, [path, expected]] of files.entries()) {
        let lastHash = 'unavailable'
        let lastError: unknown
        for (let attempt = 1; attempt <= 5; attempt += 1) {
            try {
                const url = new URL(path.split('/').map(encodeURIComponent).join('/'), ensureTrailingSlash(previewUrl))
                url.searchParams.set('_blitz_verify', `${Date.now()}-${attempt}`)
                lastHash = await sha256(await api.downloadPublicFile(url.href))
                if (lastHash === expected.sha256) {
                    lastError = undefined
                    break
                }
            } catch (error) {
                lastError = error
            }
            if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, Math.min(100 * 2 ** (attempt - 1), 1_000)))
        }
        if (lastError || lastHash !== expected.sha256) {
            const detail = lastError instanceof Error ? lastError.message : `received SHA-256 ${lastHash}`
            throw new Error(`Published file verification failed for ${path}: expected SHA-256 ${expected.sha256}; ${detail}.`)
        }
        onProgress?.({phase: 'verifying', done: index + 1, total: files.length, path})
    }
}

function ensureTrailingSlash(value: string): string {
    return value.endsWith('/') ? value : `${value}/`
}
