import {findDeploySlug, readDeploys, writeDeploys} from './deploys.ts'
import {readProjectFile, walkProject, writeProjectFile} from './filesystem.ts'
import {generateIndexHtml} from './indexHtml.ts'
import {buildManifest, sha256} from './manifest.ts'
import type {
    CreatedAnonymousGame,
    DeployEntry,
    GameRecord,
    ProjectDependency,
    ProjectEntry,
    PublishProgress,
    ReleaseManifest,
    ReleaseRecord,
    RuntimeRecord,
} from './types.ts'
import {RUNTIME_VERSION} from '../runtime/version.ts'

export interface PublishApi {
    useGame(gameId: string, token: string): unknown
    createAnonymousGame(options: {slug: string; name?: string}): Promise<CreatedAnonymousGame>
    getRuntime(version: string): Promise<RuntimeRecord>
    missingBlobs(hashes: string[]): Promise<string[]>
    uploadBlob(hash: string, file: Blob, onProgress?: (uploaded: number, total: number) => void): Promise<unknown>
    putRelease(
        manifest: ReleaseManifest,
        options?: {message?: string; base_release?: string},
    ): Promise<{release_hash: string; preview_url: string}>
    getGame(id?: string): Promise<GameRecord>
    getRelease(hash: string): Promise<ReleaseRecord>
    downloadBlob(hash: string): Promise<Blob>
}

export interface ExistingDeployTarget extends DeployEntry {
    slug: string
}

export interface PublishProjectOptions {
    dirHandle: FileSystemDirectoryHandle
    api: PublishApi
    slug?: string | ExistingDeployTarget
    entry?: ExistingDeployTarget
    message?: string
    onProgress?: (progress: PublishProgress) => void
}

export interface PullProjectOptions {
    dirHandle: FileSystemDirectoryHandle
    api: PublishApi
    entry: DeployEntry
}

export async function publishProject({
    dirHandle,
    api,
    slug: slugOrEntry,
    entry: explicitEntry,
    message,
    onProgress,
}: PublishProjectOptions): Promise<{preview_url: string; release_hash: string}> {
    const deploys = await readDeploys(dirHandle)
    const target = explicitEntry ?? (typeof slugOrEntry === 'object' ? slugOrEntry : undefined)
    const slug = target?.slug ?? slugOrEntry
    if (typeof slug !== 'string' || !slug) throw new Error('A slug or existing deploy entry is required.')

    let entry: DeployEntry | undefined = target ? deployEntryFromTarget(target) : deploys.games[slug]
    const packageFile = await readProjectFile(dirHandle, 'package.json')
    if (!packageFile) throw new Error('package.json is required to publish a project.')
    let packageJson = parsePackageJson(await packageFile.text())

    if (!entry) {
        onProgress?.({phase: 'creating', completed: 0, total: 1})
        const created = await api.createAnonymousGame({
            slug,
            name: typeof packageJson.name === 'string' ? packageJson.name : slug,
        })
        entry = deployEntryFromCreated(created)
        deploys.games[slug] = entry
        await writeDeploys(dirHandle, deploys)
        onProgress?.({phase: 'creating', completed: 1, total: 1})
    }
    api.useGame(entry.game_id, entry.deploy_token)

    onProgress?.({phase: 'walking', completed: 0, total: 1})
    let projectEntries = await walkProject(dirHandle)
    onProgress?.({phase: 'walking', completed: 1, total: 1})

    const versionResult = ensureRuntimeVersion(packageJson)
    packageJson = versionResult.packageJson
    if (versionResult.changed) {
        const updated = await writeProjectFile(
            dirHandle,
            'package.json',
            `${JSON.stringify(packageJson, null, 2)}\n`,
        )
        projectEntries = replaceEntry(projectEntries, {path: 'package.json', file: updated})
    }

    const version = versionResult.version
    const runtime = await api.getRuntime(version)
    const indexHtml = generateIndexHtml({
        name: typeof packageJson.name === 'string' ? packageJson.name : slug,
        version,
        dependencies: packageDependencies(packageJson),
    })
    const indexFile = await writeProjectFile(dirHandle, 'index.html', indexHtml)
    projectEntries = replaceEntry(projectEntries, {path: 'index.html', file: indexFile})

    onProgress?.({phase: 'hashing', completed: 0, total: projectEntries.length})
    const manifest = await buildManifest(projectEntries, runtime)
    onProgress?.({phase: 'hashing', completed: projectEntries.length, total: projectEntries.length})

    const hashes = [...new Set(Object.values(manifest.files).map(({sha256: hash}) => hash))]
    const missing = await api.missingBlobs(hashes)
    const uploadByHash = new Map<string, ProjectEntry>()
    for (const projectEntry of projectEntries) {
        const descriptor = manifest.files[projectEntry.path]
        if (descriptor && !uploadByHash.has(descriptor.sha256)) uploadByHash.set(descriptor.sha256, projectEntry)
    }
    const uploads = missing.map((hash) => {
        const projectEntry = uploadByHash.get(hash)
        if (!projectEntry) throw new Error(`The registered runtime blob ${hash} is missing from storage.`)
        return {hash, ...projectEntry}
    })
    await uploadWithPool(api, uploads, onProgress)

    onProgress?.({phase: 'releasing', completed: 0, total: 1})
    const release = await api.putRelease(manifest, {
        message: message ?? (entry.last_release_hash ? 'update' : 'initial'),
        base_release: entry.last_release_hash,
    })
    entry.last_release_hash = release.release_hash
    deploys.games[slug] = entry
    await writeDeploys(dirHandle, deploys)
    onProgress?.({phase: 'releasing', completed: 1, total: 1})
    onProgress?.({phase: 'complete', completed: 1, total: 1})
    return {preview_url: release.preview_url || entry.preview_url, release_hash: release.release_hash}
}

