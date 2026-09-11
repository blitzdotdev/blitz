import {execFile, spawn} from 'node:child_process'
import {chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile} from 'node:fs/promises'
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
const workflow = `Blitz ${BLITZ_VERSION} builds browser 3D games with an agent and a local editor.
Workflow:
  npx @blitzdev/blitz init my-game && cd my-game && npm install
  Read AGENTS.md in the project. It is the guide: engine API, scene file, rules.
  npx blitz dev        keeps the local editor running while you edit
  npx blitz check      run it and fix every failure before you publish
  npx blitz publish    prints the live URL`

const rootUsage = `${workflow}

Usage: blitz <command> [options]

Commands:
  init [dir] [--no-git]       Create a Blitz project and Git repository
  dev [--port <port>]         Start the local editor
  doctor [--port <port>]      Check the local development prerequisites
  checkpoint [label]          Commit a project checkpoint
  restore [hash]              Restore files from a checkpoint
  archive                     Write a sanitized project source ZIP
  publish [options]           Publish the project
  pull [--force]              Pull the active release
  status                      Show local deploy status
  claim --email <email> --password <password> [--login]
                              Register or sign in, then claim local deploys
  bake <nodeName> [--force]   Bake a Generator node
  check                       Check Playable, Editable, and Persisted outcomes
  journal [options]           Read the edit journal
  open                        Open the running local editor
  sources                     Locate installed source
  upgrade [--to <x.y.z>]      Upgrade the project Blitz version

Run blitz <command> --help for command usage.`

afterEach(async () => {
    while (cleanup.length) await cleanup.pop()!()
})

