import {execFile} from 'node:child_process'
import {createRequire} from 'node:module'
import {appendFile, mkdir, readFile, stat, writeFile} from 'node:fs/promises'
import {resolve, sep} from 'node:path'
import {promisify} from 'node:util'
import {parsePackageJSON, parsePackageJsonSettingsConfig} from '@blitzdev/engine/projectFormat'
import {createDevServer} from './server.ts'

export interface CheckRow {
    kind: 'project' | 'script' | 'plugin' | 'generator' | 'component'
    path: string
    status: 'pass' | 'fail'
    detail: string
}

export interface CheckResult {
    ok: boolean
    checkedAt: string
    mode: 'editor' | 'headless' | 'unavailable' | 'static'
    componentTypes: string[]
    rows: CheckRow[]
    outcomes: CheckOutcome[]
}

export interface CheckOutcome {
    name: 'Playable' | 'Editable' | 'Persisted'
    status: 'pass' | 'fail' | 'skipped'
    summary: string
    codes: string[]
    durationMs?: number
    report?: unknown
}

const BUILT_IN_COMPONENT_TYPES = new Set([
    'Cannon3DBodyComponent',
    'Cannon3DShapeComponent',
    'CannonRagdollComponent',
    'Generator',
    'HtmlUiComponent',
])
const execute = promisify(execFile)
const checkRequire = createRequire(import.meta.url)
const INSPECT_MODULE_SOURCE = `
import {pathToFileURL} from 'node:url'
console.log = console.warn = console.error = () => {}
globalThis.ImageData ??= class ImageData {}
globalThis.window ??= globalThis
globalThis.addEventListener ??= () => {}
globalThis.removeEventListener ??= () => {}
try {
    const module = await import(pathToFileURL(process.argv[1]).href)
    const types = Object.values(module)
        .map(value => typeof value === 'function' ? value.ComponentType : undefined)
        .filter(value => typeof value === 'string')
    process.stdout.write(JSON.stringify(types))
} catch (error) {
    process.stderr.write(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
}
`

export async function checkProject(projectRoot = process.cwd()): Promise<CheckResult> {
    const root = resolve(projectRoot)
    const rows: CheckRow[] = []
    const registeredTypes = new Set(BUILT_IN_COMPONENT_TYPES)

    try {
        const packageJson = parsePackageJSON(await readFile(resolve(root, 'package.json'), 'utf8'))
        const config = await parsePackageJsonSettingsConfig(packageJson)
        const scenePath = localProjectPath(root, packageJson.mainScene)
        const scene = JSON.parse(await readFile(scenePath, 'utf8')) as SceneDocument

        for (const definition of config.scripts) {
            try {
                const path = await resolveModule(root, definition.import, false)
                const componentTypes = await inspectScriptModule(root, path)
                if (definition.active !== false) {
                    for (const type of componentTypes) registeredTypes.add(type)
                }
                rows.push({
                    kind: 'script',
                    path: definition.import,
                    status: 'pass',
                    detail: componentTypes.length ? componentTypes.join(', ') : 'no component types',
                })
            } catch (error) {
                rows.push({kind: 'script', path: definition.import, status: 'fail', detail: errorMessage(error)})
            }
        }

        for (const definition of config.plugins) {
            try {
                const isDependency = config.dependencies.some(({key}) =>
                    definition.import === key || definition.import.startsWith(`${key}/`)
                )
                await resolveModule(root, definition.import, isDependency)
                rows.push({kind: 'plugin', path: definition.import, status: 'pass', detail: 'resolved'})
            } catch (error) {
                rows.push({kind: 'plugin', path: definition.import, status: 'fail', detail: errorMessage(error)})
            }
        }

        for (const [nodeIndex, node] of (scene.nodes || []).entries()) {
            const nodeName = typeof node.name === 'string' ? node.name : `Node ${nodeIndex}`
            for (const component of Object.values(node.extras?.EntityComponentPlugin || {})) {
                const type = typeof component.type === 'string' ? component.type : ''
                if (!type) {
                    rows.push({kind: 'component', path: nodeName, status: 'fail', detail: 'component type is missing'})
                    continue
                }
                rows.push({
                    kind: 'component',
                    path: nodeName,
                    status: registeredTypes.has(type) ? 'pass' : 'fail',
                    detail: registeredTypes.has(type) ? type : `${type} is not registered`,
                })
                if (type !== 'Generator') continue
                const module = isRecord(component.state) && typeof component.state.module === 'string'
                    ? component.state.module
                    : ''
                try {
                    if (!module) throw new Error('generator module is missing')
                    await resolveModule(root, module, false)
                    rows.push({kind: 'generator', path: module, status: 'pass', detail: nodeName})
                } catch (error) {
                    rows.push({kind: 'generator', path: module || nodeName, status: 'fail', detail: errorMessage(error)})
                }
            }
        }
    } catch (error) {
        rows.push({kind: 'project', path: 'package.json / main scene', status: 'fail', detail: errorMessage(error)})
    }

    const staticOk = rows.every(({status}) => status === 'pass')
    const runtime = staticOk
        ? await runRuntimeChecks(root)
        : {
            mode: 'static' as const,
            outcomes: outcomeNames.map((name) => ({
                name,
                status: 'fail' as const,
                summary: 'Runtime checks were not started because the static project checks failed.',
                codes: [],
            })),
        }
    const result: CheckResult = {
        ok: staticOk && runtime.outcomes.every(({status}) => status !== 'fail'),
        checkedAt: new Date().toISOString(),
        mode: runtime.mode,
        componentTypes: [...registeredTypes].sort(),
        rows,
        outcomes: runtime.outcomes,
    }
    await mkdir(resolve(root, '.blitz'), {recursive: true})
    await writeFile(resolve(root, '.blitz/check.json'), `${JSON.stringify(result, null, 2)}\n`, {mode: 0o600})
    await appendFile(resolve(root, '.blitz/console.log'), `${formatCheckSummary(result)}\n`, {mode: 0o600})
    return result
}

