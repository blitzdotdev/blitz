import {execFile} from 'node:child_process'
import {createRequire} from 'node:module'
import {appendFile, mkdir, readFile, stat, writeFile} from 'node:fs/promises'
import {relative, resolve, sep} from 'node:path'
import {promisify} from 'node:util'
import {
    isDependencyModuleSpecifier,
    parsePackageJSON,
    parsePackageJsonSettingsConfig,
    removedGeneratorMessage,
} from '@kite3d/engine/projectFormat'
import {
    HeadlessBrowserUnavailableError,
    runWithHeadlessChromium,
    runningDevConnection,
    type DevConnection,
} from './screenshot.ts'

export interface CheckRow {
    kind: 'project' | 'script' | 'plugin' | 'component'
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
    const removedComponentMessages: string[] = []

    try {
        const packageJson = parsePackageJSON(await readFile(resolve(root, 'package.json'), 'utf8'))
        const config = await parsePackageJsonSettingsConfig(packageJson)
        const scenePath = localProjectPath(root, packageJson.mainScene)
        const scene = JSON.parse(await readFile(scenePath, 'utf8')) as SceneDocument

        for (const definition of config.scripts) {
            try {
                const isDependency = isDependencyModuleSpecifier(definition.import, packageJson)
                const path = await resolveModule(root, definition.import, isDependency)
                const componentTypes = await inspectScriptModule(root, path)
                if (definition.active !== false) {
                    for (const type of componentTypes) registeredTypes.add(type)
                }
                rows.push({
                    kind: 'script',
                    path: resolvedModulePath(root, definition.import, path, isDependency),
                    status: 'pass',
                    detail: componentTypes.length ? componentTypes.join(', ') : 'no component types',
                })
            } catch (error) {
                rows.push({kind: 'script', path: definition.import, status: 'fail', detail: errorMessage(error)})
            }
        }

        for (const definition of config.plugins) {
            try {
                const isDependency = isDependencyModuleSpecifier(definition.import, packageJson)
                const path = await resolveModule(root, definition.import, isDependency)
                rows.push({
                    kind: 'plugin',
                    path: resolvedModulePath(root, definition.import, path, isDependency),
                    status: 'pass',
                    detail: 'resolved',
                })
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
                if (type === 'Generator') {
                    const message = removedGeneratorMessage(nodeName)
                    removedComponentMessages.push(message)
                    rows.push({kind: 'component', path: nodeName, status: 'fail', detail: message})
                    continue
                }
                rows.push({
                    kind: 'component',
                    path: nodeName,
                    status: registeredTypes.has(type) ? 'pass' : 'fail',
                    detail: registeredTypes.has(type) ? type : `${type} is not registered`,
                })
            }
        }
    } catch (error) {
        rows.push({kind: 'project', path: 'package.json / main scene', status: 'fail', detail: errorMessage(error)})
    }

    const staticOk = rows.every(({status}) => status === 'pass')
    const runtime = removedComponentMessages.length
        ? removedComponentOutcomes(removedComponentMessages)
        : staticOk
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
    await mkdir(resolve(root, '.kite3d'), {recursive: true})
    await writeFile(resolve(root, '.kite3d/check.json'), `${JSON.stringify(result, null, 2)}\n`, {mode: 0o600})
    await appendFile(resolve(root, '.kite3d/console.log'), `${formatCheckSummary(result)}\n`, {mode: 0o600})
    return result
}

