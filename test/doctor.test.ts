import {createHash} from 'node:crypto'
import {createServer} from 'node:http'
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {initProject} from '../src/commands.ts'
import {doctorProject, type DoctorResult} from '../src/doctor.ts'
import {initializeGitRepository} from '../src/git.ts'
import {KITE3D_VERSION} from '../src/versions.ts'
import {startMockBackend} from './mockBackend.ts'

const cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
    while (cleanup.length) await cleanup.pop()!()
})

describe('kite3d doctor', () => {
    it('passes every row for a ready project fixture', async () => {
        const fixture = await readyProject()
        const result = await runDoctor(fixture.root, fixture.backendUrl)

        expect(result.ok).toBe(true)
        expect(Object.fromEntries(result.rows.map(({check, status}) => [check, status]))).toEqual({
            node: 'pass',
            'version-pin': 'pass',
            'install-source': 'pass',
            packages: 'pass',
            'dev-port': 'pass',
            backend: 'pass',
            runtime: 'pass',
            playwright: 'pass',
            git: 'pass',
        })
    })

    it('fails the Node row below version 20', async () => {
        const fixture = await readyProject()
        expect(row(await runDoctor(fixture.root, fixture.backendUrl, {nodeVersion: '18.20.0'}), 'node'))
            .toMatchObject({status: 'fail', detail: expect.stringContaining('Node 20')})
    })

    it('warns when a legacy project needs migration', async () => {
        const fixture = await readyProject()
        const path = resolve(fixture.root, 'package.json')
        const manifest = JSON.parse(await readFile(path, 'utf8'))
        manifest.blitz = {version: KITE3D_VERSION}
        await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`)

        expect(row(await runDoctor(fixture.root, fixture.backendUrl), 'migration')).toEqual({
            check: 'migration',
            status: 'warn',
            detail: 'Legacy Blitz project detected. Run npx kite3d upgrade.',
        })
    })

    it('fails the version-pin row when the project and command differ', async () => {
        const fixture = await readyProject()
        const path = resolve(fixture.root, 'package.json')
        const manifest = JSON.parse(await readFile(path, 'utf8'))
        manifest.devDependencies['kite3d'] = '9.9.9'
        await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`)

        expect(row(await runDoctor(fixture.root, fixture.backendUrl), 'version-pin'))
            .toMatchObject({status: 'fail', detail: expect.stringContaining('running CLI')})
    })

    it.each(['file:../../kite3d-packs/kite3d.tgz', 'link:../../packages/kite3d'])(
        'warns when the project uses the development install specifier %s',
        async (specifier) => {
            const fixture = await readyProject()
            const path = resolve(fixture.root, 'package.json')
            const manifest = JSON.parse(await readFile(path, 'utf8'))
            manifest.devDependencies['kite3d'] = specifier
            await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`)

            const result = await runDoctor(fixture.root, fixture.backendUrl)

            expect(row(result, 'install-source')).toEqual({
                check: 'install-source',
                status: 'warn',
                detail: `development install from ${specifier}; `
                    + 'run npm install kite3d@latest to use the published package',
            })
            expect(result.ok).toBe(true)
        },
    )

    it('passes the install-source row for a published version range', async () => {
        const fixture = await readyProject()
        const path = resolve(fixture.root, 'package.json')
        const manifest = JSON.parse(await readFile(path, 'utf8'))
        manifest.devDependencies['kite3d'] = `^${KITE3D_VERSION}`
        await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`)

        expect(row(await runDoctor(fixture.root, fixture.backendUrl), 'install-source'))
            .toMatchObject({status: 'pass', detail: expect.stringContaining(`^${KITE3D_VERSION}`)})
    })

    it('fails the packages row for missing or mixed @blitzdev versions', async () => {
        const fixture = await readyProject()
        await writeFile(resolve(fixture.root, 'node_modules/@blitzdev/editor/package.json'), JSON.stringify({version: '9.9.9'}))

        expect(row(await runDoctor(fixture.root, fixture.backendUrl), 'packages'))
            .toMatchObject({status: 'fail', detail: expect.stringContaining('do not match')})
    })

    it('fails the port row when the development port belongs to another process', async () => {
        const fixture = await readyProject()
        const blocker = createServer()
        await new Promise<void>((resolveListen, reject) => {
            blocker.once('error', reject)
            blocker.listen(0, '127.0.0.1', resolveListen)
        })
        cleanup.push(() => new Promise<void>((resolveClose, reject) =>
            blocker.close((error) => error ? reject(error) : resolveClose())))
        const address = blocker.address()
        if (!address || typeof address === 'string') throw new Error('Blocker did not bind')

        const result = await doctorProject(fixture.root, {
            backendUrl: fixture.backendUrl,
            port: address.port,
            checkPlaywright: async () => 'fixture browser',
        })
        expect(row(result, 'dev-port')).toMatchObject({status: 'fail', detail: expect.stringContaining('another process')})
    })

    it('warns when the default port is busy but another automatic port is free', async () => {
        const fixture = await readyProject()
        const blocker = createServer()
        const ownsDefaultPort = await new Promise<boolean>((resolveListen, reject) => {
            blocker.once('error', (error: NodeJS.ErrnoException) => {
                if (error.code === 'EADDRINUSE') resolveListen(false)
                else reject(error)
            })
            blocker.listen(4321, '127.0.0.1', () => resolveListen(true))
        })
        if (ownsDefaultPort) {
            cleanup.push(() => new Promise<void>((resolveClose, reject) =>
                blocker.close((error) => error ? reject(error) : resolveClose())))
        }

        const result = await doctorProject(fixture.root, {
            backendUrl: fixture.backendUrl,
            checkPlaywright: async () => 'fixture browser',
        })

        expect(row(result, 'dev-port')).toMatchObject({
            status: 'warn',
            detail: expect.stringMatching(/Port 4321 is in use; kite3d dev will use port 43\d\d/),
        })
        expect(result.ok).toBe(true)
    })

    it('accepts a live server for this project and reports its pid and age', async () => {
        const fixture = await readyProject()
        const live = createServer((_, response) => {
            response.writeHead(200, {'Content-Type': 'application/json'}).end('{}')
        })
        await new Promise<void>((resolveListen, reject) => {
            live.once('error', reject)
            live.listen(0, '127.0.0.1', resolveListen)
        })
        cleanup.push(() => new Promise<void>((resolveClose, reject) =>
            live.close((error) => error ? reject(error) : resolveClose())))
        const address = live.address()
        if (!address || typeof address === 'string') throw new Error('Live fixture did not bind')
        await mkdir(resolve(fixture.root, '.kite3d'), {recursive: true})
        await writeFile(resolve(fixture.root, '.kite3d/dev.json'), JSON.stringify({
            pid: process.pid,
            port: address.port,
            url: `http://127.0.0.1:${address.port}/?t=secret`,
            token: 'secret',
            started_at: new Date(Date.now() - 4_000).toISOString(),
        }))

        const result = await runDoctor(fixture.root, fixture.backendUrl)
        expect(row(result, 'dev-port')).toMatchObject({
            status: 'pass',
            detail: expect.stringMatching(new RegExp(`pid ${process.pid}, port \\d+, age \\d+s`)),
        })
        expect(row(result, 'dev-port').detail).not.toContain('secret')
    })

    it('fails backend reachability and warns that runtime verification was skipped', async () => {
        const fixture = await readyProject()
        const result = await doctorProject(fixture.root, {
            port: 0,
            fetch: async () => { throw new Error('fixture offline') },
            checkPlaywright: async () => 'fixture browser',
        })
        expect(row(result, 'backend')).toMatchObject({status: 'fail', detail: expect.stringContaining('fixture offline')})
        expect(row(result, 'runtime')).toMatchObject({status: 'warn', detail: expect.stringContaining('not checked')})
    })

    it('uses https://blitz.dev when BLITZ_BACKEND_URL is unset', async () => {
        const fixture = await readyProject()
        const configuredBackendUrl = process.env.BLITZ_BACKEND_URL
        const requests: string[] = []
        delete process.env.BLITZ_BACKEND_URL
        try {
            await doctorProject(fixture.root, {
                port: 0,
                fetch: async (input) => {
                    requests.push(String(input))
                    return new Response(null, {status: 503})
                },
                checkPlaywright: async () => 'fixture browser',
            })
        } finally {
            if (configuredBackendUrl === undefined) delete process.env.BLITZ_BACKEND_URL
            else process.env.BLITZ_BACKEND_URL = configuredBackendUrl
        }

        expect(requests).toEqual(['https://blitz.dev/health'])
    })

    it('fails runtime registration when the installed engine hash is absent', async () => {
        const fixture = await readyProject({registeredRuntime: false})
        expect(row(await runDoctor(fixture.root, fixture.backendUrl), 'runtime'))
            .toMatchObject({status: 'fail', detail: expect.stringContaining('is not registered')})
    })

    it('fails the Playwright row when Chromium is unavailable', async () => {
        const fixture = await readyProject()
        const result = await doctorProject(fixture.root, {
            backendUrl: fixture.backendUrl,
            port: 0,
            checkPlaywright: async () => { throw new Error('fixture browser missing') },
        })
        expect(row(result, 'playwright')).toMatchObject({status: 'fail', detail: expect.stringContaining('playwright install chromium')})
    })

    it('fails the Git row outside a repository', async () => {
        const fixture = await readyProject({git: false})
        expect(row(await runDoctor(fixture.root, fixture.backendUrl), 'git'))
            .toMatchObject({status: 'fail', detail: expect.stringContaining('git init')})
    })

    it('warns when the repository root is a tracked parent of the project root', async () => {
        const fixture = await readyProject({parentGit: true})
        const result = await runDoctor(fixture.root, fixture.backendUrl)

        expect(row(result, 'git')).toMatchObject({
            status: 'warn',
            detail: expect.stringMatching(/is not the project root/),
        })
        expect(result.ok).toBe(true)
    })
})

