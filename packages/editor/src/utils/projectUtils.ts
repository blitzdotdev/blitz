import type {IGeometry, IMaterial, IObject3D, ITexture} from 'threepipe'

export const assetUrlPrefix = '/blitz/'

export const canMakeAsset = (object: IObject3D | IMaterial) =>
    Boolean((object as IObject3D).isObject3D || (object as IMaterial).isMaterial)
    && !object.userData?.rootPath

export const canSaveAsset = (object: IObject3D | IMaterial) =>
    typeof object.userData?.rootPath === 'string' && object.userData.rootPath.startsWith('/blitz/@')

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
    return `.blitz/thumbs/${path}.png`
}

export function backupPath(path: string, time: string) {
    return `.blitz/backups/${path}/${time}/${path.split('/').pop()}`
}
