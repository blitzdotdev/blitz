import {IGeometry, IMaterial, IObject3D, ITexture, TypedClass} from "threepipe";
import {assetUrlPrefix, SavedSceneFile, SavedSceneFileMeta, settingsKey} from "./project.ts";
import {typesExts} from "../data/fileTypes.ts";
import {FileManifestEntry} from "./AssetsProvider.ts";

export type SelObjectType = 'object' | 'material' | 'texture' | 'geometry' | 'unknown' | 'none' | 'plugin'

export interface SelectFileRef{
    uuid: string
    name: string
    // path: string
    type: SelObjectType|'image'|'script'|[TypedClass]
    entry: FileManifestEntry
    userData?: Record<string, any>

    // _isViewerPlugin: true

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

export const assetableFileTypes = ['.glb', '.gltf', '.mat', '.json'] // we can write asset ids into these files.
export const notAssetableFileTypes = ['.scene.gltf']

export function isLoadableFile(file: string) {
    let loadable = true
    // const loadableFiles = ['.mat', '.glb']
    const loadableFiles = [...assetableFileTypes]
    loadableFiles.push(...typesExts.image!)
    if (!loadableFiles.some(ext => file.endsWith(ext))) loadable = false

    // const notLoadableFiles = ['.scene.gltf']
    if (notAssetableFileTypes.some(ext => file.endsWith(ext))) loadable = false
    return loadable;
}

export const canMakeAsset = (obj: IObject3D|IMaterial)=>{
    return ((obj as IObject3D).isObject3D || (obj as IMaterial).isMaterial)
        && obj.userData
        && !obj.userData.sProperties // already an instance of an asset
        && !obj.userData.rootPath
        // && !obj._tpAssetId
        && !obj._tpRootPath
        // && !obj.userData.tpAssetId
        && !(obj as IObject3D).isScene
        && !(obj as IObject3D)._sChildren
        // todo
        && !(obj as IObject3D).material && !(obj as IObject3D).geometry
    // && !((obj as IObject3D).isObject3D ?
    //         iObjectCommons.getMapsForObject3D.call(obj as IObject3D) :
    //         iMaterialCommons.getMapsForMaterial.call(obj as IMaterial)
    // ).size
}

export const canSaveAsset = (obj: IObject3D|IMaterial)=>{
    return ((obj as IObject3D).isObject3D || (obj as IMaterial).isMaterial)
        // && obj._isTpAsset
        // && obj.userData.tpAssetId
        && obj.userData.rootPath && obj.userData.rootPath.startsWith(assetUrlPrefix+'@')
    // && obj._tpAssetId
}

export function logAsset(data: any, obj: IObject3D|IMaterial|ITexture|IGeometry){
    console.log(obj, data)
}

export function isPackageProject(meta?: SavedSceneFile|SavedSceneFileMeta|null){
    return meta && (meta.file as string === 'package.json' || (meta.file as any as File)?.name === 'package.json')
}

export function isExternalObject(obj: IObject3D){
    let external = false
    let obj1 = obj
    while(obj1 && !external){
        if(obj1.parent){
            if(obj1.parent.isScene) break
            if(obj1.parent._sChildren){
                if(!obj1.parent._sChildren.includes(obj1)){
                    external = true
                    break
                }
            }
            obj1 = obj1.parent
        } else {
            // not external but not part of the scene
            // external = true
            break
        }
    }
    return external
}

export function isExternalMaterial(mat: IMaterial){
    const meshes = Array.from(mat.appliedMeshes)
    for (const mesh of meshes) {
        // todo check sproperties
        if(!isExternalObject(mesh)) return false
    }
    return true
}

export function isExternalGeometry(mat: IGeometry){
    const meshes = Array.from(mat.appliedMeshes)
    for (const mesh of meshes) {
        // todo check sproperties
        if(isExternalObject(mesh)) return true
    }
    return false
}

export function isExternalTexture(tex: ITexture){
    const mats = Array.from(tex.appliedObjects||[])
    for (const mat of mats) {
        if((mat as IMaterial).isMaterial ? isExternalMaterial(mat as IMaterial) : isExternalObject(mat as IObject3D)) return true
    }
}

export function thumbPath(path: string){
    return `.${settingsKey}/thumbs/${path}.png`
}
export function backupPath(path: string, time: string){
    return `.${settingsKey}/backups/${path}/${time}/${path.split('/').pop()}`
}
