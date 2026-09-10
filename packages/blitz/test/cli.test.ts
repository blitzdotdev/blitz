import {execFile} from 'node:child_process'
import {chmod, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import {promisify} from 'node:util'
import {afterEach, describe, expect, it} from 'vitest'
import {startMockBackend} from './mockBackend.ts'
import {BLITZ_VERSION} from '../src/versions.ts'
import {initializeGitRepository} from '../src/git.ts'

const execute = promisify(execFile)
const cli = resolve('dist/cli.js')
const cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
    while (cleanup.length) await cleanup.pop()!()
})

describe('blitz CLI', () => {
    it.each(['dev', 'check', 'publish', 'doctor', 'checkpoint', 'restore', 'archive', 'status'])(
        'refuses %s outside a Blitz project root',
        async (command) => {
            const emptyRoot = await mkdtemp(resolve(tmpdir(), 'blitz-cli-empty-root-'))
            cleanup.push(() => rm(emptyRoot, {recursive: true, force: true}))
            const packageOnlyRoot = await mkdtemp(resolve(tmpdir(), 'blitz-cli-package-only-root-'))
            cleanup.push(() => rm(packageOnlyRoot, {recursive: true, force: true}))
            await writeFile(resolve(packageOnlyRoot, 'package.json'), JSON.stringify({
                devDependencies: {'@blitzdev/blitz': BLITZ_VERSION},
            }))

            const run = (cwd: string) => execute(process.execPath, [cli, command, ...(command === 'dev' ? ['--no-open'] : [])], {
                cwd,
                timeout: 5_000,
            })
            const [emptyResult, packageOnlyResult] = await Promise.all([
                run(emptyRoot).catch((error: unknown) => error),
                run(packageOnlyRoot).catch((error: unknown) => error),
            ])

            expect(emptyResult).toMatchObject({
                code: 1,
                stderr: expect.stringContaining(
                    'missing package.json with an @blitzdev/blitz dependency and assets/main.scene.gltf',
                ),
            })
            expect(packageOnlyResult).toMatchObject({
                code: 1,
                stderr: expect.stringContaining('missing assets/main.scene.gltf'),
            })
            for (const result of [emptyResult, packageOnlyResult] as Array<{stderr: string}>) {
                expect(result.stderr).toContain('cd into a Blitz project or run blitz init')
            }
        },
    )

    it('prints command-specific help without performing the command', async () => {
        const commands = [
            'init', 'dev', 'doctor', 'checkpoint', 'restore', 'archive', 'publish', 'pull', 'status', 'claim',
            'bake', 'check', 'journal', 'open', 'sources', 'upgrade',
        ]
        const results = await Promise.all(commands.map(async (command) => ({
            command,
            result: await execute(process.execPath, [cli, command, '--help']),
        })))
        for (const {command, result} of results) {
            expect(result.stdout).toContain(`Usage: blitz ${command}`)
            expect(result.stderr).toBe('')
        }
    })

    it('prints its package version without applying the project version rule', async () => {
        const result = await execute(process.execPath, [cli, '--version'])
        expect(result.stdout.trim()).toBe(BLITZ_VERSION)
    })

    it('supports init --no-git', async () => {
        const root = await mkdtemp(resolve(tmpdir(), 'blitz-cli-no-git-'))
        cleanup.push(() => rm(root, {recursive: true, force: true}))

        const result = await execute(process.execPath, [cli, 'init', root, '--no-git'])

        await expect(readFile(resolve(root, '.git/HEAD'), 'utf8')).rejects.toMatchObject({code: 'ENOENT'})
        expect(result.stdout).toContain('Git repository: skipped (--no-git)')
    })

    it('prints a tracked parent decision and requires opt-in for its checkpoints', async () => {
        const parent = await mkdtemp(resolve(tmpdir(), 'blitz-cli-parent-git-'))
        cleanup.push(() => rm(parent, {recursive: true, force: true}))
        const root = resolve(parent, 'project')
        await mkdir(root)
        await writeFile(resolve(root, '.tracked'), 'tracked by parent')
        await initializeGitRepository(parent)

        const initialized = await execute(process.execPath, [cli, 'init', root])
        expect(initialized.stdout).toContain('Git repository: tracked parent repository at ')
        await expect(readFile(resolve(root, '.git/HEAD'), 'utf8')).rejects.toMatchObject({code: 'ENOENT'})

        await expect(execute(process.execPath, [cli, 'checkpoint'], {cwd: root}))
            .rejects.toMatchObject({code: 1, stderr: expect.stringContaining('--allow-parent-repo')})
        const checkpoint = await execute(process.execPath, [cli, 'checkpoint', '--allow-parent-repo'], {cwd: root})
        expect(checkpoint.stdout).toMatch(/^Checkpoint [a-f\d]+/m)
        await writeFile(resolve(root, 'main.js'), 'changed after parent checkpoint\n')
        await expect(execute(process.execPath, [cli, 'restore'], {cwd: root}))
            .rejects.toMatchObject({code: 1, stderr: expect.stringContaining('--allow-parent-repo')})
        await execute(process.execPath, [cli, 'restore', '--allow-parent-repo'], {cwd: root})
        expect(await readFile(resolve(root, 'main.js'), 'utf8')).not.toBe('changed after parent checkpoint\n')
    })

    it('runs doctor itself so a version mismatch is reported as a row', async () => {
        const root = await pinnedProject('9.9.9')
        await expect(execute(process.execPath, [cli, 'doctor', '--port', '0'], {
            cwd: root,
            env: {...process.env, BLITZ_BACKEND_URL: 'http://127.0.0.1:1'},
        })).rejects.toMatchObject({
            code: 1,
            stdout: expect.stringMatching(/version-pin\s+FAIL\s+Project resolves to 9\.9\.9/),
            stderr: expect.not.stringContaining('delegating'),
        })
    })

    it('checkpoints, restores, and archives through the CLI', async () => {
        const root = await mkdtemp(resolve(tmpdir(), 'blitz-cli-conveniences-'))
        cleanup.push(() => rm(root, {recursive: true, force: true}))
        await execute(process.execPath, [cli, 'init', root])
        const mainPath = resolve(root, 'main.js')
        await writeFile(mainPath, 'checkpoint version\n')

        const checkpoint = await execute(process.execPath, [cli, 'checkpoint', 'before agent'], {cwd: root})
        expect(checkpoint.stdout).toMatch(/^Checkpoint [a-f\d]+ before agent/m)
        await writeFile(mainPath, 'later version\n')
        const restore = await execute(process.execPath, [cli, 'restore'], {cwd: root})
        expect(restore.stdout).toMatch(/^Restored checkpoint [a-f\d]+/m)
        expect(await readFile(mainPath, 'utf8')).toBe('checkpoint version\n')

        const archive = await execute(process.execPath, [cli, 'archive'], {cwd: root})
        const archivePath = resolve(root, `${root.split('/').at(-1)!.toLowerCase()}-source.zip`)
        expect(archive.stdout).toContain(archivePath)
        expect((await readFile(archivePath)).byteLength).toBeGreaterThan(0)
    })

    it('rejects unknown flags with a clear message and nonzero exit code', async () => {
        await expect(execute(process.execPath, [cli, 'publish', '--bogus']))
            .rejects.toMatchObject({code: 1, stderr: expect.stringContaining('Unknown flag: --bogus')})
    })

    it('publishes the explicit slug, name, and message', async () => {
        const backend = await startMockBackend({
            previewUrl: (slug, response) => response === 'release'
                ? `https://${slug}.app.blitz.dev/`
                : `https://gateway.example/${slug}/`,
        })
        cleanup.push(() => backend.close())
        const root = await mkdtemp(resolve(tmpdir(), 'blitz-cli-'))
        cleanup.push(() => rm(root, {recursive: true, force: true}))
        await execute(process.execPath, [cli, 'init', root])
        await installEngine(root, BLITZ_VERSION)

        const result = await execute(process.execPath, [
            cli,
            'publish',
            '--slug', 'agent-picked-slug',
            '--name', 'Agent Picked Name',
            '--message', 'agent release',
            '--no-check',
            '--no-verify',
        ], {cwd: root, env: {...process.env, BLITZ_BACKEND_URL: backend.url}})

        expect(result.stdout.trim().split('\n').at(-1)).toBe('https://agent-picked-slug.app.blitz.dev/')
        expect(backend.games.get('agent-picked-slug')?.name).toBe('Agent Picked Name')
        expect(backend.requests.find(({path}) => path.endsWith('/releases'))?.body).toMatchObject({message: 'agent release'})
        const deploys = JSON.parse(await readFile(resolve(root, '.blitz/deploys.json'), 'utf8')) as {
            games: Record<string, {preview_url?: string}>
        }
        expect(deploys.games['agent-picked-slug'].preview_url).toBe('https://agent-picked-slug.app.blitz.dev/')
    })

    it('never prints deploy tokens or claim secrets from a failed publish', async () => {
        const deployToken = 'tp_diagnostic-game'
        const claimSecret = 'secret_diagnostic-game'
        const backend = await startMockBackend({
            releaseStatuses: [400],
            failureMessage: `failure included ${deployToken} and ${claimSecret}`,
        })
        cleanup.push(() => backend.close())
        const root = await mkdtemp(resolve(tmpdir(), 'blitz-cli-redaction-'))
        cleanup.push(() => rm(root, {recursive: true, force: true}))
        await execute(process.execPath, [cli, 'init', root])
        await installEngine(root, BLITZ_VERSION)

        let output = ''
        try {
            await execute(process.execPath, [
                cli, 'publish', '--slug', 'diagnostic-game', '--no-check', '--no-verify',
            ], {cwd: root, env: {...process.env, BLITZ_BACKEND_URL: backend.url}})
        } catch (error) {
            const result = error as {stdout?: string, stderr?: string}
            output = `${result.stdout || ''}\n${result.stderr || ''}`
        }

        expect(output).toContain('[redacted]')
        expect(output).not.toContain('tp_')
        expect(output).not.toContain(claimSecret)
    })

    it('delegates a mismatch to the installed pinned binary with the same arguments', async () => {
        const root = await pinnedProject('9.9.9')
        const binDirectory = resolve(root, 'node_modules/.bin')
        await mkdir(binDirectory, {recursive: true})
        const fakeBin = resolve(binDirectory, 'blitz')
        await writeFile(fakeBin, '#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv.slice(2)))\n')
        await chmod(fakeBin, 0o755)

        const result = await execute(process.execPath, [cli, 'status'], {cwd: root})

        expect(result.stderr).toContain(`Blitz ${BLITZ_VERSION} does not match project version 9.9.9; delegating`)
        expect(JSON.parse(result.stdout.trim())).toEqual(['status'])
    })

    it.each(['file:../../blitz-packs/blitzdev-blitz.tgz', '^0.12.0'])(
        'resolves a %s spec from the installed package version',
        async (spec) => {
            const root = await pinnedProject(spec)
            await installPackageVersion(root, BLITZ_VERSION)

            const result = await execute(process.execPath, [cli, 'status'], {cwd: root})

            expect(result.stdout).toContain('No deploys')
            expect(result.stderr).toBe('')
        },
    )

    it('delegates a non-exact spec when the installed package has a different version', async () => {
        const root = await pinnedProject('file:../../blitz-packs/blitzdev-blitz.tgz')
        await installPackageVersion(root, '9.9.9')
        const binDirectory = resolve(root, 'node_modules/.bin')
        await mkdir(binDirectory, {recursive: true})
        const fakeBin = resolve(binDirectory, 'blitz')
        await writeFile(fakeBin, '#!/usr/bin/env node\nconsole.log("delegated file pin")\n')
        await chmod(fakeBin, 0o755)

        const result = await execute(process.execPath, [cli, 'status'], {cwd: root})

        expect(result.stderr).toContain(`does not match project version 9.9.9; delegating`)
        expect(result.stdout).toContain('delegated file pin')
    })

    it('accepts an exact version spec without requiring an installed package', async () => {
        const root = await pinnedProject(BLITZ_VERSION)

        const result = await execute(process.execPath, [cli, 'status'], {cwd: root})

        expect(result.stdout).toContain('No deploys')
        expect(result.stderr).toBe('')
    })

    it('refuses a non-exact spec with an npm install hint when no package is installed', async () => {
        const root = await pinnedProject('file:../../blitz-packs/blitzdev-blitz.tgz')

        await expect(execute(process.execPath, [cli, 'status'], {cwd: root}))
            .rejects.toMatchObject({
                code: 1,
                stderr: expect.stringContaining('it is not installed. Run npm install before blitz status'),
            })
    })

    it('refuses a mismatch when the pinned binary is not installed', async () => {
        const root = await pinnedProject('9.9.8')
        await expect(execute(process.execPath, [cli, 'status'], {cwd: root}))
            .rejects.toMatchObject({
                code: 1,
                stderr: expect.stringContaining('Run npm install, or npx @blitzdev/blitz@9.9.8 status'),
            })
    })

    it('exits successfully when there is nothing to pull before the first publish', async () => {
        const root = await pinnedProject(BLITZ_VERSION)

        const result = await execute(process.execPath, [cli, 'pull'], {cwd: root})

        expect(result.stdout).toContain('There is nothing to pull before the first publish')
        expect(result.stderr).toBe('')
    })

    it('prints the check table, records failures, and exits nonzero', async () => {
        const root = await mkdtemp(resolve(tmpdir(), 'blitz-cli-check-'))
        cleanup.push(() => rm(root, {recursive: true, force: true}))
        await execute(process.execPath, [cli, 'init', root])
        const packagePath = resolve(root, 'package.json')
        const packageJson = JSON.parse(await readFile(packagePath, 'utf8'))
        packageJson.blitz.scripts = ['./Missing.script.js']
        await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)

        await expect(execute(process.execPath, [cli, 'check'], {cwd: root})).rejects.toMatchObject({
            code: 1,
            stdout: expect.stringMatching(/KIND\s+STATUS\s+PATH\s+DETAIL[\s\S]*script\s+FAIL\s+\.\/Missing\.script\.js\s+file not found/),
        })
        expect(JSON.parse(await readFile(resolve(root, '.blitz/check.json'), 'utf8'))).toMatchObject({ok: false})
    })

    it('prints a live project dev server without exposing its token', async () => {
        const root = await pinnedProject(BLITZ_VERSION)
        await mkdir(resolve(root, '.blitz'), {recursive: true})
        await writeFile(resolve(root, '.blitz/dev.json'), JSON.stringify({
            pid: process.pid,
            port: 4567,
            url: 'http://127.0.0.1:4567/?t=very-secret',
            token: 'very-secret',
            started_at: new Date(Date.now() - 5_000).toISOString(),
        }))

        const result = await execute(process.execPath, [cli, 'status'], {cwd: root})

        expect(result.stdout).toMatch(new RegExp(`Dev server: pid ${process.pid}, port 4567, age \\d+s, http://127\\.0\\.0\\.1:4567/`))
        expect(result.stdout).not.toContain('very-secret')
    })

    it('bypasses the project version rule for development', async () => {
        const root = await pinnedProject('9.9.7')
        const result = await execute(process.execPath, [cli, 'status'], {
            cwd: root,
            env: {...process.env, BLITZ_IGNORE_VERSION_PIN: '1'},
        })
        expect(result.stdout).toContain('No deploys')
    })

    it('publishes with the project pin when the development bypass is set', async () => {
        const pinned = '9.8.7'
        const backend = await startMockBackend({runtimeVersions: [pinned]})
        cleanup.push(() => backend.close())
        const root = await mkdtemp(resolve(tmpdir(), 'blitz-cli-publish-pin-'))
        cleanup.push(() => rm(root, {recursive: true, force: true}))
        await execute(process.execPath, [cli, 'init', root])
        await installEngine(root, pinned)
        const packagePath = resolve(root, 'package.json')
        const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as {
            devDependencies: Record<string, string>, blitz: {version: string}
        }
        packageJson.devDependencies['@blitzdev/blitz'] = pinned
        packageJson.blitz.version = '1.2.3'
        await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)

        await execute(process.execPath, [cli, 'publish', '--slug', 'pinned-publish', '--no-check'], {
            cwd: root,
            env: {...process.env, BLITZ_BACKEND_URL: backend.url, BLITZ_IGNORE_VERSION_PIN: '1'},
        })

        expect(backend.requests.map(({path}) => path)).toContain(`/api/v1/runtimes/${pinned}`)
        expect(JSON.parse(await readFile(packagePath, 'utf8')).blitz.version).toBe(pinned)
    })
})

