import type {IGeometry, IMaterial, IObject3D, ITexture, TypedClass} from 'threepipe'
import type {FileManifestEntry} from './AssetsProvider.ts'
import type {SavedSceneFile} from './project.ts'

export type SelObjectType = 'object' | 'material' | 'texture' | 'geometry' | 'unknown' | 'none' | 'plugin'

export interface SelectFileRef {
    uuid: string
    name: string
    type: SelObjectType | 'image' | 'script' | TypedClass[]
    entry: FileManifestEntry
    userData?: Record<string, unknown>
}

export const assetableFileTypes = ['.glb', '.mat', '.json']
export const notAssetableFileTypes = ['.scene.glb']

export function isLoadableFile(file: string) {
    return /\.(glb|mat|json|png|jpe?g|gif|bmp|tiff|webp|hdr|exr|ktx2|svg)$/i.test(file)
        && !notAssetableFileTypes.some((extension) => file.endsWith(extension))
}

export function logAsset(data: unknown, object: unknown) {
    console.log(object, data)
}

export function isPackageProject(project?: SavedSceneFile | {file?: unknown} | null) {
    return Boolean(project && (project.file === 'package.json' || (project.file as File | undefined)?.name === 'package.json'))
}

export const assetUrlPrefix = '/kite3d/'

export const canMakeAsset = (object: IObject3D | IMaterial) =>
    Boolean((object as IObject3D).isObject3D || (object as IMaterial).isMaterial)
    // AGREED-4: a dropped DevServerSource asset is already registered, but its
    // scene instance occupies the same presentation state as a local import.
    && (!object.userData?.rootPath || object.userData?.kite3dImportedInstance === true)

export const canSaveAsset = (object: IObject3D | IMaterial) =>
    typeof object.userData?.rootPath === 'string' && object.userData.rootPath.startsWith('/kite3d/@')

export function isExternalObject(object: IObject3D) {
    let current = object
    while (current.parent) {
        if (current.parent.isScene) return false
        if (current.parent._sChildren && !current.parent._sChildren.includes(current)) return true
        current = current.parent
    }
    return false
}

export function isExternalMaterial(material: IMaterial) {
    return [...material.appliedMeshes].every((mesh) => isExternalObject(mesh))
}

export function isExternalGeometry(geometry: IGeometry) {
    return [...geometry.appliedMeshes].some((mesh) => isExternalObject(mesh))
}

export function isExternalTexture(texture: ITexture) {
    return [...texture.appliedObjects || []].some((value) =>
        (value as IMaterial).isMaterial
            ? isExternalMaterial(value as IMaterial)
            : isExternalObject(value as IObject3D)
    )
}

export function thumbPath(path: string) {
    return `.kite3d/thumbs/${path}.png`
}

export function backupPath(path: string, time: string) {
    return `.kite3d/backups/${path}/${time}/${path.split('/').pop()}`
}
