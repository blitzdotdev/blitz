import {PackageDependency} from "./importMaps.ts";
import {getFileHandle} from "./fsApi.ts";
import {browserFileStore} from "./BrowserFileStore.ts";
import {parse, ParseError} from "jsonc-parser";

export const settingsKey = "kite"
export const assetUrlPrefix = '/' + settingsKey + '/'

const packageFilePath = 'package.json'
const iconFilePath = 'icon.svg'
const assetsDirPath = 'assets/'
export const mainScenePath = `${assetsDirPath}main.scene.glb`

export interface SavedSceneFile {
    path: string,
    file: File /*| string*/
    assets?: string,
    lastModified: number
    preview?: File | string
    scene?: File
    handle?: FileSystemDirectoryHandle
    // viewerConfig?: File | string | any // todo
}


export interface AssetsJSONManifest{
    files: Record<string, { // id to files meta
        path: string,
    }>
    version: number,
}

export function parseAssetsJSONManifest(text: any): AssetsJSONManifest{
    const json = parse(text) as AssetsJSONManifest

    if(json.files && typeof json.files !== 'object'){
        throw new Error('Invalid assets.json file: files should be an object')
    }
    if(json.version !== undefined && typeof json.version !== 'number'){
        throw new Error('Invalid assets.json file: version should be a number')
    }

    if(!json.files) {
        json.files = {}
    }
    if(!json.version){
        json.version = 1
    }

    return json
}

export interface LoadedProject extends SavedSceneFile {
    settings?: {
        mainScene: string|null // path in project
        json: any
        config: ProjectConfigSettings
        assetsJson: any
    }
    assetsManifest?: AssetsJSONManifest
}

export interface ExternalPlugin{
    // id: string,
    import: string,
    /**
     * @default `default`
     */
    className?: string,
    /**
     * @default true
     */
    active?: boolean,
    /**
     * Constructor parameters
     */
    params?: any[]

    // /**
    //  * to be able to disable running the plugin at runtime
    //  * not implemented
    //  * @default true
    //  */
    // runtime?: boolean,
    // /**
    //  * to be able to disable the plugin in the editor
    //  * @default true
    //  */
    // editor?: boolean
}

export interface ExternalScript{
    // id: string,
    import: string,
    /**
     * @default true
     */
    active?: boolean
}

export interface ProjectConfigSettings{
    plugins: ExternalPlugin[]
    scripts: ExternalScript[]
    // imports: Record<string, string> // not used, parsed into dependencies
    dependencies: PackageDependency[]
    viewer: {
        msaa?: boolean
    }
}
export interface ProjectConfigSettingsJSON{
    plugins?: (ExternalPlugin | string)[]
    imports?: Record<string, string>
    scripts?: (ExternalScript | string)[]
    viewer?: {
        msaa?: boolean
    }
}

export interface SavedSceneFileMetaStored {
    path: string,
    file: string
    assets?: string,
    lastModified: number
    preview?: string
    handle?: FileSystemDirectoryHandle
    // viewerConfig?: File | string | any // todo
}

export interface SavedSceneFileMeta {
    path: string,
    file: string
    assets?: string,
    lastModified: number
    preview?: File | string
    handle?: FileSystemDirectoryHandle
    // viewerConfig?: File | string | any // todo
}

export const STORE_NAME = 'file_data_store'
export const FILE_META_KEY = 'meta'

