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
import {registerScripts} from '../scripts.ts'
import {HtmlUiComponent} from '../plugins/HtmlUiComponent.ts'
import {GeneratorComponent} from '../plugins/GeneratorComponent.ts'
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
    assetUrlPrefix,
    AssetsJSONManifest,
    ExternalPlugin,
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

export async function createGame({base, canvas, onError, fileRevisions = {}}: CreateGameOptions): Promise<CreatedGame> {
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
                new GLTFMeshOptDecodePlugin(),
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
        entityComponents.addComponentType(GeneratorComponent)
        GeneratorComponent.configureViewer(viewer, {base: baseUrl, onError: reportError})

        // Three's LoadingManager delegates through this importer hook. It covers
        // glTF buffers/textures and nested imports without patching global fetch.
        const urlModifier = createURLModifier(baseUrl, assetsManifest)
        viewer.assetManager.importer.addURLModifier(urlModifier)
        removeURLModifier = () => viewer?.assetManager.importer.removeURLModifier(urlModifier)

        nestedAssets = new RuntimeNestedAssetLoader(viewer, reportError)

        await registerProjectPlugins(viewer, config, baseUrl, fileRevisions)
        await registerProjectScripts(viewer, config, baseUrl, fileRevisions)

        const sceneUrl = new URL(project.mainScene, baseUrl).href
        const loadedScene = await viewer.load(sceneUrl, {importAsModelRoot: true})
        if (!loadedScene?.isObject3D) {
            throw new Error(`The main scene did not load as an Object3D: ${sceneUrl}`)
        }
        await nestedAssets.loadObjectDependencies(loadedScene as IObject3D)
        await nestedAssets.waitForPending()
        await GeneratorComponent.waitForViewer(viewer)

        viewer.timeline.reset()
        viewer.timeline.start()
        entityComponents.start()
        physics.running = true

        const mainUrl = versionedProjectUrl('main.js', baseUrl, fileRevisions)
        const mainModule = await importModule(mainUrl.href)
        if (mainModule.main !== undefined) {
            if (typeof mainModule.main !== 'function') {
                throw new Error('main.js export "main" must be a function')
            }
            await mainModule.main({viewer})
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
    config: ProjectConfigSettings,
    base: URL,
    fileRevisions: Readonly<Record<string, string>>,
) {
    for (const definition of config.plugins) {
        if (definition.active === false) continue
        const specifier = resolvePluginSpecifier(definition, config, base, fileRevisions)
        const module = await importModule(specifier)
        const plugin = findPluginExport(module, definition)
        if (viewer.getPlugin(plugin)) continue
        await viewer.addPlugin(plugin, ...(definition.params || []))
    }
}

async function registerProjectScripts(
    viewer: ThreeViewer,
    config: ProjectConfigSettings,
    base: URL,
    fileRevisions: Readonly<Record<string, string>>,
) {
    const modules: ModuleExports[] = []
    for (const definition of config.scripts) {
        if (definition.active === false) continue
        const scriptUrl = versionedProjectUrl(definition.import, base, fileRevisions)
        modules.push(await importModule(scriptUrl.href))
    }
    await registerScripts(viewer, modules)
}

function createURLModifier(base: URL, assets: AssetsJSONManifest) {
    const assetIdPrefix = `${assetUrlPrefix}@`
    return (url: string): string => {
        if (url.startsWith(assetIdPrefix)) {
            const id = url.slice(assetIdPrefix.length).split('/', 1)[0]
            const asset = assets.files[id]
            if (!asset?.path) throw new Error(`Unknown asset id in URL: ${id}`)
            return new URL(asset.path, base).href
        }
        if (url.startsWith(assetUrlPrefix)) {
            return new URL(url.slice(assetUrlPrefix.length), base).href
        }
        return url
    }
}

function resolvePluginSpecifier(
    definition: ExternalPlugin,
    config: ProjectConfigSettings,
    base: URL,
    fileRevisions: Readonly<Record<string, string>>,
) {
    const isDependency = config.dependencies.some(({key}) =>
        definition.import === key || definition.import.startsWith(`${key}/`)
    )
    if (isDependency) return definition.import
    return versionedProjectUrl(definition.import, base, fileRevisions).href
}

function versionedProjectUrl(path: string, base: URL, fileRevisions: Readonly<Record<string, string>>): URL {
    const url = assertSameOrigin(new URL(path, base), base)
    const normalized = path.replace(/^\.\//, '')
    const revision = fileRevisions[normalized]
    if (revision) url.searchParams.set('v', revision)
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
        if (!onError) {
            console.error('[blitz] Runtime error', error)
            return
        }
        onError(error)
    }
}
