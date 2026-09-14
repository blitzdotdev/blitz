import {execFile} from 'node:child_process'
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import {promisify} from 'node:util'
import {afterEach, expect, it} from 'vitest'
import {startMockBackend} from './mockBackend.ts'
import {KITE3D_VERSION} from '../src/versions.ts'

const execute = promisify(execFile)

const cli = resolve('dist/cli.js')

const cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
    while (cleanup.length) await cleanup.pop()!()
})

// Guards the owner's security report: failed publish output exposed deploy tokens and claim secrets.
it('never prints deploy tokens or claim secrets from a failed publish', async () => {
        const deployToken = 'tp_diagnostic-game'
        const claimSecret = 'secret_diagnostic-game'
        const backend = await startMockBackend({
            releaseStatuses: [400],
            failureMessage: `failure included ${deployToken} and ${claimSecret}`,
        })
        cleanup.push(() => backend.close())
        const root = await mkdtemp(resolve(tmpdir(), 'kite3d-cli-redaction-'))
        cleanup.push(() => rm(root, {recursive: true, force: true}))
        await execute(process.execPath, [cli, 'init', root])
        await installEngine(root, KITE3D_VERSION)

        let output = ''
        try {
            await execute(process.execPath, [
                cli, 'publish', '--slug', 'diagnostic-game', '--no-verify',
            ], {cwd: root, env: {...process.env, BLITZ_BACKEND_URL: backend.url}})
        } catch (error) {
            const result = error as {stdout?: string, stderr?: string}
            output = `${result.stdout || ''}\n${result.stderr || ''}`
        }

        expect(output).toContain('[redacted]')
        expect(output).not.toContain('tp_')
        expect(output).not.toContain(claimSecret)
    })

async function installEngine(root: string, version: string): Promise<void> {
    const packageDirectory = resolve(root, 'node_modules/@kite3d/engine')
    await mkdir(resolve(packageDirectory, 'dist'), {recursive: true})
    await writeFile(resolve(packageDirectory, 'package.json'), JSON.stringify({version}))
    await writeFile(resolve(packageDirectory, 'dist/runtime.js'), 'installed test runtime')
}
