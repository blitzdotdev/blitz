import {
    Class,
    EntityComponentPlugin,
    GBufferPlugin,
    GLTFAnimationPlugin,
    GLTFMeshOptDecodePlugin,
    IObject3D,
    IViewerPlugin,
    KTX2LoadPlugin,
    KTXLoadPlugin,
    PLYLoadPlugin,
    PopmotionPlugin,
    Rhino3dmLoadPlugin,
    STLLoadPlugin,
    ThreeViewer,
    USDZLoadPlugin,
} from 'threepipe'
import {MeshoptDecoder} from 'meshoptimizer'
import {registerScripts} from '../scripts.ts'
import {HtmlUiComponent} from '../plugins/HtmlUiComponent.ts'
import {CannonPhysicsPlugin} from '../plugins/cannon/CannonPhysicsPlugin.ts'
import {RuntimeNestedAssetLoader} from './nestedAssets.ts'
import {
    AssetsJSONManifest,
    createProjectAssetURLModifier,
    ExternalPlugin,
    isDependencyModuleSpecifier,
    parseAssetsJSONManifest,
    parsePackageJSON,
    parsePackageJsonSettingsConfig,
    ProjectPackageJSON,
    ProjectConfigSettings,
} from './projectFormat.ts'

export interface StartGameOptions {
    base: string
}

export interface CreateGameOptions extends StartGameOptions {
    canvas: HTMLCanvasElement
    onError?: (error: unknown) => void
}

export interface RuntimeProject {
    packageJson: ProjectPackageJSON
    config: ProjectConfigSettings
    assetsManifest: AssetsJSONManifest
    mainScene: string
}

export interface RunningGame {
    stop(): Promise<void>
}

export interface CreatedGame {
    viewer: ThreeViewer
    project: RuntimeProject
    dispose(): Promise<void>
}

type ModuleExports = Record<string, unknown>
type RuntimeErrorHandler = (error: unknown) => void

/**
 * Runs a project on a viewer that already holds its scene: the project's scripts and plugins,
 * the timeline, the components, physics, and `main({viewer})`. The editor runs Play with this.
 */
export async function startGame(
    viewer: ThreeViewer,
    project: RuntimeProject,
    options: StartGameOptions,
): Promise<RunningGame> {
    const base = new URL(options.base, window.location.href)
    // Throws when the viewer has no EntityComponentPlugin, so the lookups below have one.
    await registerProjectScripts(viewer, project, base)
    await registerProjectPlugins(viewer, project, base)

    viewer.timeline.reset()
    viewer.timeline.start()
    viewer.getPlugin(EntityComponentPlugin)!.start()
    const physics = viewer.getPlugin(CannonPhysicsPlugin)
    if (physics) physics.running = true

    let cleanup: unknown
    const stop = async () => {
        if (typeof cleanup === 'function') await cleanup()
        if (physics) physics.running = false
        viewer.getPlugin(EntityComponentPlugin)!.stop()
        viewer.timeline.stop()
        viewer.timeline.reset()
    }

    try {
        const mainPath = typeof project.packageJson.main === 'string' ? project.packageJson.main : './main.js'
        const {main} = await importModule(projectUrl(mainPath, base).href)
        if (main !== undefined && typeof main !== 'function') {
            throw new Error(`${mainPath} export "main" must be a function`)
        }
        cleanup = await main?.({viewer})
    } catch (error) {
        // The clock, the components and physics are already going, and a throw here hands the
        // caller no RunningGame to stop them with.
        await stop()
        throw error
    }

    return {stop}
}

export async function createGame(options: CreateGameOptions): Promise<CreatedGame> {
    const reportError = createErrorReporter(options.onError)
    let viewer: ThreeViewer | undefined
    let nested: RuntimeNestedAssetLoader | undefined

    try {
        const base = validateBase(options.base)
        const project = await loadRuntimeProject(base)
        viewer = createViewer(options.canvas, project)
        // Three's LoadingManager delegates through this importer hook. It covers
        // glTF buffers/textures and nested imports without patching global fetch.
        viewer.assetManager.importer.addURLModifier(createProjectAssetURLModifier(base, project.assetsManifest))
        nested = new RuntimeNestedAssetLoader(viewer, reportError)

        // The project's component types have to exist before the scene loads. A node whose
        // component type is unknown at load keeps a placeholder that never becomes the real
        // component, so its script never runs. startGame skips what is registered here.
        await registerProjectScripts(viewer, project, base)
        await registerProjectPlugins(viewer, project, base)

        const sceneUrl = new URL(project.mainScene, base).href
        const root = await viewer.load(sceneUrl, {importAsModelRoot: true})
        if (!root?.isObject3D) throw new Error(`The main scene did not load as an Object3D: ${sceneUrl}`)
        await nested.loadObjectDependencies(root as IObject3D)
        await nested.waitForPending()

        const running = await startGame(viewer, project, options)
        const readyViewer = viewer
        const readyNested = nested
        return {
            viewer: readyViewer,
            project,
            async dispose() {
                await running.stop()
                readyNested.dispose()
                readyViewer.dispose()
            },
        }
    } catch (error) {
        nested?.dispose()
        viewer?.dispose()
        reportError(error)
        throw error
    }
}