describe('blitz CLI', () => {
    it('starts no-argument and root help output with the agent workflow', async () => {
        const results = await Promise.all([
            execute(process.execPath, [cli]),
            execute(process.execPath, [cli, '--help']),
        ])

        expect(workflow.split('\n')).toHaveLength(7)
        for (const result of results) {
            expect(result.stdout.trim()).toBe(rootUsage)
            expect(result.stdout).not.toContain(String.fromCharCode(27))
            expect(result.stderr).toBe('')
        }
    })

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
                expect(result.stderr.trim()).toMatch(/Start with: npx @blitzdev\/blitz init my-game$/)
            }
        },
    )

    it('suggests up to five child Blitz projects when the current folder is not a project', async () => {
        const parent = await mkdtemp(resolve(tmpdir(), 'blitz-cli-project-parent-'))
        cleanup.push(() => rm(parent, {recursive: true, force: true}))
        await writeFile(resolve(parent, 'package.json'), JSON.stringify({
            devDependencies: {'@blitzdev/blitz': BLITZ_VERSION},
        }))
        for (const name of ['game-a', 'game-b', 'game-c', 'game-d', 'game-e', 'game-f']) {
            await writeProjectRoot(resolve(parent, name))
        }

        const result = await execute(process.execPath, [cli, 'dev', '--no-open'], {cwd: parent})
            .catch((error: unknown) => error) as {code: number, stderr: string}

        expect(result.code).toBe(1)
        expect(result.stderr).toContain('This folder is not a Blitz project: missing assets/main.scene.gltf')
        for (const name of ['game-a', 'game-b', 'game-c', 'game-d', 'game-e']) {
            expect(result.stderr).toContain(`cd ${name} && npx blitz dev`)
        }
        expect(result.stderr).not.toContain('cd game-f && npx blitz dev')
        expect(result.stderr.match(/cd game-[a-z] && npx blitz dev/g)).toHaveLength(5)
    })

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
        expect(result.stdout.trim().split('\n').at(-1)).toBe(
            'Then read AGENTS.md in the project before you write code. '
            + 'Build, run npx blitz check, then npx blitz publish.',
        )
    })

    it('recognizes an existing Blitz project without touching its files', async () => {
        const parent = await mkdtemp(resolve(tmpdir(), 'blitz-cli-existing-project-'))
        cleanup.push(() => rm(parent, {recursive: true, force: true}))
        const root = resolve(parent, 'my-review')
        await execute(process.execPath, [cli, 'init', 'my-review', '--no-git'], {cwd: parent})
        const instructionsPath = resolve(root, 'AGENTS.md')
        const packagePath = resolve(root, 'package.json')
        await writeFile(instructionsPath, 'keep this existing guide\n')
        const before = {
            instructions: await stat(instructionsPath),
            package: await stat(packagePath),
            packageText: await readFile(packagePath, 'utf8'),
        }

        const result = await execute(process.execPath, [cli, 'init', 'my-review'], {cwd: parent})

        expect(result.stdout.trim()).toBe(
            'my-review is already a Blitz project. Next: cd my-review && npx blitz dev',
        )
        expect(result.stderr).toBe('')
        expect(await readFile(instructionsPath, 'utf8')).toBe('keep this existing guide\n')
        expect(await readFile(packagePath, 'utf8')).toBe(before.packageText)
        expect((await stat(instructionsPath)).mtimeMs).toBe(before.instructions.mtimeMs)
        expect((await stat(packagePath)).mtimeMs).toBe(before.package.mtimeMs)
    })

    it('still refuses to overwrite an unrelated populated directory', async () => {
        const parent = await mkdtemp(resolve(tmpdir(), 'blitz-cli-unrelated-directory-'))
        cleanup.push(() => rm(parent, {recursive: true, force: true}))
        await mkdir(resolve(parent, 'my-review'))
        await writeFile(resolve(parent, 'my-review/AGENTS.md'), 'unrelated file\n')

        await expect(execute(process.execPath, [cli, 'init', 'my-review', '--no-git'], {cwd: parent}))
            .rejects.toMatchObject({
                code: 1,
                stderr: expect.stringContaining('Refusing to overwrite existing file: my-review/AGENTS.md'),
            })
    })

    it('prints the guide, verification, and publish loop when dev starts', async () => {
        const root = await mkdtemp(resolve(tmpdir(), 'blitz-cli-dev-guide-'))
        cleanup.push(() => rm(root, {recursive: true, force: true}))
        await execute(process.execPath, [cli, 'init', root, '--no-git'])
        const canonicalRoot = await realpath(root)

        const result = await captureDevStartup(root)
        const lines = result.stdout.trim().split('\n')

        expect(result.stderr).toBe('')
        expect(lines[0]).toMatch(new RegExp(` \\(Blitz ${BLITZ_VERSION.replaceAll('.', '\\.')}\\)$`))
        expect(lines.at(-3)).toMatch(/^Blitz editor: http:\/\/127\.0\.0\.1:\d+\/\?t=/)
        expect(lines.at(-2)).toBe(`Project: ${canonicalRoot}`)
        expect(lines.at(-1)).toBe(
            'Guide: AGENTS.md in this folder. Verify with npx blitz check. Publish with npx blitz publish.',
        )
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
        const root = await pinnedProject(BLITZ_VERSION)
        await expect(execute(process.execPath, [cli, 'publish', '--bogus'], {cwd: root}))
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

describe('agent testing guide', () => {
    it('uses one request line and relies on the CLI to carry the loop', async () => {
        const document = await readFile(resolve('../../docs/testing-with-an-agent.md'), 'utf8')
        const pasteBlock = document.match(/```\n([\s\S]*?)\n```/)?.[1]

        expect(pasteBlock).toBe(
            'use npx @blitzdev/blitz and build me an FPS shooting practice game\n'
            + 'Never print the deploy token or claim secret from .blitz/deploys.json.',
        )
        expect(document).toContain('The CLI output carries the loop')
        expect(document).toContain('## Testing unreleased changes from this machine')
    })
})

async function captureDevStartup(root: string): Promise<{stdout: string, stderr: string}> {
    const child = spawn(process.execPath, [cli, 'dev', '--port', '0', '--no-open'], {
        cwd: root,
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
        stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
        stderr += chunk
    })
    const exit = new Promise<{code: number | null, signal: NodeJS.Signals | null}>((resolveExit, reject) => {
        child.once('error', reject)
        child.once('exit', (code, signal) => resolveExit({code, signal}))
    })

    try {
        await waitFor(() => stdout.includes('\nProject: '), 5_000)
    } finally {
        child.kill('SIGINT')
    }
    const stopped = await exit
    if (stopped.code !== 0) {
        throw new Error(`blitz dev exited with ${stopped.code ?? stopped.signal}: ${stderr}`)
    }
    return {stdout, stderr}
}

async function waitFor(predicate: () => boolean, timeout: number): Promise<void> {
    const started = Date.now()
    while (!predicate()) {
        if (Date.now() - started >= timeout) throw new Error(`Timed out after ${timeout}ms`)
        await new Promise((resolveWait) => setTimeout(resolveWait, 10))
    }
}

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

async function writeProjectRoot(root: string): Promise<void> {
    await mkdir(resolve(root, 'assets'), {recursive: true})
    await writeFile(resolve(root, 'assets/main.scene.gltf'), '{}')
    await writeFile(resolve(root, 'package.json'), JSON.stringify({
        devDependencies: {'@blitzdev/blitz': BLITZ_VERSION},
    }))
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
