import {parse, ParseError} from 'jsonc-parser'

export const settingsKey = 'kite3d'
export const assetUrlPrefix = `/${settingsKey}/`
export const REMOVED_GENERATOR_GUIDANCE = 'Generator components were removed in Kite3D 0.19.0.'

export type JSONValue = string | number | boolean | null | JSONValue[] | {[key: string]: JSONValue}
export type ProjectPackageJSON = Record<string, JSONValue> & {mainScene: string}

export interface AssetsJSONManifest {
    files: Record<string, {
        path: string
        files?: Record<string, string>
    }>
    version: number
}

export function createProjectAssetURLModifier(base: URL, assets: AssetsJSONManifest) {
    const assetIdPrefix = `${assetUrlPrefix}@`
    return (url: string): string => {
        if (url.startsWith(assetIdPrefix)) {
            const request = new URL(url, 'https://kite3d.invalid')
            const relative = decodeURIComponent(request.pathname.slice(assetIdPrefix.length))
            const slash = relative.indexOf('/')
            const id = slash < 0 ? relative : relative.slice(0, slash)
            const assetPath = slash < 0 ? '' : relative.slice(slash + 1)
            const asset = assets.files[id]
            if (!asset?.path) throw new Error(`Unknown asset id in URL: ${id}`)
            const registered = asset.files?.[assetPath]
            if (registered) return new URL(registered, base).href
            if (asset.files) throw new Error(`Unknown file for asset ${id}: ${assetPath}`)
            if (/^f\.[^/]+$/i.test(assetPath)) return new URL(asset.path, base).href
            return new URL(assetPath, new URL(asset.path, base)).href
        }
        if (url.startsWith(assetUrlPrefix)) {
            return new URL(url.slice(assetUrlPrefix.length), base).href
        }
        return url
    }
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

/** A configured script or plugin is package-backed only when it names a declared dependency exactly. */
export function isDependencyModuleSpecifier(
    specifier: string,
    packageJson: ProjectPackageJSON,
): boolean {
    const dependencies = packageJson.dependencies
    return isRecord(dependencies) && Object.prototype.hasOwnProperty.call(dependencies, specifier)
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

/** Find nodes that still carry the component removed in Kite3D 0.19.0. */
export function findRemovedGeneratorNodes(text: string): Array<{nodeIndex: number, nodeName: string}> {
    const document = JSON.parse(text) as {
        nodes?: Array<{
            name?: unknown
            extras?: {EntityComponentPlugin?: Record<string, {type?: unknown}>}
        }>
    }
    const nodes: Array<{nodeIndex: number, nodeName: string}> = []
    for (const [nodeIndex, node] of (document.nodes || []).entries()) {
        const components = Object.values(node.extras?.EntityComponentPlugin || {})
        if (!components.some(({type}) => type === 'Generator')) continue
        nodes.push({
            nodeIndex,
            nodeName: typeof node.name === 'string' && node.name.trim() ? node.name : `Node ${nodeIndex}`,
        })
    }
    return nodes
}

export function removedGeneratorMessage(nodeName: string): string {
    return `${REMOVED_GENERATOR_GUIDANCE} Convert ${nodeName} to a build step. See the guide's Authoring rules.`
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