async function loadRuntimeProject(base: URL): Promise<RuntimeProject> {
    const [packageText, assetsText] = await Promise.all([
        fetchText(new URL('package.json', base)),
        fetchText(new URL('assets.json', base)),
    ])
    const packageJson = parsePackageJSON(packageText)
    return {
        packageJson,
        config: await parsePackageJsonSettingsConfig(packageJson),
        assetsManifest: parseAssetsJSONManifest(assetsText),
        mainScene: packageJson.mainScene,
    }
}

function createViewer(canvas: HTMLCanvasElement, project: RuntimeProject): ThreeViewer {
    const entityComponents = new EntityComponentPlugin(false)
    EntityComponentPlugin.AddObjectUiConfig = false
    window.MeshoptDecoder = MeshoptDecoder

    const viewer = new ThreeViewer({
        canvas,
        ...project.config.viewer,
        assetManager: {
            simpleCache: false,
            storage: false,
        },
        plugins: [
            entityComponents,
            new GBufferPlugin(),
            new CannonPhysicsPlugin(true, false),
            new PopmotionPlugin(),
            new GLTFAnimationPlugin(),
            new GLTFMeshOptDecodePlugin(false),
            new KTX2LoadPlugin(),
            new KTXLoadPlugin(),
            new PLYLoadPlugin(),
            new Rhino3dmLoadPlugin(),
            new STLLoadPlugin(),
            new USDZLoadPlugin(),
        ],
    })
    viewer.timeline.endTime = 0
    entityComponents.addComponentType(HtmlUiComponent)
    return viewer
}

async function registerProjectPlugins(
    viewer: ThreeViewer,
    project: RuntimeProject,
    base: URL,
) {
    const {config, packageJson} = project
    for (const definition of config.plugins) {
        if (definition.active === false) continue
        const specifier = resolvePluginSpecifier(definition, packageJson, base)
        const module = await importModule(specifier)
        const plugin = findPluginExport(module, definition)
        if (viewer.getPlugin(plugin)) continue
        await viewer.addPlugin(plugin, ...(definition.params || []))
    }
}

async function registerProjectScripts(
    viewer: ThreeViewer,
    project: RuntimeProject,
    base: URL,
) {
    const {config, packageJson} = project
    const modules: ModuleExports[] = []
    for (const definition of config.scripts) {
        if (definition.active === false) continue
        const specifier = isDependencyModuleSpecifier(definition.import, packageJson)
            ? definition.import
            : projectUrl(definition.import, base).href
        modules.push(await importModule(specifier))
    }
    await registerScripts(viewer, modules)
}

function resolvePluginSpecifier(
    definition: ExternalPlugin,
    packageJson: ProjectPackageJSON,
    base: URL,
) {
    const isDependency = isDependencyModuleSpecifier(definition.import, packageJson)
    if (isDependency) return definition.import
    return projectUrl(definition.import, base).href
}

function projectUrl(path: string, base: URL): URL {
    return assertSameOrigin(new URL(path, base), base)
}

function findPluginExport(module: ModuleExports, definition: ExternalPlugin): Class<IViewerPlugin> {
    const requested = definition.className || 'default'
    const selected = module[requested]
    if (isPluginType(selected)) return selected

    if (!definition.className) {
        const candidates = Object.values(module).filter(isPluginType)
        if (candidates.length === 1) return candidates[0]
    }
    throw new Error(`Cannot find plugin export "${requested}" in ${definition.import}`)
}

function isPluginType(value: unknown): value is Class<IViewerPlugin> {
    return typeof value === 'function'
        && typeof (value as unknown as {PluginType?: unknown}).PluginType === 'string'
}

async function importModule(specifier: string): Promise<ModuleExports> {
    return import(/* @vite-ignore */ specifier) as Promise<ModuleExports>
}

async function fetchText(url: URL): Promise<string> {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Failed to fetch ${url.href}: ${response.status} ${response.statusText}`)
    return response.text()
}

function validateBase(base: string): URL {
    if (!base.endsWith('/')) throw new Error('createGame base must end in "/"')
    const url = new URL(base)
    if (!url.protocol.startsWith('http')) throw new Error('createGame base must be an absolute HTTP(S) URL')
    return url
}

function assertSameOrigin(url: URL, base: URL): URL {
    if (url.origin !== base.origin) {
        throw new Error(`Project modules must be same-origin: ${url.href}`)
    }
    return url
}

function createErrorReporter(onError?: RuntimeErrorHandler) {
    return (error: unknown) => {
        console.error('[kite3d] Runtime error', error)
        onError?.(error)
    }
}