export async function resolveFile(value: string | File, path = '', handle?: SavedSceneFileMetaStored['handle']) {
    if (!path.endsWith('/')) path += '/'

    let res: any = value
    if (typeof value === 'string' && value.startsWith(STORE_NAME + ':')) {
        const path1 = value.slice(STORE_NAME.length + 1).replace(/^\.\//, path)
        res = await browserFileStore.get(path1)
    }
    if (res === value && typeof value === 'string' && handle) {
        let permission = await handle.queryPermission({mode: 'readwrite'})
        if (permission !== 'granted') {
            permission = await handle.requestPermission({mode: 'readwrite'})
        }
        if (permission !== 'granted') {
            console.error('no permission to access the file')
            alert('no permission to access the file' + value + path)
        } else {
            const handles = await getFileHandle(handle, value, false)
            const file = await handles?.fileHandle?.getFile()
            if (file) res = file
        }
    }
    return res as File | any
}

export async function createMeta(name: string, handle: FileSystemDirectoryHandle) {
    const meta1 = {
        path: name.replace(/\/$/, '').split('/').pop() || '',
        lastModified: Date.now(),
        file: packageFilePath,
        preview: iconFilePath,
        assets: assetsDirPath,
        handle,
    }
    if(!meta1.path){
        throw new Error('Invalid project name')
    }
    if (!meta1.path.endsWith('/')) meta1.path += '/'
    await browserFileStore.put(meta1, meta1.path + FILE_META_KEY)
    return meta1
}

export async function getMeta(path: string): Promise<SavedSceneFileMetaStored | undefined> {
    const metaKey = FILE_META_KEY
    return (await resolveFile(STORE_NAME + ':./' + metaKey, path)) as SavedSceneFileMetaStored | undefined
}

export async function getMetaWithPreview(path: string): Promise<SavedSceneFileMeta | undefined> {
    const meta = await getMeta(path)
    if (!meta) return
    if (meta.preview) meta.preview = await resolveFile(meta.preview, path, meta.handle)
    return meta
}


export async function initProjectHandles(meta: SavedSceneFileMeta | SavedSceneFileMetaStored){
    if(!meta.handle) throw new Error('No handle to check project init')
    const handle = meta.handle
    // @ts-ignore
    const packageFileHandle = await handle.getFileHandle(typeof meta.file === 'string' ? meta.file : meta.file.name).catch((e) => {
        // todo handle if there is dir with same name
        // if(e.name === "NotFoundError") return null
        if(e.name === "TypeMismatchError") {
            throw new Error('A directory with the name "package.json" exists in the project folder, cannot continue')
        }
        return undefined
    })
    const mainJsHandle = await handle.getFileHandle('main.js').catch((e) => {
        // todo handle if there is dir with same name
        // if(e.name === "NotFoundError") return null
        if(e.name === "TypeMismatchError") {
            throw new Error('A directory with the name "main.js" exists in the project folder, cannot continue')
        }
        return undefined
    })
    const assetsJsonHandle = await handle.getFileHandle('assets.json').catch((e) => {
        // todo handle if there is dir with same name
        // if(e.name === "NotFoundError") return null
        if(e.name === "TypeMismatchError") {
            throw new Error('A directory with the name "assets.json" exists in the project folder, cannot continue')
        }
        return undefined
    })
    return {
        base: handle,
        package: {
            handle: packageFileHandle,
            file: await packageFileHandle?.getFile(),
        }, mainJs: {
            handle: mainJsHandle,
            file: await mainJsHandle?.getFile(),
        }, assetsJson: {
            handle: assetsJsonHandle,
            file: await assetsJsonHandle?.getFile(),
        }
    }
}

export async function parsePackageJsonSettings(file: File, project: LoadedProject|SavedSceneFileMeta|SavedSceneFileMetaStored){
    try {
        const text = await file.text()
        const json = parse(text)
        if(!json.mainScene){
            json.mainScene = 'assets/main.scene.glb'
        }
        const configParse: ProjectConfigSettings =  await parsePackageJsonSettingsConfig(json, project)
        return {
            ...project,
            file,
            lastModified: file.lastModified,
            settings: {
                mainScene: json.mainScene,
                json: json,
                config: configParse,
            }
        } as LoadedProject
    }catch (e){
        console.error('ThreeEditor - failed to parse package.json file', e)
        throw new Error('Cannot parse package.json file')
    }
}
export async function parsePackageJsonSettingsConfig(json: any, project: LoadedProject|SavedSceneFileMeta|SavedSceneFileMetaStored){
    const config: ProjectConfigSettingsJSON = json[settingsKey] ?? {}

    const dependencies: PackageDependency[] = []

    const deps: Record<string, string> = {
        ...json['dependencies'] ?? {},
        // ...json['peerDependencies'] ?? {},
        // ...json['optionalDependencies'] ?? {},
    }
    dependencies.push(...Object.entries(deps).map(([k, v])=>({
        key: k,
        version: v,
    })))

    if(config.imports)
        // todo check that url should not be a relative url
        dependencies.push(...Object.entries(config.imports).map(([k, url])=>({
            key: k,
            url: !url.startsWith('@') ? url : undefined,
            version: url.startsWith('@') ? url.slice(1) : '',
        })))

    const plugins = config.plugins?.map(p=>{
        // pluginSpec := importPath [ ":" className ] [ "(" paramList ")" ]
        if(typeof p === 'string') {
            // Match `( ... )` at the end if present
            const match = p.match(/\((.*)\)$/);
            let params: any[] | undefined;
            let spec = p;

            if (match) {
                const paramStr = match[1].trim();
                spec = p.slice(0, match.index).trim();
                if (paramStr) {
                    try {
                        // params = JSON.parse(`[${paramStr}]`);
                        const errors: ParseError[] = []
                        params = parse(`[${paramStr}]`, errors);
                        if(!Array.isArray(params) || errors.length){
                            console.error(errors)
                            throw new Error('Plugin params is not a valid array');
                        }
                    } catch(e) {
                        console.error('Unable to parse plugin params, skipping plugin', p, paramStr, e);
                        return null
                    }
                }
            }

            // Split once on colon, from the right
            const idx = spec.lastIndexOf(":");
            const plugin: ExternalPlugin = {
                import: idx !== -1 ? spec.slice(0, idx) : spec,
                className: idx !== -1 ? spec.slice(idx + 1) : undefined,
                params,
            };
            return plugin;
        }
        else return p
    }) || []
    const scripts = config.scripts?.map(p=>{
        if(typeof p === 'string') return {import: p};
        else return p
    }) || []

    const configParse: ProjectConfigSettings =  {
        // imports: config.imports || {}, // todo validate
        plugins: plugins.filter(Boolean) as ExternalPlugin[],
        scripts,
        dependencies,
        viewer: config.viewer || {},
    }
    // console.log(plugins)
    return configParse
}

export function buildProjectBundleCode(settings: Required<LoadedProject>['settings'], mainJs?: string, baseUrl = './'){
    const config = settings.config
    if(!config) throw new Error('No project config to build main.js')
    const props = config.viewer || {}
    const viewerProps = JSON.stringify(props)

    const externals = [...config.dependencies.map(d=>d.key)]
    const forced = ['three', 'threepipe']
    for (const f of forced) {
        if(!externals.includes(f)) externals.push(f)
    }
    const importMap = Object.fromEntries(config.dependencies.map(dep=>{
        let url = dep.url || `https://esm.sh/${dep.key}@${dep.version}`
        const dependencyExternals = externals.filter(external=>external !== dep.key)
        if(dependencyExternals.length && /^https?:\/\//.test(url)) {
            url += `${url.includes('?') ? '&' : '?'}external=${dependencyExternals.join(',')}`
        }
        return [dep.key, url]
    }))
    if(!importMap.threepipe){
        importMap.threepipe = 'https://esm.sh/threepipe@0.4.4?external=three,threepipe'
    }
    // Threepipe exports its compatible Three.js singleton. Keeping both bare
    // specifiers on that module prevents duplicate Three.js object graphs.
    if(importMap.threepipe){
        importMap.three = importMap.threepipe
    }
    const containerId = 'viewer-container'

    const indexHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>${settings.json?.name || settingsKey} Project</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <!-- Import maps polyfill -->
    <!-- Remove this when import maps will be widely supported -->
    <script async src="https://unpkg.com/es-module-shims@1.6.3/dist/es-module-shims.js"></script>

    <script type="importmap">
    ${JSON.stringify(importMap)}
    </script>
    <style id="example-style">
        html, body, #${containerId}, #${settingsKey}-canvas {
            width: 100%;
            height: 100%;
            margin: 0;
            overflow: hidden;
        }
    </style>
    <script type="module" src="./main.js"></script>
</head>
<body>
<div id="${containerId}">
    <canvas id="${settingsKey}-canvas"></canvas>
</div>

</body>
</html>
        `
    const activePlugins = config.plugins.filter(plugin=>plugin.active !== false)
    const activeScripts = config.scripts.filter(script=>script.active !== false)
    const moduleSpecifiers = Array.from(new Set([
        ...activePlugins.map(plugin=>plugin.import),
        ...activeScripts.map(script=>script.import),
    ]))
    const moduleBindings = new Map(moduleSpecifiers.map((specifier, index)=>[
        specifier,
        `ProjectModule${index}`,
    ]))
    const importLines = moduleSpecifiers.map(specifier=>
        `import * as ${moduleBindings.get(specifier)} from ${JSON.stringify(specifier)}`
    )
    const componentLines = activeScripts.map(script=>{
        const binding = moduleBindings.get(script.import)!
        return `for (const ComponentClass of Object.values(${binding})) {
            if (typeof ComponentClass === 'function' && typeof ComponentClass.ComponentType === 'string') {
                entities.addComponentType(ComponentClass)
            }
        }`
    })
    const pluginLines = activePlugins.map(plugin=>{
        const binding = moduleBindings.get(plugin.import)!
        const classExpression = plugin.className ?
            `${binding}[${JSON.stringify(plugin.className)}]` :
            `Object.values(${binding}).find(value => typeof value === 'function' && value.PluginType)`
        return `{
            const PluginClass = ${classExpression}
            if (typeof PluginClass !== 'function') {
                throw new Error('Plugin class not found in ' + ${JSON.stringify(plugin.import)})
            }
            await viewer.addPlugin(new PluginClass(...${JSON.stringify(plugin.params || [])}))
        }`
    })

    const mainScene = settings.mainScene || mainScenePath
    const setupJs = `
// Auto-generated _setup.js file
import {ThreeViewer, GBufferPlugin, EntityComponentPlugin} from 'threepipe'
${importLines.join('\n')}

export async function setupProject(scene = null){
    let viewer
    try{
        viewer = new ThreeViewer({
            container: document.getElementById(${JSON.stringify(containerId)}),
            debug: false,
            msaa: true,
            ...${viewerProps},
            // Project URLs are mutable and /fs/ is shared across project previews.
            // Persistent URL caching can hide edits or return another project's scene.
            assetManager: {storage: false},
            plugins: [new EntityComponentPlugin(false), GBufferPlugin],
        })
        
        viewer.assetManager.importer.addURLModifier((url)=>{
            if(url.startsWith(${JSON.stringify(assetUrlPrefix)})){
                return url.replace(${JSON.stringify(assetUrlPrefix)}, ${JSON.stringify(baseUrl)})
            }else {
                return url
            }
        })
        
    }catch(e){
    
        console.error('[${settingsKey}]: Error initializing viewer')
        throw e
    
    }
    
    try {
        const entities = viewer.getPlugin(EntityComponentPlugin)
        if (!entities) throw new Error('EntityComponentPlugin failed to initialize')
${componentLines.join('\n')}
${pluginLines.join('\n')}
    
    }catch(e){
    
        console.error('[${settingsKey}]: Error initializing plugins')
        throw e

    }

    console.log('[${settingsKey}]: Viewer initialized' )
    
    // viewer.setDirty()

    const sceneUrl = scene ? new URL(scene, new URL(${JSON.stringify(baseUrl)}, location.href)).href : ${JSON.stringify(baseUrl + mainScene)}
    try {
        const loaded = await viewer.load(sceneUrl, {autoScale: false, autoCenter: false})
        if (!loaded) throw new Error('Scene import returned no asset: ' + sceneUrl)
    } catch (error) {
        viewer.dispose()
        throw new Error('Failed to load scene ' + sceneUrl, {cause: error})
    }

    console.log('[${settingsKey}]: Scene loaded' )
    
    return {viewer}
}
`

    mainJs = mainJs ?? `
    export async function main({viewer}){
        console.error('[${settingsKey}]: Viewer is ready')
    }
    export async function onError(err){
        console.error('[${settingsKey}]: Error during setup', err)
    }
    `
    return {
        'index.html': indexHtml,
        '_setup.js': setupJs,
        'main.js': `import {setupProject as _${settingsKey}SetupProject} from './_setup.js';\n
${mainJs}\n
// [${settingsKey}] Setup. Consumers (including Kite's player) await this once.
const _${settingsKey}SceneOverride = new URLSearchParams(location.search).get('file') || new URLSearchParams(location.search).get('f')
export const projectReady = _${settingsKey}SetupProject(_${settingsKey}SceneOverride)
    .catch(async (error)=>{
        if (typeof onError === 'function') await onError(error)
        throw error
    })
    .then(async (data)=>{
        try{
            if(typeof main === 'function') await main(data);
        }catch(e){
            console.error('[${settingsKey}]: Uncaught error during main script execution', e)
            throw e
        }
        return data;
    })
`,
        imports: moduleSpecifiers,
        importMap: importMap
    }
}
