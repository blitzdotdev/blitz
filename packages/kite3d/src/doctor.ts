import {createHash} from 'node:crypto'
import {constants} from 'node:fs'
import {access, readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {createServer} from 'node:net'
import {resolve} from 'node:path'
import {resolveBackendUrl} from './backend.ts'
import {gitRepositoryRoot} from './git.ts'
import {findPinnedProject, resolvePinnedVersion} from './version-pin.ts'
import {KITE3D_VERSION} from './versions.ts'
import {LEGACY_PROJECT_MESSAGE, legacyProjectMigrationNeeded} from './legacy.ts'

export type DoctorStatus = 'pass' | 'warn' | 'fail'

export interface DoctorRow {
    check: 'node' | 'migration' | 'version-pin' | 'install-source' | 'packages' | 'dev-port' | 'backend' | 'runtime' | 'playwright' | 'git'
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

const DEFAULT_DEV_PORT = 4321
const DEFAULT_DEV_PORT_ATTEMPTS = 20
const KITE3D_PACKAGES = ['kite3d', 'editor', 'engine', 'template'] as const
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

    if (await legacyProjectMigrationNeeded(root)) {
        rows.push(row('migration', 'warn', LEGACY_PROJECT_MESSAGE))
    }

    const project = await findPinnedProject(root)
    if (!project) {
        rows.push(row('version-pin', 'fail', 'package.json does not pin kite3d in devDependencies'))
    } else {
        const resolvedVersion = await resolvePinnedVersion(project)
        if (!resolvedVersion) {
            rows.push(row('version-pin', 'fail', `Project pin ${project.version} is not installed; run npm install`))
        } else if (resolvedVersion !== KITE3D_VERSION) {
            rows.push(row('version-pin', 'fail', `Project resolves to ${resolvedVersion}; running CLI is ${KITE3D_VERSION}`))
        } else {
            rows.push(row('version-pin', 'pass', `Project and running CLI use ${KITE3D_VERSION}`))
        }
    }

    const dependencySpecifier = await kite3dDependencySpecifier(root)
    if (!dependencySpecifier) {
        rows.push(row('install-source', 'fail', 'package.json does not depend on kite3d'))
    } else if (dependencySpecifier.startsWith('file:') || dependencySpecifier.startsWith('link:')) {
        rows.push(row(
            'install-source',
            'warn',
            `development install from ${dependencySpecifier}; `
                + 'run npm install kite3d@latest to use the published package',
        ))
    } else {
        rows.push(row('install-source', 'pass', `Published package dependency ${dependencySpecifier}`))
    }

    const packages = await installedPackageVersions(root)
    const missing = KITE3D_PACKAGES.filter((name) => !packages.has(name))
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
        const requestedPort = options.port
        if (requestedPort !== undefined) {
            rows.push(await portAvailable(requestedPort)
                ? row('dev-port', 'pass', requestedPort === 0 ? 'A development port is available' : `Port ${requestedPort} is available for kite3d dev`)
                : row('dev-port', 'fail', `Port ${requestedPort} is in use by another process`))
        } else {
            const available = await firstAvailablePort(DEFAULT_DEV_PORT, DEFAULT_DEV_PORT_ATTEMPTS)
            rows.push(available === DEFAULT_DEV_PORT
                ? row('dev-port', 'pass', `Port ${DEFAULT_DEV_PORT} is available for kite3d dev`)
                : available !== undefined
                    ? row('dev-port', 'warn', `Port ${DEFAULT_DEV_PORT} is in use; kite3d dev will use port ${available}`)
                    : row('dev-port', 'fail', `Ports ${DEFAULT_DEV_PORT}-${DEFAULT_DEV_PORT + DEFAULT_DEV_PORT_ATTEMPTS - 1} are in use`))
        }
    }

    const backendUrl = resolveBackendUrl(options.backendUrl)
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
        ? repository === root
            ? row('git', 'pass', `Git repository: ${repository}`)
            : row('git', 'warn', `Git repository root ${repository} is not the project root ${root}`)
        : row('git', 'fail', 'Project is not in a Git repository; run kite3d init or git init'))

    return {ok: rows.every(({status}) => status !== 'fail'), rows}
}

export function formatDoctorTable(result: DoctorResult): string {
    const headings = ['CHECK', 'STATUS', 'DETAIL']
    const values = result.rows.map(({check, status, detail}) => [check, status.toUpperCase(), detail])
    const widths = headings.map((heading, index) => Math.max(heading.length, ...values.map((value) => value[index].length)))
    const line = (values: string[]) => values.map((value, index) => value.padEnd(widths[index])).join('  ').trimEnd()
    return [line(headings), ...values.map(line), '', result.ok ? 'Doctor passed.' : 'Doctor found failures.'].join('\n')
}

async function installedPackageVersions(root: string): Promise<Map<typeof KITE3D_PACKAGES[number], string>> {
    const versions = new Map<typeof KITE3D_PACKAGES[number], string>()
    for (const name of KITE3D_PACKAGES) {
        try {
            const manifest = JSON.parse(await readFile(resolve(root, `node_modules/${packageName(name)}/package.json`), 'utf8')) as {
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
        state = JSON.parse(await readFile(resolve(root, '.kite3d/dev.json'), 'utf8')) as typeof state
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
            headers: {'X-Kite3D-Token': state.token},
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

async function firstAvailablePort(start: number, count: number): Promise<number | undefined> {
    for (let offset = 0; offset < count; offset += 1) {
        const port = start + offset
        if (await portAvailable(port)) return port
    }
    return undefined
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

function packageName(name: typeof KITE3D_PACKAGES[number]): string {
    return name === 'kite3d' ? name : `@blitzdev/${name}`
}

function formatPackages(packages: Map<typeof KITE3D_PACKAGES[number], string>): string {
    return KITE3D_PACKAGES.filter((name) => packages.has(name))
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

async function kite3dDependencySpecifier(root: string): Promise<string | undefined> {
    const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, unknown>
        devDependencies?: Record<string, unknown>
    }
    const specifier = manifest.devDependencies?.['kite3d']
        ?? manifest.dependencies?.['kite3d']
    return typeof specifier === 'string' && specifier ? specifier : undefined
}