function removedComponentOutcomes(messages: string[]): RuntimeCheckResult {
    return {
        mode: 'static',
        outcomes: [
            {name: 'Playable', status: 'skipped', summary: 'Runtime checks were not started because Editable failed.', codes: []},
            {name: 'Editable', status: 'fail', summary: messages.join(' '), codes: ['REMOVED_GENERATOR_COMPONENT']},
            {name: 'Persisted', status: 'skipped', summary: 'Persistence was not checked because Editable failed.', codes: []},
        ],
    }
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
    const outcomeLines = result.outcomes.flatMap((outcome) => {
        const detail = outcome.codes.length ? `${outcome.codes.join(', ')}: ${outcome.summary}` : outcome.summary
        const lines = [`${outcome.name.padEnd(9)}  ${outcome.status.toUpperCase().padEnd(7)}  ${detail}`]
        const validation = projectValidationReport(outcome)
        if (!validation) return lines
        const results = Array.isArray(validation.results) ? validation.results.filter(isRecord) : []
        const summary = results.length === 1 && typeof results[0].summary === 'string'
            ? results[0].summary
            : validation.summary
        lines.push(`  Project validation ${String(validation.status).toUpperCase()}: ${summary}`)
        if (results.length > 1) {
            for (const result of results) {
                if (!isRecord(result) || typeof result.summary !== 'string') continue
                lines.push(`    ${String(result.status).toUpperCase()}: ${result.summary}`)
            }
        }
        return lines
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

function projectValidationReport(outcome: CheckOutcome): Record<string, unknown> | undefined {
    if (outcome.name !== 'Playable' || !isRecord(outcome.report)) return undefined
    const value = outcome.report.projectValidation
    return isRecord(value) && ['pass', 'fail'].includes(String(value.status)) && typeof value.summary === 'string'
        ? value
        : undefined
}

const outcomeNames: CheckOutcome['name'][] = ['Playable', 'Editable', 'Persisted']

interface RuntimeCheckResult {
    mode: 'editor' | 'headless' | 'unavailable' | 'static'
    outcomes: CheckOutcome[]
}

async function runRuntimeChecks(root: string): Promise<RuntimeCheckResult> {
    const connection = await runningDevConnection(root)
    if (connection) {
        const editor = await requestEditorCheck(connection)
        if (editor.result) return editor.result
        return runHeadlessCheck(root, editor.incompatible ? undefined : connection)
    }
    return runHeadlessCheck(root, connection)
}

async function requestEditorCheck(connection: DevConnection): Promise<{
    result?: RuntimeCheckResult
    incompatible?: boolean
}> {
    let response: Response
    try {
        response = await fetch(new URL('/api/check', connection.url), {
            method: 'POST',
            headers: {'X-Kite3D-Token': connection.token, 'X-Kite3D-Client': 'kite3d-check'},
        })
    } catch {
        return {}
    }
    if (response.status === 404) return incompatibleEditorCheck()
    let payload: unknown
    try {
        payload = await response.json()
    } catch {
        return incompatibleEditorCheck()
    }
    if (response.status === 409
        && isRecord(payload)
        && isRecord(payload.error)
        && payload.error.code === 'editor_not_connected') return {}
    if (!response.ok) throw new Error(`The open editor check failed with status ${response.status}.`)
    return {result: parseRuntimeCheckResult(payload, 'editor')}
}

function incompatibleEditorCheck(): {incompatible: true} {
    console.warn('[kite3d] Restart kite3d dev to enable editor-hosted checks; using the headless check instead.')
    return {incompatible: true}
}

async function runHeadlessCheck(
    root: string,
    existing?: DevConnection,
): Promise<RuntimeCheckResult> {
    try {
        return await runWithHeadlessChromium(root, {connection: existing}, async (browser, connection) => {
            const page = await browser.newPage()
            const url = new URL(connection.url)
            url.searchParams.set('headless', 'check')
            url.searchParams.set('frames', '30')
            await page.goto(url.href, {waitUntil: 'domcontentloaded', timeout: 30_000})
            await page.waitForFunction('window.__kite3dCheckDone === true', undefined, {timeout: 45_000})
            const payload = await page.evaluate('window.__kite3dCheckResult')
            return parseRuntimeCheckResult(payload, 'headless')
        })
    } catch (error) {
        if (error instanceof HeadlessBrowserUnavailableError) {
            return unavailableOutcomes(`${error.message.replace(/\. Run npx playwright install chromium\.$/, '')}; browser checks were skipped. Run npx playwright install chromium.`)
        }
        const summary = `Headless browser check failed: ${errorMessage(error)}`
        return {mode: 'headless', outcomes: outcomeNames.map((name) => ({name, status: 'fail', summary, codes: []}))}
    }
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
    return `${new Date().toISOString()} [kite3d check] ${outcomes}`
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

function resolvedModulePath(root: string, specifier: string, path: string, isDependency: boolean): string {
    return isDependency ? specifier : relative(root, path).replaceAll('\\', '/')
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
