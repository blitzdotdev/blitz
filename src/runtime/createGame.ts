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
import {
    installGameHooks,
    runtimeCleanupReport,
    type GameValidationFunction,
    type GameValidationReport,
    type RuntimeCleanupReport,
} from '../authoringValidation.ts'
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

export interface CreateGameOptions {
    base: string
    canvas: HTMLCanvasElement
    onError?: (error: unknown) => void
    /** Content hashes for cache-safe project module imports in development. */
    fileRevisions?: Readonly<Record<string, string>>
    /** Identifies one module-graph load so transitive imports bypass the browser module map together. */
    moduleRevision?: string
}

export interface RuntimeProject {
    packageJson: ProjectPackageJSON
    config: ProjectConfigSettings
    assetsManifest: AssetsJSONManifest
    mainScene: string
}

export interface CreatedGame {
    viewer: ThreeViewer
    project: RuntimeProject
    registerGameValidation(fn: GameValidationFunction): () => void
    publishGameTelemetry(value: object): () => void
    runGameValidation(): Promise<GameValidationReport>
    dispose(): RuntimeCleanupReport
}

type ModuleExports = Record<string, unknown>
type RuntimeErrorHandler = (error: unknown) => void

export function createGame(options: CreateGameOptions): Promise<CreatedGame> {
    return createProjectGame(options, true)
}

/** Load the saved project without starting components, physics, the timeline, or main.js. */
export function createStoppedGame(options: CreateGameOptions): Promise<CreatedGame> {
    return createProjectGame(options, false)
}

async function createProjectGame({
    base,
    canvas,
    onError,
    fileRevisions = {},
    moduleRevision,
}: CreateGameOptions, start: boolean): Promise<CreatedGame> {
    const reportError = createErrorReporter(onError)
    let viewer: ThreeViewer | undefined
    let nestedAssets: RuntimeNestedAssetLoader | undefined
    let removeURLModifier: (() => void) | undefined
    let gameHooks: ReturnType<typeof installGameHooks> | undefined

    try {
        const baseUrl = validateBase(base)
        const [packageText, assetsText] = await Promise.all([
            fetchText(new URL('package.json', baseUrl)),
            fetchText(new URL('assets.json', baseUrl)),
        ])
        const packageJson = parsePackageJSON(packageText)
        const config = await parsePackageJsonSettingsConfig(packageJson)
        const assetsManifest = parseAssetsJSONManifest(assetsText)
        const project: RuntimeProject = {
            packageJson,
            config,
            assetsManifest,
            mainScene: packageJson.mainScene,
        }

        const entityComponents = new EntityComponentPlugin(false)
        const physics = new CannonPhysicsPlugin(true, false)
        EntityComponentPlugin.AddObjectUiConfig = false
        window.MeshoptDecoder = MeshoptDecoder

        viewer = new ThreeViewer({
            canvas,
            ...config.viewer,
            assetManager: {
                simpleCache: false,
                storage: false,
            },
            plugins: [
                entityComponents,
                new GBufferPlugin(),
                physics,
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
        gameHooks = installGameHooks()
        entityComponents.addComponentType(HtmlUiComponent)

        // Three's LoadingManager delegates through this importer hook. It covers
        // glTF buffers/textures and nested imports without patching global fetch.
        const urlModifier = createProjectAssetURLModifier(baseUrl, assetsManifest)
        viewer.assetManager.importer.addURLModifier(urlModifier)
        removeURLModifier = () => viewer?.assetManager.importer.removeURLModifier(urlModifier)

        nestedAssets = new RuntimeNestedAssetLoader(viewer, reportError)

        await registerProjectScripts(viewer, project, baseUrl, fileRevisions, moduleRevision)
        await registerProjectPlugins(viewer, project, baseUrl, fileRevisions, moduleRevision)

        const sceneUrl = new URL(project.mainScene, baseUrl).href
        const loadedScene = await viewer.load(sceneUrl, {importAsModelRoot: true})
        if (!loadedScene?.isObject3D) {
            throw new Error(`The main scene did not load as an Object3D: ${sceneUrl}`)
        }
        await nestedAssets.loadObjectDependencies(loadedScene as IObject3D)
        await nestedAssets.waitForPending()

        if (start) {
            viewer.timeline.reset()
            viewer.timeline.start()
            entityComponents.start()
            physics.running = true

            const mainUrl = versionedProjectUrl('main.js', baseUrl, fileRevisions, moduleRevision)
            const mainModule = await importModule(mainUrl.href)
            if (mainModule.main !== undefined) {
                if (typeof mainModule.main !== 'function') {
                    throw new Error('main.js export "main" must be a function')
                }
                await mainModule.main({viewer})
            }
        }

        const readyViewer = viewer
        let disposed = false
        let cleanupReport: RuntimeCleanupReport | undefined
        return {
            viewer: readyViewer,
            project,
            registerGameValidation: gameHooks.registerGameValidation,
            publishGameTelemetry: gameHooks.publishGameTelemetry,
            runGameValidation: gameHooks.runGameValidation,
            dispose() {
                if (disposed) return cleanupReport!
                disposed = true
                entityComponents.stop()
                physics.running = false
                readyViewer.timeline.stop()
                cleanupReport = runtimeCleanupReport(readyViewer)
                nestedAssets?.dispose()
                removeURLModifier?.()
                gameHooks?.dispose()
                readyViewer.dispose()
                return cleanupReport
            },
        }
    } catch (error) {
        nestedAssets?.dispose()
        removeURLModifier?.()
        gameHooks?.dispose()
        viewer?.dispose()
        reportError(error)
        throw error
    }
}

async function registerProjectPlugins(
    viewer: ThreeViewer,
    project: RuntimeProject,
    base: URL,
    fileRevisions: Readonly<Record<string, string>>,
    moduleRevision?: string,
) {
    const {config, packageJson} = project
    for (const definition of config.plugins) {
        if (definition.active === false) continue
        const specifier = resolvePluginSpecifier(definition, packageJson, base, fileRevisions, moduleRevision)
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
    fileRevisions: Readonly<Record<string, string>>,
    moduleRevision?: string,
) {
    const {config, packageJson} = project
    const modules: ModuleExports[] = []
    for (const definition of config.scripts) {
        if (definition.active === false) continue
        const specifier = isDependencyModuleSpecifier(definition.import, packageJson)
            ? definition.import
            : versionedProjectUrl(definition.import, base, fileRevisions, moduleRevision).href
        modules.push(await importModule(specifier))
    }
    await registerScripts(viewer, modules)
}

function resolvePluginSpecifier(
    definition: ExternalPlugin,
    packageJson: ProjectPackageJSON,
    base: URL,
    fileRevisions: Readonly<Record<string, string>>,
    moduleRevision?: string,
) {
    const isDependency = isDependencyModuleSpecifier(definition.import, packageJson)
    if (isDependency) return definition.import
    return versionedProjectUrl(definition.import, base, fileRevisions, moduleRevision).href
}

function versionedProjectUrl(
    path: string,
    base: URL,
    fileRevisions: Readonly<Record<string, string>>,
    moduleRevision?: string,
): URL {
    const url = assertSameOrigin(new URL(path, base), base)
    const normalized = path.replace(/^\.\//, '')
    const revision = fileRevisions[normalized]
    if (revision) url.searchParams.set('v', revision)
    if (moduleRevision) url.searchParams.set('r', moduleRevision)
    return url
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
