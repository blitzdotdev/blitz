import {PackageDependency} from "./importMaps.ts";
import {getFileHandle} from "./fsApi.ts";
import {ProjectDirectoryHandle} from "../devserver/handles.ts";
import {parse, ParseError} from "jsonc-parser";

export const settingsKey = "kite3d"
export const assetUrlPrefix = '/' + settingsKey + '/'

export interface SavedSceneFile {
    path: string,
    file: File /*| string*/
    assets?: string,
    lastModified: number
    preview?: File | string
    scene?: File
    handle?: ProjectDirectoryHandle
    // viewerConfig?: File | string | any // todo
}


export interface AssetsJSONManifest{
    files: Record<string, { // id to files meta
        path: string,
        files?: Record<string, string>, // the asset's sidecars, by the name the asset refers to them
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

export interface SavedSceneFileMeta {
    path: string,
    file: string
    assets?: string,
    lastModified: number
    preview?: File | string
    handle?: ProjectDirectoryHandle
    // viewerConfig?: File | string | any // todo
}

export async function resolveFile(value: string | File, handle?: ProjectDirectoryHandle) {
    let res: any = value
    if (typeof value === 'string' && handle) {
        const handles = await getFileHandle(handle, value, false)
        const file = await handles?.fileHandle?.getFile()
        if (file) res = file
    }
    return res as File | any
}

export async function initProjectHandles(meta: SavedSceneFileMeta){
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

export async function parsePackageJsonSettings(file: File, project: LoadedProject|SavedSceneFileMeta){
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
export async function parsePackageJsonSettingsConfig(json: any, project: LoadedProject|SavedSceneFileMeta){
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
