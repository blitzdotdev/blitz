import {getFileHandle} from "./fsApi.ts";
import {ProjectDirectoryHandle} from "../devserver/handles.ts";
import {
    AssetsJSONManifest,
    parsePackageJSON,
    parsePackageJsonSettingsConfig,
    ProjectConfigSettings,
    ProjectPackageJSON,
} from "@kite3d/engine/projectFormat";

// The project format is the engine's, so the editor and a published game read the same files.
export {
    assetUrlPrefix,
    parseAssetsJSONManifest,
    parsePackageJsonSettingsConfig,
    settingsKey,
} from "@kite3d/engine/projectFormat";
export type {
    AssetsJSONManifest,
    ExternalPlugin,
    ExternalScript,
    ProjectConfigSettings,
    ProjectConfigSettingsJSON,
    ProjectDependency,
    ProjectPackageJSON,
} from "@kite3d/engine/projectFormat";

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


export interface LoadedProject extends SavedSceneFile {
    settings?: {
        mainScene: string // path in project
        json: ProjectPackageJSON
        config: ProjectConfigSettings
    }
    assetsManifest?: AssetsJSONManifest
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
    const packageFileHandle = await handle.getFileHandle(typeof meta.file === 'string' ? meta.file : meta.file.name).catch(() => {
        // todo handle if there is dir with same name
        return undefined
    })
    const mainJsHandle = await handle.getFileHandle('main.js').catch(() => {
        // todo handle if there is dir with same name
        return undefined
    })
    const assetsJsonHandle = await handle.getFileHandle('assets.json').catch(() => {
        // todo handle if there is dir with same name
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
        const json = parsePackageJSON(await file.text())
        return {
            ...project,
            file,
            lastModified: file.lastModified,
            settings: {
                mainScene: json.mainScene,
                json,
                config: await parsePackageJsonSettingsConfig(json),
            }
        } as LoadedProject
    }catch (e){
        console.error('ThreeEditor - failed to parse package.json file', e)
        throw new Error('Cannot parse package.json file')
    }
}