async function inspectScriptModule(root: string, path: string): Promise<string[]> {
    let stdout: string
    try {
        ({stdout} = await execute(process.execPath, ['--input-type=module', '--eval', INSPECT_MODULE_SOURCE, path], {
            cwd: root,
            maxBuffer: 1024 * 1024,
        }))
    } catch (error) {
        const stderr = isRecord(error) && typeof error.stderr === 'string' ? error.stderr.trim() : ''
        throw new Error(stderr || errorMessage(error))
    }
    const values: unknown = JSON.parse(stdout)
    if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) {
        throw new Error('script inspection returned an invalid component type list')
    }
    return values as string[]
}

export function formatCheckTable(result: CheckResult): string {
    const headings = ['KIND', 'STATUS', 'PATH', 'DETAIL']
    const values = result.rows.map((row) => [row.kind, row.status.toUpperCase(), row.path, row.detail])
    const widths = headings.map((heading, index) => Math.max(heading.length, ...values.map((row) => row[index].length)))
    const line = (cells: string[]) => cells.map((cell, index) => cell.padEnd(widths[index])).join('  ').trimEnd()
    const outcomeLines = result.outcomes.map((outcome) => {
        const detail = outcome.codes.length ? `${outcome.codes.join(', ')} — ${outcome.summary}` : outcome.summary
        return `${outcome.name.padEnd(9)}  ${outcome.status.toUpperCase().padEnd(7)}  ${detail}`
    })
    return [
        line(headings),
        ...values.map(line),
        '',
        `Runtime mode: ${result.mode}`,
        ...outcomeLines,
        `Check ${result.ok ? 'passed' : 'failed'} (${result.rows.length} static row(s)).`,
    ].join('\n')
}

const outcomeNames: CheckOutcome['name'][] = ['Playable', 'Editable', 'Persisted']

interface RuntimeCheckResult {
    mode: 'editor' | 'headless' | 'unavailable'
    outcomes: CheckOutcome[]
}

interface DevConnection {
    url: string
    token: string
}

async function runRuntimeChecks(root: string): Promise<RuntimeCheckResult> {
    const connection = await runningDevConnection(root)
    if (connection) {
        const editorResult = await requestEditorCheck(connection)
        if (editorResult) return editorResult
    }
    return runHeadlessCheck(root, connection)
}

async function requestEditorCheck(connection: DevConnection): Promise<RuntimeCheckResult | undefined> {
    let response: Response
    try {
        response = await fetch(new URL('/api/check', connection.url), {
            method: 'POST',
            headers: {'X-Blitz-Token': connection.token, 'X-Blitz-Client': 'blitz-check'},
        })
    } catch {
        return undefined
    }
    if (response.status === 409) {
        const body = await response.json().catch(() => ({})) as {error?: {code?: string}}
        if (body.error?.code === 'editor_not_connected') return undefined
    }
    if (!response.ok) throw new Error(`The open editor check failed with status ${response.status}.`)
    const payload = await response.json() as unknown
    return parseRuntimeCheckResult(payload, 'editor')
}

