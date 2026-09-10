import {execFile} from 'node:child_process'
import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import {promisify} from 'node:util'
import {afterEach, describe, expect, it} from 'vitest'
import {startMockBackend} from './mockBackend.ts'

const execute = promisify(execFile)
const cli = resolve('dist/cli.js')
const cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
    while (cleanup.length) await cleanup.pop()!()
})

describe('blitz CLI', () => {
    it('prints command-specific help without performing the command', async () => {
        for (const command of ['init', 'dev', 'publish', 'pull', 'status', 'claim', 'bake', 'journal', 'open', 'sources']) {
            const result = await execute(process.execPath, [cli, command, '--help'])
            expect(result.stdout).toContain(`Usage: blitz ${command}`)
            expect(result.stderr).toBe('')
        }
    })

    it('rejects unknown flags with a clear message and nonzero exit code', async () => {
        await expect(execute(process.execPath, [cli, 'publish', '--bogus']))
            .rejects.toMatchObject({code: 1, stderr: expect.stringContaining('Unknown flag: --bogus')})
    })

    it('publishes the explicit slug, name, and message', async () => {
        const backend = await startMockBackend()
        cleanup.push(() => backend.close())
        const root = await mkdtemp(resolve(tmpdir(), 'blitz-cli-'))
        cleanup.push(() => rm(root, {recursive: true, force: true}))
        await execute(process.execPath, [cli, 'init', root])

        const result = await execute(process.execPath, [
            cli,
            'publish',
            '--slug', 'agent-picked-slug',
            '--name', 'Agent Picked Name',
            '--message', 'agent release',
        ], {cwd: root, env: {...process.env, BLITZ_BACKEND_URL: backend.url}})

        expect(result.stdout).toContain(`${backend.url}/preview/agent-picked-slug/`)
        expect(backend.games.get('agent-picked-slug')?.name).toBe('Agent Picked Name')
        expect(backend.requests.find(({path}) => path.endsWith('/releases'))?.body).toMatchObject({message: 'agent release'})
        const deploys = JSON.parse(await readFile(resolve(root, '.blitz/deploys.json'), 'utf8')) as {games: Record<string, unknown>}
        expect(deploys.games).toHaveProperty('agent-picked-slug')
    })
})