async function readyProject(options: {registeredRuntime?: boolean, git?: boolean, parentGit?: boolean} = {}) {
    const temporaryRoot = await mkdtemp(resolve(tmpdir(), 'kite3d-doctor-'))
    cleanup.push(() => rm(temporaryRoot, {recursive: true, force: true}))
    const root = options.parentGit ? resolve(temporaryRoot, 'project') : temporaryRoot
    if (options.parentGit) {
        await mkdir(root)
        await writeFile(resolve(root, '.tracked'), 'tracked by parent')
        await initializeGitRepository(temporaryRoot)
    }
    await initProject(root, {git: options.parentGit ? false : options.git !== false})
    const runtime = Buffer.from('doctor fixture runtime')
    for (const name of ['kite3d', '@blitzdev/editor', '@blitzdev/engine', '@blitzdev/template']) {
        const packageRoot = resolve(root, `node_modules/${name}`)
        await mkdir(packageRoot, {recursive: true})
        await writeFile(resolve(packageRoot, 'package.json'), JSON.stringify({version: KITE3D_VERSION}))
    }
    await mkdir(resolve(root, 'node_modules/@blitzdev/engine/dist'), {recursive: true})
    await writeFile(resolve(root, 'node_modules/@blitzdev/engine/dist/runtime.js'), runtime)
    const backend = await startMockBackend({
        runtimeHashes: options.registeredRuntime === false
            ? ['f'.repeat(64)]
            : [createHash('sha256').update(runtime).digest('hex')],
    })
    cleanup.push(() => backend.close())
    return {root, backendUrl: backend.url}
}

function runDoctor(root: string, backendUrl: string, options: {nodeVersion?: string} = {}) {
    return doctorProject(root, {
        backendUrl,
        port: 0,
        nodeVersion: options.nodeVersion,
        checkPlaywright: async () => 'fixture browser',
    })
}

function row(result: DoctorResult, check: DoctorResult['rows'][number]['check']) {
    const found = result.rows.find((candidate) => candidate.check === check)
    if (!found) throw new Error(`Missing doctor row ${check}`)
    return found
}