async function runHeadlessCheck(root: string, existing?: DevConnection): Promise<RuntimeCheckResult> {
    let chromium: BrowserLauncher
    try {
        chromium = (checkRequire('playwright') as {chromium: BrowserLauncher}).chromium
    } catch {
        return unavailableOutcomes('Playwright is not installed; browser checks were skipped.')
    }

    let server: Awaited<ReturnType<typeof createDevServer>> | undefined
    let browser: BrowserHandle | undefined
    try {
        let connection = existing
        if (!connection) {
            server = await createDevServer({projectRoot: root, port: 0, strictPort: true})
            connection = {url: server.url, token: server.token}
        }
        try {
            browser = await chromium.launch({headless: true})
        } catch (error) {
            if (/executable.*(does not exist|doesn't exist|missing)|browser.*not found|playwright install/i.test(errorMessage(error))) {
                return unavailableOutcomes('No Playwright browser is installed; browser checks were skipped.')
            }
            throw error
        }
        const page = await browser.newPage()
        const url = new URL(connection.url)
        url.searchParams.set('headless', 'check')
        url.searchParams.set('frames', '30')
        await page.goto(url.href, {waitUntil: 'domcontentloaded', timeout: 30_000})
        await page.waitForFunction('window.__blitzCheckDone === true', undefined, {timeout: 45_000})
        const payload = await page.evaluate('window.__blitzCheckResult')
        return parseRuntimeCheckResult(payload, 'headless')
    } catch (error) {
        const summary = `Headless browser check failed: ${errorMessage(error)}`
        return {mode: 'headless', outcomes: outcomeNames.map((name) => ({name, status: 'fail', summary, codes: []}))}
    } finally {
        await browser?.close().catch(() => undefined)
        await server?.close().catch(() => undefined)
    }
}

async function runningDevConnection(root: string): Promise<DevConnection | undefined> {
    let value: {url?: unknown, token?: unknown}
    try {
        value = JSON.parse(await readFile(resolve(root, '.blitz/dev.json'), 'utf8')) as typeof value
    } catch {
        return undefined
    }
    if (typeof value.url !== 'string' || typeof value.token !== 'string') return undefined
    try {
        const response = await fetch(new URL('/api/state', value.url), {
            headers: {'X-Blitz-Token': value.token},
            signal: AbortSignal.timeout(1_500),
        })
        if (!response.ok) return undefined
    } catch {
        return undefined
    }
    return {url: value.url, token: value.token}
}

function parseRuntimeCheckResult(value: unknown, mode: RuntimeCheckResult['mode']): RuntimeCheckResult {
    const payload = isRecord(value) && isRecord(value.result) ? value.result : value
    if (!isRecord(payload) || !Array.isArray(payload.outcomes)) throw new Error('Runtime check returned an invalid result.')
    const outcomes = payload.outcomes.map((entry): CheckOutcome => {
        if (!isRecord(entry) || !outcomeNames.includes(entry.name as CheckOutcome['name'])
            || !['pass', 'fail', 'skipped'].includes(String(entry.status)) || typeof entry.summary !== 'string') {
            throw new Error('Runtime check returned an invalid outcome.')
        }
        return {
            name: entry.name as CheckOutcome['name'],
            status: entry.status as CheckOutcome['status'],
            summary: entry.summary,
            codes: Array.isArray(entry.codes) ? entry.codes.filter((code): code is string => typeof code === 'string') : [],
            ...(typeof entry.durationMs === 'number' ? {durationMs: entry.durationMs} : {}),
            ...(entry.report !== undefined ? {report: entry.report} : {}),
        }
    })
    if (outcomes.length !== outcomeNames.length || outcomeNames.some((name) => !outcomes.some((outcome) => outcome.name === name))) {
        throw new Error('Runtime check did not return all three outcomes.')
    }
    return {mode, outcomes}
}

function unavailableOutcomes(summary: string): RuntimeCheckResult {
    return {
        mode: 'unavailable',
        outcomes: outcomeNames.map((name) => ({name, status: 'skipped', summary, codes: []})),
    }
}

function formatCheckSummary(result: CheckResult): string {
    const outcomes = result.outcomes.map(({name, status, codes}) =>
        `${name}=${status}${codes.length ? `(${codes.join(',')})` : ''}`).join(' ')
    return `${new Date().toISOString()} [blitz check] ${outcomes}`
}

interface BrowserLauncher {
    launch(options: {headless: boolean}): Promise<BrowserHandle>
}

interface BrowserHandle {
    newPage(): Promise<{
        goto(url: string, options: {waitUntil: 'domcontentloaded', timeout: number}): Promise<unknown>
        waitForFunction(expression: string, argument: undefined, options: {timeout: number}): Promise<unknown>
        evaluate(expression: string): Promise<unknown>
    }>
    close(): Promise<void>
}

async function resolveModule(root: string, specifier: string, allowPackage: boolean): Promise<string> {
    if (!specifier) throw new Error('module path is empty')
    const isPackage = !specifier.startsWith('.') && !specifier.startsWith('/')
    const path = isPackage && allowPackage
        ? createRequire(resolve(root, 'package.json')).resolve(specifier)
        : localProjectPath(root, specifier)
    const metadata = await stat(path)
    if (!metadata.isFile()) throw new Error('path is not a file')
    return path
}

function localProjectPath(root: string, path: string): string {
    const normalized = path.replace(/^\.\//, '').replaceAll('\\', '/')
    if (!normalized || normalized.startsWith('/') || normalized.split('/').some((part) => !part || part === '.' || part === '..')) {
        throw new Error(`invalid project path: ${path}`)
    }
    const target = resolve(root, ...normalized.split('/'))
    if (!target.startsWith(`${root}${sep}`)) throw new Error(`invalid project path: ${path}`)
    return target
}

interface SceneDocument {
    nodes?: Array<{
        name?: unknown
        extras?: {
            EntityComponentPlugin?: Record<string, {type?: unknown, state?: unknown}>
        }
    }>
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return 'file not found'
    return error instanceof Error ? error.message : String(error)
}
