import {execFile} from 'node:child_process'
import {createRequire} from 'node:module'
import {mkdir, readFile, stat, writeFile} from 'node:fs/promises'
import {resolve, sep} from 'node:path'
import {promisify} from 'node:util'
import {parsePackageJSON, parsePackageJsonSettingsConfig} from '@blitzdev/engine/projectFormat'

export interface CheckRow {
    kind: 'project' | 'script' | 'plugin' | 'generator' | 'component'
    path: string
    status: 'pass' | 'fail'
    detail: string
}

export interface CheckResult {
    ok: boolean
    checkedAt: string
    componentTypes: string[]
    rows: CheckRow[]
}

const BUILT_IN_COMPONENT_TYPES = new Set([
    'Cannon3DBodyComponent',
    'Cannon3DShapeComponent',
    'CannonRagdollComponent',
    'Generator',
    'HtmlUiComponent',
])
const execute = promisify(execFile)
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

    const result: CheckResult = {
        ok: rows.every(({status}) => status === 'pass'),
        checkedAt: new Date().toISOString(),
        componentTypes: [...registeredTypes].sort(),
        rows,
    }
    await mkdir(resolve(root, '.blitz'), {recursive: true})
    await writeFile(resolve(root, '.blitz/check.json'), `${JSON.stringify(result, null, 2)}\n`, {mode: 0o600})
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
    return [line(headings), ...values.map(line), `Check ${result.ok ? 'passed' : 'failed'} (${result.rows.length} row(s)).`].join('\n')
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
