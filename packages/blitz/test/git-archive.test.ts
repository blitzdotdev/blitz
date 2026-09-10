import {execFile} from 'node:child_process'
import {mkdir, mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import {promisify} from 'node:util'
import {strFromU8, unzipSync} from 'fflate'
import {afterEach, describe, expect, it} from 'vitest'
import {archiveProject} from '../src/archive.ts'
import {initProject} from '../src/commands.ts'
import {checkpointProject, initializeGitRepository, restoreProject} from '../src/git.ts'
import {BLITZ_VERSION} from '../src/versions.ts'

const execute = promisify(execFile)
const cleanup: string[] = []

afterEach(async () => {
    while (cleanup.length) await rm(cleanup.pop()!, {recursive: true, force: true})
})

describe('Git project commands', () => {
    it('initializes Git and commits the template unless --no-git is selected', async () => {
        const root = await temporaryDirectory('blitz-init-git-')
        await initProject(root)
        expect((await execute('git', ['log', '-1', '--format=%s'], {cwd: root})).stdout.trim()).toBe('Initial Blitz project')
        expect((await stat(resolve(root, '.git'))).isDirectory()).toBe(true)

        const noGit = await temporaryDirectory('blitz-init-no-git-')
        await initProject(noGit, {git: false})
        await expect(stat(resolve(noGit, '.git'))).rejects.toMatchObject({code: 'ENOENT'})
    })

    it('creates a nested repository when an existing parent does not track the project', async () => {
        const parent = await temporaryDirectory('blitz-init-parent-')
        await mkdir(resolve(parent, 'project'))
        await writeFile(resolve(parent, 'parent.txt'), 'parent')
        await initializeGitRepository(parent)
        const before = (await execute('git', ['rev-parse', 'HEAD'], {cwd: parent})).stdout.trim()

        await initProject(resolve(parent, 'project'))

        expect((await stat(resolve(parent, 'project/.git'))).isDirectory()).toBe(true)
        expect((await execute('git', ['rev-parse', 'HEAD'], {cwd: parent})).stdout.trim()).toBe(before)
    })

    it('uses a parent repository when it already tracks files under the project', async () => {
        const parent = await temporaryDirectory('blitz-init-tracked-parent-')
        const project = resolve(parent, 'project')
        await mkdir(project)
        await writeFile(resolve(project, '.tracked'), 'tracked by parent')
        await initializeGitRepository(parent)
        const before = (await execute('git', ['rev-parse', 'HEAD'], {cwd: parent})).stdout.trim()

        await initProject(project)

        await expect(stat(resolve(project, '.git'))).rejects.toMatchObject({code: 'ENOENT'})
        expect((await execute('git', ['rev-parse', 'HEAD'], {cwd: parent})).stdout.trim()).toBe(before)
    })

    it('requires an explicit opt-in for checkpoint and restore through a parent repository', async () => {
        const parent = await temporaryDirectory('blitz-checkpoint-parent-')
        const project = resolve(parent, 'project')
        await mkdir(project)
        await writeFile(resolve(project, '.tracked'), 'tracked by parent')
        await initializeGitRepository(parent)
        await initProject(project)

        await expect(checkpointProject(project)).rejects.toThrow('--allow-parent-repo')
        const checkpoint = await checkpointProject(project, 'parent opt-in', {allowParentRepo: true})
        await writeFile(resolve(project, 'main.js'), 'later contents\n')
        await expect(restoreProject(project, checkpoint.hash)).rejects.toThrow('--allow-parent-repo')
        await restoreProject(project, checkpoint.hash, {allowParentRepo: true})

        expect(await readFile(resolve(project, 'main.js'), 'utf8')).not.toBe('later contents\n')
    })

    it('commits all project files with a label and restores an explicit or last checkpoint without moving HEAD', async () => {
        const root = await temporaryDirectory('blitz-checkpoint-')
        await initProject(root)
        const path = resolve(root, 'main.js')
        await writeFile(path, 'checkpoint contents\n')
        const checkpoint = await checkpointProject(root, 'before agent work')
        const head = (await execute('git', ['rev-parse', 'HEAD'], {cwd: root})).stdout.trim()

        await writeFile(path, 'later contents\n')
        expect(await restoreProject(root, checkpoint.hash)).toMatchObject({hash: checkpoint.hash})
        expect(await readFile(path, 'utf8')).toBe('checkpoint contents\n')
        expect((await execute('git', ['rev-parse', 'HEAD'], {cwd: root})).stdout.trim()).toBe(head)

        await writeFile(path, 'later again\n')
        expect(await restoreProject(root)).toMatchObject({hash: checkpoint.hash})
        expect(await readFile(path, 'utf8')).toBe('checkpoint contents\n')
    })

    it('refuses checkpoint outside Git and restore while a publish lock exists', async () => {
        const noGit = await temporaryDirectory('blitz-checkpoint-no-git-')
        await initProject(noGit, {git: false})
        await expect(checkpointProject(noGit)).rejects.toThrow(/blitz init.*git init/i)

        const root = await temporaryDirectory('blitz-restore-lock-')
        await initProject(root)
        await checkpointProject(root)
        await mkdir(resolve(root, '.blitz'), {recursive: true})
        await writeFile(resolve(root, '.blitz/publish.lock'), '{}')
        await expect(restoreProject(root)).rejects.toMatchObject({status: 409, code: 'publish_locked'})
    })
})

describe('blitz archive', () => {
    it('writes a sanitized source ZIP with provenance and publish exclusions', async () => {
        const root = await temporaryDirectory('blitz-archive-')
        await initProject(root)
        const packagePath = resolve(root, 'package.json')
        const packageJson = JSON.parse(await readFile(packagePath, 'utf8'))
        packageJson.name = 'Archive Game'
        packageJson.blitz.publish = {exclude: ['private/**']}
        await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)
        await writeFile(resolve(root, 'public.txt'), 'include me')
        await mkdir(resolve(root, 'private'), {recursive: true})
        await writeFile(resolve(root, 'private/notes.txt'), 'exclude me')
        await mkdir(resolve(root, '.blitz'), {recursive: true})
        await writeFile(resolve(root, '.blitz/deploys.json'), 'secret')
        await mkdir(resolve(root, 'node_modules/@blitzdev/engine'), {recursive: true})
        await writeFile(resolve(root, 'node_modules/@blitzdev/engine/package.json'), JSON.stringify({version: BLITZ_VERSION}))

        const result = await archiveProject(root, {now: new Date('2026-09-10T12:00:00.000Z')})
        const files = unzipSync(new Uint8Array(await readFile(result.path)))
        const paths = Object.keys(files).sort()

        expect(result.path).toBe(resolve(root, 'archive-game-source.zip'))
        expect(paths).toContain('public.txt')
        expect(paths).toContain('BLITZ-PROJECT.txt')
        expect(paths).not.toContain('private/notes.txt')
        expect(paths.some((path) => path.startsWith('node_modules/'))).toBe(false)
        expect(paths.some((path) => path.startsWith('.blitz/'))).toBe(false)
        expect(paths.some((path) => path.startsWith('.git/'))).toBe(false)
        const provenance = strFromU8(files['BLITZ-PROJECT.txt'])
        expect(provenance).toContain('Project: Archive Game')
        expect(provenance).toContain('Created: 2026-09-10T12:00:00.000Z')
        expect(provenance).toMatch(/Git commit: [a-f\d]{40}/)
        expect(provenance).toContain(`@blitzdev/engine: ${BLITZ_VERSION}`)
    })
})

async function temporaryDirectory(prefix: string): Promise<string> {
    const root = await mkdtemp(resolve(tmpdir(), prefix))
    cleanup.push(root)
    return root
}
