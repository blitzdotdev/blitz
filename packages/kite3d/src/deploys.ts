import {readProjectFile, writeProjectFile} from './filesystem.ts'
import type {DeployEntry, DeploysFile, PublishStatus} from './types.ts'

export const DEPLOYS_PATH = '.kite3d/deploys.json'

export async function readDeploys(dirHandle: FileSystemDirectoryHandle): Promise<DeploysFile> {
    const file = await readProjectFile(dirHandle, DEPLOYS_PATH)
    if (!file) return {games: {}}
    let value: unknown
    try {
        value = JSON.parse(await file.text())
    } catch {
        throw new Error(`${DEPLOYS_PATH} is not valid JSON.`)
    }
    if (!isRecord(value) || !isRecord(value.games)) {
        throw new Error(`${DEPLOYS_PATH} must contain a games object.`)
    }
    const games: Record<string, DeployEntry> = {}
    for (const [slug, entry] of Object.entries(value.games)) {
        if (!isDeployEntry(entry)) throw new Error(`${DEPLOYS_PATH} has an invalid entry for ${slug}.`)
        games[slug] = {...entry}
    }
    if (value.last_publish !== undefined && !isPublishStatus(value.last_publish)) {
        throw new Error(`${DEPLOYS_PATH} has an invalid last_publish value.`)
    }
    return {games, ...(value.last_publish ? {last_publish: {...value.last_publish}} : {})}
}

export async function writeDeploys(
    dirHandle: FileSystemDirectoryHandle,
    deploys: DeploysFile,
): Promise<void> {
    await writeProjectFile(dirHandle, DEPLOYS_PATH, `${JSON.stringify(deploys, null, 2)}\n`)
}

export function findDeploySlug(deploys: DeploysFile, entry: DeployEntry): string | undefined {
    return Object.entries(deploys.games).find(([, candidate]) =>
        candidate.game_id === entry.game_id && candidate.deploy_token === entry.deploy_token
    )?.[0]
}

function isDeployEntry(value: unknown): value is DeployEntry {
    if (!isRecord(value)) return false
    return ['game_id', 'deploy_token', 'claim_secret', 'preview_url', 'expires_at']
        .every((key) => typeof value[key] === 'string')
        && (value.claim_url === undefined || typeof value.claim_url === 'string')
        && (value.last_release_hash === undefined || typeof value.last_release_hash === 'string')
        && (value.claimed === undefined || typeof value.claimed === 'boolean')
}

function isPublishStatus(value: unknown): value is PublishStatus {
    if (!isRecord(value)) return false
    return typeof value.slug === 'string'
        && ['publishing', 'succeeded', 'failed'].includes(String(value.status))
        && typeof value.updated_at === 'string'
        && (value.release_hash === undefined || typeof value.release_hash === 'string')
        && (value.error === undefined || typeof value.error === 'string')
        && (value.error_status === undefined || typeof value.error_status === 'number')
        && (value.error_code === undefined || typeof value.error_code === 'string')
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
