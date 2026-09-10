import {parse, ParseError} from 'jsonc-parser'

export const settingsKey = 'blitz'
export const assetUrlPrefix = `/${settingsKey}/`

export type JSONValue = string | number | boolean | null | JSONValue[] | {[key: string]: JSONValue}
export type ProjectPackageJSON = Record<string, JSONValue> & {mainScene: string}

export interface ProjectGeneratorState {
    componentId: string
    module: string
    nodeIndex: number
    nodeName: string
    params: Record<string, unknown>
}

export interface AssetsJSONManifest {
    files: Record<string, {
        path: string
    }>
    version: number
}

export interface ProjectDependency {
    key: string
    version: string
    url?: string
}

export interface ExternalPlugin {
    import: string
    /** @default `default` */
    className?: string
    /** @default true */
    active?: boolean
    /** Constructor parameters. */
    params?: JSONValue[]
}

export interface ExternalScript {
    import: string
    /** @default true */
    active?: boolean
}

export interface ProjectViewerSettings {
    msaa?: boolean
    rgbm?: boolean
    zPrepass?: boolean
    renderScale?: number | 'auto'
    maxRenderScale?: number
    backgroundColor?: string | number | null
    modelRootScale?: number
    stencil?: boolean
    debug?: boolean
    tonemap?: boolean
    camera?: {
        type?: 'perspective' | 'orthographic'
        controlsMode?: string
        position?: [number, number, number]
        target?: [number, number, number]
    }
    maxHDRIntensity?: number
    powerPreference?: 'default' | 'high-performance' | 'low-power'
}

export interface ProjectConfigSettings {
    plugins: ExternalPlugin[]
    scripts: ExternalScript[]
    dependencies: ProjectDependency[]
    viewer: ProjectViewerSettings
}

export interface ProjectConfigSettingsJSON {
    plugins?: (ExternalPlugin | string)[]
    imports?: Record<string, string>
    scripts?: (ExternalScript | string)[]
    viewer?: ProjectViewerSettings
}

export function parsePackageJSON(text: string): ProjectPackageJSON {
    const json = parse(text) as unknown
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
        throw new Error('Invalid package.json file: expected an object')
    }
    const packageJson = json as ProjectPackageJSON
    if (typeof packageJson.mainScene !== 'string' || !packageJson.mainScene.toLowerCase().endsWith('.gltf')) {
        throw new Error('package.json mainScene must name a text .gltf file')
    }
    return packageJson
}

export function parseAssetsJSONManifest(text: string): AssetsJSONManifest {
    const json = parse(text) as AssetsJSONManifest

    if (json.files && typeof json.files !== 'object') {
        throw new Error('Invalid assets.json file: files should be an object')
    }
    if (json.version !== undefined && typeof json.version !== 'number') {
        throw new Error('Invalid assets.json file: version should be a number')
    }

    if (!json.files) json.files = {}
    if (!json.version) json.version = 1

    return json
}

export function validateSceneSource(path: string, text: string): void {
    const document = JSON.parse(text) as {asset?: unknown}
    if (!document || typeof document !== 'object' || !document.asset) {
        throw new Error(`${path} is not a JSON glTF document`)
    }
}

export function readProjectGeneratorStates(text: string): ProjectGeneratorState[] {
    try {
        const document = JSON.parse(text) as {
            nodes?: Array<{
                name?: unknown
                extras?: {EntityComponentPlugin?: Record<string, {type?: unknown, state?: unknown}>}
            }>
        }
        const generators: ProjectGeneratorState[] = []
        for (const [nodeIndex, node] of (document.nodes || []).entries()) {
            for (const [componentId, component] of Object.entries(node.extras?.EntityComponentPlugin || {})) {
                if (component.type !== 'Generator' || !isRecord(component.state)) continue
                generators.push({
                    componentId,
                    module: typeof component.state.module === 'string' ? component.state.module : '',
                    nodeIndex,
                    nodeName: typeof node.name === 'string' ? node.name : `Node ${nodeIndex}`,
                    params: isRecord(component.state.params) ? component.state.params : {},
                })
            }
        }
        return generators
    } catch {
        return []
    }
}

export function updateProjectGeneratorState(
    text: string,
    generator: Pick<ProjectGeneratorState, 'componentId' | 'nodeIndex' | 'nodeName'>,
    update: Partial<Pick<ProjectGeneratorState, 'module' | 'params'>>,
): {text: string, state: Record<string, unknown>} {
    const document = JSON.parse(text) as {
        nodes?: Array<{extras?: {EntityComponentPlugin?: Record<string, {state?: unknown}>}}>
    }
    const state = document.nodes?.[generator.nodeIndex]?.extras?.EntityComponentPlugin?.[generator.componentId]?.state
    if (!isRecord(state)) throw new Error(`Generator component is missing on ${generator.nodeName}`)
    Object.assign(state, update)
    return {text: JSON.stringify(document, null, 2), state}
}

export async function parsePackageJsonSettingsConfig(json: ProjectPackageJSON, _project?: unknown): Promise<ProjectConfigSettings> {
    const config = (json[settingsKey] ?? {}) as ProjectConfigSettingsJSON
    const dependencies: ProjectDependency[] = []
    const packageDependencies = json.dependencies && typeof json.dependencies === 'object' && !Array.isArray(json.dependencies)
        ? json.dependencies as Record<string, string>
        : {}
    const deps: Record<string, string> = {
        ...packageDependencies,
    }

    dependencies.push(...Object.entries(deps).map(([key, version]) => ({key, version})))

    if (config.imports) {
        dependencies.push(...Object.entries(config.imports).map(([key, url]) => ({
            key,
            url: !url.startsWith('@') ? url : undefined,
            version: url.startsWith('@') ? url.slice(1) : '',
        })))
    }

    const plugins = config.plugins?.map((entry) => {
        if (typeof entry !== 'string') return entry

        const match = entry.match(/\((.*)\)$/)
        let params: JSONValue[] | undefined
        let spec = entry

        if (match) {
            const paramString = match[1].trim()
            spec = entry.slice(0, match.index).trim()
            if (paramString) {
                try {
                    const errors: ParseError[] = []
                    params = parse(`[${paramString}]`, errors)
                    if (!Array.isArray(params) || errors.length) {
                        console.error(errors)
                        throw new Error('Plugin params is not a valid array')
                    }
                } catch (error) {
                    console.error('Unable to parse plugin params, skipping plugin', entry, paramString, error)
                    return null
                }
            }
        }

        const separator = spec.lastIndexOf(':')
        return {
            import: separator !== -1 ? spec.slice(0, separator) : spec,
            className: separator !== -1 ? spec.slice(separator + 1) : undefined,
            params,
        } satisfies ExternalPlugin
    }) || []

    const scripts = config.scripts?.map((entry) =>
        typeof entry === 'string' ? {import: entry} : entry
    ) || []

    return {
        plugins: plugins.filter(Boolean) as ExternalPlugin[],
        scripts,
        dependencies,
        viewer: config.viewer || {},
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
