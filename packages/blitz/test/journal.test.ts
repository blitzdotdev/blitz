import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {appendSceneJournal, readJournal} from '../src/journal.ts'

const roots: string[] = []

afterEach(async () => {
    while (roots.length) await rm(roots.pop()!, {recursive: true, force: true})
})

describe('scene journal', () => {
    it('appends JSONL and filters by date and count', async () => {
        const root = await mkdtemp(resolve(tmpdir(), 'blitz-journal-'))
        roots.push(root)
        await appendSceneJournal(root, '{}', '{"nodes":[{"name":"One"}]}', 'editor-a', '2026-09-09T10:00:00.000Z')
        await appendSceneJournal(root, '{}', '{"nodes":[{"name":"Two"}]}', 'external', '2026-09-09T11:00:00.000Z')

        expect(await readJournal(root, {limit: 1})).toMatchObject([{client: 'external'}])
        expect(await readJournal(root, {since: '2026-09-09T10:30:00.000Z'})).toHaveLength(1)
    })

    it('does not append an entry for an empty semantic summary', async () => {
        const root = await mkdtemp(resolve(tmpdir(), 'blitz-journal-empty-'))
        roots.push(root)
        const before = '{"nodes":[{"name":"Node","extras":{"EntityComponentPlugin":{"id":{"type":"Test","state":{"a":1,"b":2}}}}}]}'
        const after = '{"nodes":[{"name":"Node","extras":{"EntityComponentPlugin":{"id":{"state":{"b":2,"a":1},"type":"Test"}}}}]}'

        expect(await appendSceneJournal(root, before, after)).toBeUndefined()
        await expect(readFile(resolve(root, '.blitz/journal.jsonl'), 'utf8')).rejects.toMatchObject({code: 'ENOENT'})
    })
})