async function pinnedProject(version: string): Promise<string> {
    const root = await mkdtemp(resolve(tmpdir(), 'blitz-cli-pin-'))
    cleanup.push(() => rm(root, {recursive: true, force: true}))
    await mkdir(resolve(root, 'assets'), {recursive: true})
    await writeFile(resolve(root, 'assets/main.scene.gltf'), '{}')
    await writeFile(resolve(root, 'package.json'), JSON.stringify({
        name: 'pin-test',
        devDependencies: {'@blitzdev/blitz': version},
        blitz: {version},
    }))
    return root
}

async function installPackageVersion(root: string, version: string): Promise<void> {
    const packageDirectory = resolve(root, 'node_modules/@blitzdev/blitz')
    await mkdir(packageDirectory, {recursive: true})
    await writeFile(resolve(packageDirectory, 'package.json'), JSON.stringify({version}))
}

async function installEngine(root: string, version: string): Promise<void> {
    const packageDirectory = resolve(root, 'node_modules/@blitzdev/engine')
    await mkdir(resolve(packageDirectory, 'dist'), {recursive: true})
    await writeFile(resolve(packageDirectory, 'package.json'), JSON.stringify({version}))
    await writeFile(resolve(packageDirectory, 'dist/runtime.js'), 'installed test runtime')
}
