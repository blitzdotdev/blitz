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

    const externals = [...config.dependencies.map(d=>d.key)] // are deps req to be added to externals? since every thing is loaded from esm.sh anyway
    const forced = ['three', 'threepipe']
    for (const f of forced) {
        if(!externals.includes(f)) externals.push(f)
    }
    const importMap = Object.fromEntries(config.dependencies.map(dep=>{
        let url = dep.url || `https://esm.sh/${dep.key}@${dep.version}`
        if(externals.length) url += `?external=${externals.join(',')}`
        return [dep.key, url]
    }))
    if(!importMap.threepipe){
        importMap.threepipe = 'https://esm.sh/threepipe@latest'
    }
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
    const importLines: string[] = []
    const pluginLines: string[] = []
    const impPlugins: Record<string, ExternalPlugin[] > = {}
    config.plugins.forEach((p, i)=>{
        const imp = p.import
        if(!impPlugins[imp]) impPlugins[imp] = []
        impPlugins[imp].push(p)
    })
    const importsMap: Record<string, string> = {}
    Object.entries(impPlugins).forEach(([imp, pl])=>{
        if(!pl.length) return
        const unnamed = pl.filter(p=>!p.className)
        const named = pl.filter(p=>!!p.className)
        if(unnamed.length > 0){
            const rnd = Math.random().toString(36).slice(2, 7)
            const varName = `PluginMod${rnd}`
            importLines.push(`import * as ${varName} from '${imp}`)
            importsMap[imp] = varName

            if(unnamed.length > 1){
                console.error('Multiple unnamed plugins imported from the same module, only one is supported, others will be ignored', imp, unnamed)
            }
            for (const plugin of unnamed) {
                pluginLines.push(`{
                        const UnnamedPlugin = Object.values(imports.${imp}).find(m=>m.PluginType);
                        if(p){
                            await viewer.addPlugin(new UnnamedPlugin(...(${JSON.stringify(plugin.params || [])})));
                        }else {
                            console.warn('No plugin class found in module', '${imp}')
                        }
                   }`)
                break // only one supported
            }
            for (const plugin of named) {
                pluginLines.push(`
                        await viewer.addPlugin(new imports.${imp}.${plugin.className!}(...(${JSON.stringify(plugin.params || [])})));
                    `)
            }
        }else {
            for (const plugin of named) {
                pluginLines.push(`
                        await viewer.addPlugin(new ${plugin.className!}(...(${JSON.stringify(plugin.params || [])})));
                    `)
            }
        }
    })

    const mainScene = settings.mainScene || mainScenePath
    const setupJs = `
// Auto-generated _setup.js file
import {ThreeViewer, GBufferPlugin, EntityComponentPlugin} from 'threepipe'
${importLines.join('\n')}
const imports = ${JSON.stringify(importsMap)}

export async function setupProject(scene = null){

    try{

        const viewer = new ThreeViewer({
            container: document.getElementById(${JSON.stringify(containerId)}),
            debug: false,
            msaa: true,
            ...${viewerProps},
            // default plugins
            plugins: [EntityComponentPlugin, GBufferPlugin],
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

${pluginLines.join('\n')}
    
    }catch(e){
    
        console.error('[${settingsKey}]: Error initializing plugins')
        throw e

    }

    console.log('[${settingsKey}]: Viewer initialized' )
    
    // viewer.setDirty()

    await viewer.load(scene || ${JSON.stringify(baseUrl + mainScene)}).catch(e=>{
    
        console.error('[${settingsKey}]: Error loading main scene: ' + ${JSON.stringify(mainScene)})
        throw e

    })
    
    
    console.log('[${settingsKey}]: Scene loaded' )
    
    return {viewer}
}
// usage: 
// import { setupProject } from './_setup.js'
// setupProject().catch(e=>{
//     console.error('[${settingsKey}]: Failed to initialize viewer', e)
//     alert('Failed to initialize viewer: ' + e?.message || e)
// }
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
        'main.js': `import {setupProject: _${settingsKey}SetupProject} from './_setup.js';\n
${mainJs}\n
// [${settingsKey}] Setup.
_${settingsKey}SetupProject()
    .catch(onError ? onError : ()=>{})
    .then(async (data)=>{
        try{
            if(main) await main(data);
        }catch(e){
            console.error('[${settingsKey}]: Uncaught error during main script execution', e)
        }
        return data;
    })
`,
        imports: Object.keys(impPlugins),
        importMap: importMap
    }
}
