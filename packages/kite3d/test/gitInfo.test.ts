import {execFile} from 'node:child_process'
import {mkdir, mkdtemp, realpath, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import {promisify} from 'node:util'
import {afterEach, describe, expect, it} from 'vitest'
import {branch, repoKey, repoRoot, worktrees} from '../src/gitInfo.ts'

const executeFile = promisify(execFile)
const cleanup: string[] = []

afterEach(async () => {
    while (cleanup.length) await rm(cleanup.pop()!, {recursive: true, force: true})
})

describe('git facts', () => {
    it('groups a repository and its worktree under one key, including paths with spaces', async () => {
        const parent = await mkdtemp(resolve(tmpdir(), 'kite3d-git-info-'))
        cleanup.push(parent)
        const main = resolve(parent, 'main project')
        const linked = resolve(parent, 'linked worktree')
        await executeFile('git', ['init', '-q', '-b', 'main', main])
        await writeFile(resolve(main, 'file.txt'), 'first\n')
        await executeFile('git', ['-C', main, 'add', 'file.txt'])
        await executeFile('git', ['-C', main, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'initial'])
        await executeFile('git', ['-C', main, 'worktree', 'add', '-qb', 'feature', linked])
        const canonicalMain = await realpath(main)
        const canonicalLinked = await realpath(linked)

        expect(await repoRoot(main)).toBe(canonicalMain)
        expect(await repoRoot(linked)).toBe(canonicalLinked)
        expect(await repoKey(linked)).toBe(await repoKey(main))
        expect(await branch(main)).toBe('main')
        expect(await branch(linked)).toBe('feature')
        const listed = await worktrees(linked)
        expect(listed?.map(({path}) => path)).toEqual([canonicalMain, canonicalLinked])
        expect(listed).toEqual([
            {path: canonicalMain, branch: 'main', head: expect.stringMatching(/^[a-f\d]{40}$/)},
            {path: canonicalLinked, branch: 'feature', head: expect.stringMatching(/^[a-f\d]{40}$/)},
        ])
    })

    it('returns null outside a Git repository', async () => {
        const folder = await mkdtemp(resolve(tmpdir(), 'kite3d-no-git-'))
        cleanup.push(folder)
        await mkdir(resolve(folder, 'child'))
        expect(await repoRoot(folder)).toBeNull()
        expect(await repoKey(folder)).toBeNull()
        expect(await branch(folder)).toBeNull()
        expect(await worktrees(folder)).toBeNull()
    })
})
