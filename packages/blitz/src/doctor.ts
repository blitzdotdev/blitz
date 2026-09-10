import {createHash} from 'node:crypto'
import {constants} from 'node:fs'
import {access, readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {createServer} from 'node:net'
import {resolve} from 'node:path'
import {gitRepositoryRoot} from './git.ts'
import {findPinnedProject, resolvePinnedVersion} from './version-pin.ts'
import {BLITZ_VERSION} from './versions.ts'

export type DoctorStatus = 'pass' | 'warn' | 'fail'

export interface DoctorRow {
    check: 'node' | 'version-pin' | 'packages' | 'dev-port' | 'backend' | 'runtime' | 'playwright' | 'git'
    status: DoctorStatus
    detail: string
}

export interface DoctorResult {
    ok: boolean
    rows: DoctorRow[]
}

export interface DoctorOptions {
    backendUrl?: string
    port?: number
    nodeVersion?: string
    fetch?: typeof fetch
    checkPlaywright?: () => Promise<string>
}

const DEFAULT_BACKEND_URL = 'https://blitz-backend.blitzapp.workers.dev'
const BLITZ_PACKAGES = ['blitz', 'editor', 'engine', 'template'] as const
const doctorRequire = createRequire(import.meta.url)

export async function doctorProject(
    projectRoot = process.cwd(),
    options: DoctorOptions = {},
): Promise<DoctorResult> {
    const root = resolve(projectRoot)
    const fetchImplementation = options.fetch || fetch
    const rows: DoctorRow[] = []
    const nodeVersion = options.nodeVersion || process.versions.node
    const nodeMajor = Number(nodeVersion.split('.')[0])
    rows.push(Number.isInteger(nodeMajor) && nodeMajor >= 20
        ? row('node', 'pass', `Node ${nodeVersion}`)
        : row('node', 'fail', `Node 20 or newer is required; found ${nodeVersion}`))

    const project = await findPinnedProject(root)
    if (!project) {
        rows.push(row('version-pin', 'fail', 'package.json does not pin @blitzdev/blitz in devDependencies'))
    } else {
        const resolvedVersion = await resolvePinnedVersion(project)
        if (!resolvedVersion) {
            rows.push(row('version-pin', 'fail', `Project pin ${project.version} is not installed; run npm install`))
        } else if (resolvedVersion !== BLITZ_VERSION) {
            rows.push(row('version-pin', 'fail', `Project resolves to ${resolvedVersion}; running CLI is ${BLITZ_VERSION}`))
        } else {
            rows.push(row('version-pin', 'pass', `Project and running CLI use ${BLITZ_VERSION}`))
        }
    }

    const packages = await installedPackageVersions(root)
    const missing = BLITZ_PACKAGES.filter((name) => !packages.has(name))
    const distinctVersions = new Set(packages.values())
    if (missing.length) {
        rows.push(row('packages', 'fail', `Missing ${missing.map(packageName).join(', ')}; run npm install`))
    } else if (distinctVersions.size !== 1) {
        rows.push(row('packages', 'fail', `Installed versions do not match: ${formatPackages(packages)}`))
    } else {
        rows.push(row('packages', 'pass', formatPackages(packages)))
    }

    const liveDev = await liveDevServer(root, fetchImplementation)
    if (liveDev) {
        rows.push(row('dev-port', 'pass', `Live project server: pid ${liveDev.pid}, port ${liveDev.port}, age ${liveDev.age}`))
    } else {
        const port = options.port ?? 4321
        rows.push(await portAvailable(port)
            ? row('dev-port', 'pass', port === 0 ? 'A development port is available' : `Port ${port} is available for blitz dev`)
            : row('dev-port', 'fail', `Port ${port} is in use by another process`))
    }

    const backendUrl = (options.backendUrl || process.env.BLITZ_BACKEND_URL || DEFAULT_BACKEND_URL).replace(/\/+$/, '')
    let backendReachable = false
    try {
        const response = await fetchImplementation(`${backendUrl}/health`, {signal: AbortSignal.timeout(5_000)})
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        backendReachable = true
        rows.push(row('backend', 'pass', `${backendUrl}/health is reachable`))
    } catch (error) {
        rows.push(row('backend', 'fail', `${backendUrl}/health is unavailable: ${errorMessage(error)}`))
    }

    const engineVersion = packages.get('engine')
    if (!backendReachable) {
        rows.push(row('runtime', 'warn', 'Runtime registration was not checked because the backend is unavailable'))
    } else if (!engineVersion) {
        rows.push(row('runtime', 'warn', 'Runtime registration was not checked because @blitzdev/engine is missing'))
    } else {
        try {
            const bytes = await readFile(resolve(root, 'node_modules/@blitzdev/engine/dist/runtime.js'))
            const hash = createHash('sha256').update(bytes).digest('hex')
            const response = await fetchImplementation(`${backendUrl}/api/v1/runtimes/${encodeURIComponent(engineVersion)}`, {
                signal: AbortSignal.timeout(5_000),
            })
            if (!response.ok) throw new Error(`registry returned HTTP ${response.status}`)
            const payload = await response.json() as {sha256?: unknown, runtimes?: Array<{sha256?: unknown}>}
            const hashes = [payload.sha256, ...(payload.runtimes || []).map(({sha256}) => sha256)]
                .filter((value): value is string => typeof value === 'string')
            rows.push(hashes.includes(hash)
                ? row('runtime', 'pass', `Installed engine runtime ${hash.slice(0, 12)} is registered for ${engineVersion}`)
                : row('runtime', 'fail', `Installed engine runtime ${hash.slice(0, 12)} is not registered for ${engineVersion}`))
        } catch (error) {
            rows.push(row('runtime', 'fail', `Could not verify the installed engine runtime: ${errorMessage(error)}`))
        }
    }

    try {
        const detail = await (options.checkPlaywright || playwrightBrowserAvailable)()
        rows.push(row('playwright', 'pass', detail))
    } catch (error) {
        rows.push(row('playwright', 'fail', `${errorMessage(error)}; run npx playwright install chromium`))
    }

    const repository = await gitRepositoryRoot(root)
    rows.push(repository
        ? row('git', 'pass', `Git repository: ${repository}`)
        : row('git', 'fail', 'Project is not in a Git repository; run blitz init or git init'))

    return {ok: rows.every(({status}) => status !== 'fail'), rows}
}

export function formatDoctorTable(result: DoctorResult): string {
    const headings = ['CHECK', 'STATUS', 'DETAIL']
    const values = result.rows.map(({check, status, detail}) => [check, status.toUpperCase(), detail])
    const widths = headings.map((heading, index) => Math.max(heading.length, ...values.map((value) => value[index].length)))
    const line = (values: string[]) => values.map((value, index) => value.padEnd(widths[index])).join('  ').trimEnd()
    return [line(headings), ...values.map(line), '', result.ok ? 'Doctor passed.' : 'Doctor found failures.'].join('\n')
}

async function installedPackageVersions(root: string): Promise<Map<typeof BLITZ_PACKAGES[number], string>> {
    const versions = new Map<typeof BLITZ_PACKAGES[number], string>()
    for (const name of BLITZ_PACKAGES) {
        try {
            const manifest = JSON.parse(await readFile(resolve(root, `node_modules/@blitzdev/${name}/package.json`), 'utf8')) as {
                version?: unknown
            }
            if (typeof manifest.version === 'string' && manifest.version) versions.set(name, manifest.version)
        } catch (error) {
            if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
        }
    }
    return versions
}

async function liveDevServer(root: string, fetchImplementation: typeof fetch): Promise<{
    pid: number
    port: number
    age: string
} | undefined> {
    let state: {pid?: unknown, port?: unknown, url?: unknown, token?: unknown, started_at?: unknown}
    try {
        state = JSON.parse(await readFile(resolve(root, '.blitz/dev.json'), 'utf8')) as typeof state
    } catch {
        return undefined
    }
    if (!Number.isInteger(state.pid) || !processIsAlive(state.pid as number) || !Number.isInteger(state.port)
        || typeof state.url !== 'string' || typeof state.token !== 'string' || typeof state.started_at !== 'string') return undefined
    const started = Date.parse(state.started_at)
    if (!Number.isFinite(started)) return undefined
    try {
        const url = new URL(state.url)
        if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return undefined
        const response = await fetchImplementation(new URL('/api/state', url), {
            headers: {'X-Blitz-Token': state.token},
            signal: AbortSignal.timeout(1_500),
        })
        if (!response.ok) return undefined
    } catch {
        return undefined
    }
    return {
        pid: state.pid as number,
        port: state.port as number,
        age: formatAge(Math.max(0, Date.now() - started)),
    }
}

function processIsAlive(pid: number): boolean {
    try {
        process.kill(pid, 0)
        return true
    } catch (error) {
        return error instanceof Error && 'code' in error && error.code === 'EPERM'
    }
}

function portAvailable(port: number): Promise<boolean> {
    return new Promise((resolveAvailable) => {
        const server = createServer()
        server.unref()
        server.once('error', () => resolveAvailable(false))
        server.listen(port, '127.0.0.1', () => server.close(() => resolveAvailable(true)))
    })
}

async function playwrightBrowserAvailable(): Promise<string> {
    let executablePath: string
    let chromium: {
        executablePath(): string
        launch(options: {headless: boolean}): Promise<{close(): Promise<void>}>
    }
    try {
        const playwright = doctorRequire('playwright') as {chromium: typeof chromium}
        chromium = playwright.chromium
        executablePath = chromium.executablePath()
    } catch {
        throw new Error('Playwright is not installed')
    }
    try {
        await access(executablePath, constants.X_OK)
    } catch {
        throw new Error('The Playwright Chromium browser is not installed')
    }
    const browser = await chromium.launch({headless: true})
    await browser.close()
    return `Playwright Chromium is available at ${executablePath}`
}

function row(check: DoctorRow['check'], status: DoctorStatus, detail: string): DoctorRow {
    return {check, status, detail}
}

function packageName(name: typeof BLITZ_PACKAGES[number]): string {
    return `@blitzdev/${name}`
}

function formatPackages(packages: Map<typeof BLITZ_PACKAGES[number], string>): string {
    return BLITZ_PACKAGES.filter((name) => packages.has(name))
        .map((name) => `${packageName(name)} ${packages.get(name)}`).join(', ')
}

function formatAge(milliseconds: number): string {
    const seconds = Math.floor(milliseconds / 1_000)
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}
