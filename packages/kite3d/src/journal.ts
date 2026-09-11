import {appendFile, mkdir, readFile} from 'node:fs/promises'
import {dirname, resolve} from 'node:path'
import {KITE3D_SERVER_CLIENT_ID, JOURNAL_PATH} from '@blitzdev/engine/paths'
import {diffSceneGltfText, type SceneDiff} from './scene-diff.ts'

export interface JournalEntry {
    ts: string
    client: string
    summary: SceneDiff | UpgradeSummary
}

export interface UpgradeSummary {
    upgrade: {from: string, to: string}
}

export interface ReadJournalOptions {
    since?: string
    limit?: number
}

export async function appendSceneJournal(
    projectRoot: string,
    beforeText: string | undefined,
    afterText: string,
    client = KITE3D_SERVER_CLIENT_ID,
    ts = new Date().toISOString(),
): Promise<JournalEntry | undefined> {
    const summary = diffSceneGltfText(beforeText, afterText)
    if (sceneDiffIsEmpty(summary)) return undefined
    return appendJournalEntry(projectRoot, client, summary, ts)
}

function sceneDiffIsEmpty(diff: SceneDiff): boolean {
    return !diff.errors?.length
        && diff.nodesAdded.length === 0
        && diff.nodesRemoved.length === 0
        && diff.nodesRenamed.length === 0
        && diff.transforms.length === 0
        && diff.components.length === 0
        && diff.materials.length === 0
}

export async function appendJournalEntry(
    projectRoot: string,
    client: string,
    summary: JournalEntry['summary'],
    ts = new Date().toISOString(),
): Promise<JournalEntry> {
    const entry: JournalEntry = {ts, client, summary}
    const path = resolve(projectRoot, JOURNAL_PATH)
    await mkdir(dirname(path), {recursive: true})
    await appendFile(path, `${JSON.stringify(entry)}\n`, 'utf8')
    return entry
}

export async function readJournal(projectRoot: string, options: ReadJournalOptions = {}): Promise<JournalEntry[]> {
    let text = ''
    try { text = await readFile(resolve(projectRoot, JOURNAL_PATH), 'utf8') } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
        throw error
    }
    let entries = text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as JournalEntry)
    if (options.since) {
        const since = Date.parse(options.since)
        if (!Number.isFinite(since)) throw new Error(`Invalid journal date: ${options.since}`)
        entries = entries.filter(({ts}) => Date.parse(ts) >= since)
    }
    if (options.limit !== undefined) {
        if (!Number.isInteger(options.limit) || options.limit < 0) throw new Error('Journal limit must be a non-negative integer')
        entries = entries.slice(-options.limit)
    }
    return entries
}