export async function pullProject({
    dirHandle,
    api,
    entry,
}: PullProjectOptions): Promise<{release_hash: string; updated: string[]}> {
    const deploys = await readDeploys(dirHandle)
    const slug = findDeploySlug(deploys, entry)
    if (!slug) throw new Error('The deploy entry is not present in .blitz/deploys.json.')
    api.useGame(entry.game_id, entry.deploy_token)
    const game = await api.getGame(entry.game_id)
    if (!game.active_release) throw new Error('The game does not have an active release to pull.')
    const release = await api.getRelease(game.active_release)
    const updated: string[] = []
    for (const path of Object.keys(release.files).sort()) {
        if (path === 'index.html' || path.startsWith('_blitz/')) continue
        const local = await readProjectFile(dirHandle, path)
        if (local && await sha256(local) === release.files[path].sha256) continue
        const blob = await api.downloadBlob(release.files[path].sha256)
        await writeProjectFile(dirHandle, path, blob)
        updated.push(path)
    }
    entry.last_release_hash = release.release_hash
    deploys.games[slug] = {...deploys.games[slug], last_release_hash: release.release_hash}
    await writeDeploys(dirHandle, deploys)
    return {release_hash: release.release_hash, updated}
}

function parsePackageJson(text: string): Record<string, unknown> {
    const value: unknown = JSON.parse(text)
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('package.json must contain an object.')
    }
    return value as Record<string, unknown>
}

function ensureRuntimeVersion(packageJson: Record<string, unknown>): {
    packageJson: Record<string, unknown>
    version: string
    changed: boolean
} {
    const rawBlitz = packageJson.blitz
    if (rawBlitz !== undefined && (!rawBlitz || typeof rawBlitz !== 'object' || Array.isArray(rawBlitz))) {
        throw new Error('package.json blitz must be an object.')
    }
    const blitz = rawBlitz ? {...rawBlitz as Record<string, unknown>} : {}
    if (blitz.version !== undefined && typeof blitz.version !== 'string') {
        throw new Error('package.json blitz.version must be a string.')
    }
    const changed = !blitz.version
    if (changed) blitz.version = RUNTIME_VERSION
    return {
        packageJson: changed ? {...packageJson, blitz} : packageJson,
        version: blitz.version as string,
        changed,
    }
}

function packageDependencies(packageJson: Record<string, unknown>): ProjectDependency[] {
    const result: ProjectDependency[] = []
    const dependencies = packageJson.dependencies
    if (dependencies && typeof dependencies === 'object' && !Array.isArray(dependencies)) {
        for (const [key, version] of Object.entries(dependencies)) {
            if (typeof version === 'string') result.push({key, version})
        }
    }
    const blitz = packageJson.blitz
    if (blitz && typeof blitz === 'object' && !Array.isArray(blitz)) {
        const imports = (blitz as Record<string, unknown>).imports
        if (imports && typeof imports === 'object' && !Array.isArray(imports)) {
            for (const [key, value] of Object.entries(imports)) {
                if (typeof value !== 'string') continue
                result.push(value.startsWith('@')
                    ? {key, version: value.slice(1)}
                    : {key, version: '', url: value})
            }
        }
    }
    return result
}

function replaceEntry(entries: ProjectEntry[], next: ProjectEntry): ProjectEntry[] {
    return [...entries.filter(({path}) => path !== next.path), next]
        .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
}

function deployEntryFromTarget(target: ExistingDeployTarget): DeployEntry {
    const {slug: _slug, ...entry} = target
    return entry
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

async function uploadWithPool(
    api: PublishApi,
    uploads: Array<ProjectEntry & {hash: string}>,
    onProgress?: (progress: PublishProgress) => void,
): Promise<void> {
    let completed = 0
    let nextIndex = 0
    onProgress?.({phase: 'uploading', completed, total: uploads.length})
    const workers = Array.from({length: Math.min(4, uploads.length)}, async () => {
        while (nextIndex < uploads.length) {
            const upload = uploads[nextIndex]
            nextIndex += 1
            await api.uploadBlob(upload.hash, upload.file)
            completed += 1
            onProgress?.({
                phase: 'uploading',
                completed,
                total: uploads.length,
                path: upload.path,
            })
        }
    })
    await Promise.all(workers)
}
