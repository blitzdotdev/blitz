import {
    AssetExportHooks,
    AssetImporter,
    IGeometry,
    IMaterial,
    iMaterialCommons,
    IObject3D,
    iObjectCommons,
    ITexture,
    ValOrArr
} from "threepipe"

/**
 * Subscribe to an object life cycle, calls add initially or when object is added after being disposed. Calls remove(return value of add) when object is disposed.
 * Basically - remove listener when object is disposed/removed from scene, but the object can be added back by undo, so handles that
 * @param object
 * @param add
 */
export function subscribeToObjectDispose(object: IObject3D|null, add: (obj: IObject3D)=>(null | (()=>void))) {
    if (!object) return ()=>{return}
    let remove: (()=>void) | null = add(object)
    let end = false
    const onAdded = (e: {target: IObject3D})=>{
        object = e.target
        if (!object) return
        object.removeEventListener('added', onAdded)
        if (end) return
        // todo check if added to the rootscene/object3d manager, if not ignore event
        remove = add(object)
        object.addEventListener('dispose', onDispose)
    }
    const onDispose = ()=>{
        if (!remove) return
        remove()
        remove = null
        if (!object) return
        object.removeEventListener('dispose', onDispose)
        object.addEventListener('added', onAdded)
        object = null
    }
    object.addEventListener('dispose', onDispose)
    return ()=>{
        if (!object) return
        end = true
        object.removeEventListener('dispose', onDispose)
        object.removeEventListener('added', onAdded) // this will never be called since object will be null
        if (remove) remove()
        remove = null
        object = null
    }
}

export function traverseTpAssetMat(materials: Set<IMaterial>|IMaterial[], matc: (mat: IMaterial)=>void|boolean, textures: Set<ITexture>|Set<ITexture> = new Set()) {
    materials.forEach(obj => {
        const r = matc(obj)
        if (r === false) return
        const textures1: Map<string, ITexture> = iMaterialCommons.getMapsForMaterial.call(obj)
        textures1.forEach(t => t && textures.add(t))
    })
    return {textures}
}

export function traverseTpAssetGeom(geometries: Set<IGeometry>|IGeometry[], geomc: (geom: IGeometry)=>void|boolean) {
    geometries.forEach(obj => {
        const r = geomc(obj)
        if (r === false) return
    })
}

export function traverseTpAssetTex(textures: Set<ITexture>|ITexture[], texc: (tex: ITexture)=>void|boolean) {
    textures.forEach(obj => {
        const r = texc(obj)
        if (r === false) return
    })
}

export function traverseTpAsset(
    objects: IObject3D[],
    objc: (obj: IObject3D)=>void|boolean,
    matc: (mat: IMaterial)=>void|boolean,
    geomc: (geom: IGeometry)=>void|boolean,
    texc: (tex: ITexture)=>void|boolean,
) {
    const materials = new Set<IMaterial>()
    const textures = new Set<ITexture>()
    const geometries = new Set<IGeometry>()
    // todo any other sub asset type?
    objects.forEach(obj => {
        const r = objc(obj)
        if (r === false) return

        if (obj.material) {
            (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach(m => materials.add(m))
        }
        if (obj.geometry) geometries.add(obj.geometry)
        const textures1: Map<string, ITexture> = iObjectCommons.getMapsForObject3D.call(obj)
        textures1.forEach(t => t && textures.add(t))
    })
    traverseTpAssetMat(materials, matc, textures)
    traverseTpAssetGeom(geometries, geomc)
    traverseTpAssetTex(textures, texc)
}

export function getSObjects(node: IObject3D, onlyS = false) {
    const objects: IObject3D[] = []
    if (!onlyS) {
        node.traverse((obj) => {
            if (obj._sChildren) {
                console.error('AssetManager - Objects should not have _sChildren set on import', obj)
            }
            objects.push(obj)
        })
    } else {
        // well this can be improved
        const set = new Set<IObject3D>()
        node.traverse((obj1: IObject3D) => {
            if (!obj1?.isObject3D) return
            set.add(obj1)
            if (obj1.children && obj1._sChildren) {
                // @ts-expect-error temp
                obj1._tChildren = obj1.children
                obj1.children = obj1._sChildren as IObject3D[]
            }
        })
        objects.push(...set)
        set.forEach(obj1=>{
            // @ts-expect-error temp
            if (obj1._tChildren) {
                // @ts-expect-error temp
                obj1.children = obj1._tChildren
                // @ts-expect-error temp
                delete obj1._tChildren
            }
        })
        set.clear()
    }
    return objects
}

export function populateRootPath(node: IObject3D, objects: IObject3D[]) {
    const rootPath = node.userData.rootPath
    if (!rootPath) return

    const c = (obj: IObject3D|IMaterial|ITexture|IGeometry)=> {
        if (obj.userData.tpAssetRefIds) { // set in AssetExporter
            // todo defer find by id and assign when available (in object manager)
            console.error('TODO - Not implemented, external material property reference')
        }

        if ((obj as IObject3D).isObject3D) {
            if (obj.userData.tpAssetRefIds?.material) { // set in AssetExporter
                // todo defer find by id and assign when available (in object manager)
                console.error('TODO - Not implemented, external material reference')
            }
            if (obj.userData.tpAssetRefIds?.geometry) { // set in AssetExporter
                // todo defer find by id and assign when available (in object manager)
                console.error('TODO - Not implemented, external geometry reference')
            }
        }

        if (obj.userData.rootPath && obj !== node) {
            if ((obj as ITexture).isTexture) obj._tpRootPath = obj.userData.rootPath // assuming textures cannot have sub assets
            // todo geometry same as texture?
            return false
        }
        obj._tpRootPath = rootPath
        return true
    }
    traverseTpAsset(objects, c, c, c, c)
}

export function populateRootPathMat(mat: IMaterial) {
    const rootPath = mat.userData.rootPath
    if (!rootPath) return
    const c = (obj: IObject3D|IMaterial|ITexture|IGeometry)=> {
        if (obj.userData.rootPath && obj !== mat) {
            if ((obj as ITexture).isTexture) obj._tpRootPath = obj.userData.rootPath // assuming textures cannot have sub assets
            // todo geometry same as texture?
            return false
        }
        obj._tpRootPath = rootPath
        return true
    }
    const {textures} = traverseTpAssetMat([mat], c)
    traverseTpAssetTex(textures, c)
}

export function populateRootPathTex(tex: ITexture) {
    const rootPath = tex.userData.rootPath
    if (!rootPath) return
    tex._tpRootPath = rootPath
}

// region asset ids

// export function populateTpAssetIds(node: IObject3D, objects: IObject3D[], override = false) {
//     const currentAssetId = node.userData.tpAssetId as string
//     if (!currentAssetId) return
//     if (!node.userData.rootPath) console.warn('Asset does not have rootPath set in userData, this may cause issues when re-saving the asset', node)
//     // node._isTpAsset = true
//     traverseTpAsset(objects,
//         (o) => assetIdObj(o, currentAssetId, override, node),
//         (o) => assetIdMat(o, currentAssetId, override, node),
//         (o) => assetIdGeom(o, currentAssetId, override, node),
//         (o) => assetIdTex(o, currentAssetId, override, node))
// }
//
// export function populateTpAssetIdsMat(mat: IMaterial, override = false) {
//     const currentAssetId = mat.userData.tpAssetId
//     if (!currentAssetId) return
//     const {textures} = traverseTpAssetMat([mat], (o)=>assetIdMat(o, currentAssetId, override))
//     traverseTpAssetTex(textures, (o)=>assetIdTex(o, currentAssetId, override))
// }
//
// // asset ids callback
// const assetIdObj = (obj: IObject3D, currentAssetId: string, override = false, node?: IObject3D)=>{
//     if (obj._tpAssetId && obj._tpAssetId !== currentAssetId && !override) {
//         node && console.error('Asset contains missing references from another asset', obj, node)
//         return false
//     }
//     obj._tpAssetId = currentAssetId
//     return true
// }
// const assetIdMat = (obj: IMaterial, currentAssetId: string, override = false, node?: IObject3D)=>{
//     if (obj._tpAssetId && obj._tpAssetId !== currentAssetId && !override) {
//         node && console.error('Asset contains missing references from another asset', obj, node)
//         return false
//     }
//     obj._tpAssetId = currentAssetId
//     return true
// }
// const assetIdGeom = (obj: IGeometry, currentAssetId: string, override = false, node?: IObject3D)=>{
//     if (obj._tpAssetId && obj._tpAssetId !== currentAssetId && !override) {
//         node && console.error('Asset contains missing references from another asset', obj, node)
//         return false
//     }
//     obj._tpAssetId = currentAssetId
//     return true
// }
// const assetIdTex = (obj: ITexture, currentAssetId: string, override = false, node?: IObject3D)=>{
//     if (obj._tpAssetId && obj._tpAssetId !== currentAssetId && !override) {
//         node && console.error('Asset contains missing references from another asset', obj, node)
//         return false
//     }
//     obj._tpAssetId = currentAssetId
//     return true
// }

// endregion asset ids

export const trackerExportHooks: AssetExportHooks = {
    object: (obj, root)=>{
        const rootPath = root.userData?.rootPath || null
        if (rootPath && obj._tpRootPath && obj._tpRootPath !== rootPath) {
            // todo object belongs to a diff asset. we shouldn't save it
            console.error('Object belongs to a different asset, it should not be present in children/sChildren.', obj, rootPath)
        }
    },
    objectGeometry: (obj, geometry, root)=>{
        const rootPath = root.userData?.rootPath || null

        if (rootPath && geometry._tpRootPath && geometry._tpRootPath !== rootPath && !geometry.userData.rootPath) {
            // geometry belongs to a diff asset. we should only save the asset id and the geometry uuid
            if (!geometry.userData.uuid || geometry.userData.uuid !== geometry.uuid) {
                console.error('Geometry from different asset must have uuid in userData', geometry, obj)
            }
            // (obj as any)._geomExtRef = geometry._tpRootPath + ':' + geometry.uuid

            if (!obj.userData.tpAssetRefIds) obj.userData.tpAssetRefIds = {}

            if (obj.userData.tpAssetRefIds.geometry) { // it is supposed to be deleted after export
                console.warn('Overwriting existing userData.tpAssetRefIds.geometry', obj.userData.tpAssetRefIds.geometry, obj)
            }
            obj.userData.tpAssetRefIds.geometry = geometry._tpRootPath + ':' + geometry.uuid


            return AssetImporter.DummyGeometry
        }
    },
    objectGeometryReplace: (_obj)=>{
        // const geomExtRef = (obj as any)._geomExtRef as string|undefined
        // if (geomExtRef) {
        //     if (!obj.userData.tpAssetRefIds) obj.userData.tpAssetRefIds = {}
        //
        //     if (obj.userData.tpAssetRefIds.geometry) { // it is supposed to be deleted after export
        //         console.warn('Overwriting existing userData.tpAssetRefIds.geometry', obj.userData.tpAssetRefIds.geometry, geomExtRef, obj)
        //     }
        //     obj.userData.tpAssetRefIds.geometry = geomExtRef
        // }
        // delete (obj as any)._geomExtRef
    },
    objectMaterial: (obj, material, root, i)=>{
        const rootPath = root.userData?.rootPath || null
        if (!rootPath || !material._tpRootPath || material._tpRootPath === rootPath || material.userData.rootPath) {
            return undefined
        }
        // material belongs to a diff asset. we should only save the asset id and the material uuid
        if (!material.userData.uuid || material.userData.uuid !== material.uuid) {
            console.error('Material from different asset must have uuid in userData', material, obj)
        }

        if (Array.isArray((obj as any)._materialsExtRef) && i !== undefined) {
            ((obj as any)._materialsExtRef as any[])[i] = material._tpRootPath + ':' + material.uuid
        } else {
            (obj as any)._materialsExtRef = material._tpRootPath + ':' + material.uuid
        }
        return () => AssetImporter.DummyMaterial as any
    },
    objectMaterials: (obj: IObject3D, materials: IMaterial|IMaterial[]|undefined)=>{
        if (materials === undefined) return
        if ((obj as any)._materialsExtRef === undefined) {
            (obj as any)._materialsExtRef = (Array.isArray(materials) ? (materials as IMaterial[]).map(() => null) : null) as ValOrArr<string | null>
        }
    },
    objectMaterialsReplace: (obj: IObject3D, _mats: IMaterial | IMaterial[])=>{
        const materialsExtRef = (obj as any)._materialsExtRef as ValOrArr<string|null>|undefined
        delete (obj as any)._materialsExtRef
        if (materialsExtRef !== undefined && !Array.isArray(materialsExtRef) ? materialsExtRef !== null : materialsExtRef?.some(m => m !== null)) {
            if (!obj.userData.tpAssetRefIds) obj.userData.tpAssetRefIds = {}

            if (obj.userData.tpAssetRefIds.material) { // it is supposed to be deleted after export
                console.warn('Overwriting existing userData.tpAssetRefIds.material', obj.userData.tpAssetRefIds.material, materialsExtRef, obj)
            }
            obj.userData.tpAssetRefIds.material = materialsExtRef
        }
    },
    replaceTexture: (obj: IObject3D|IMaterial, texture: ITexture, k: string, root: IObject3D|IMaterial)=>{
        const rootPath = root.userData?.rootPath || null

        // textures which are themselves loaded from a rootpath will have both _tpRootPath and userData.rootPath set. this is only for textures that "belong" to another asset
        if (!rootPath || !texture._tpRootPath || texture._tpRootPath === rootPath|| texture._tpRootPath === texture.userData?.rootPath) return texture

        // texture belongs to a diff asset. we shouldn't save it
        //  replace with dummy texture or null and save id (in material.userData.tpAssetRefIds), and replace back later on

        if (!obj.userData.tpAssetRefIds) obj.userData.tpAssetRefIds = {}
        if (obj.userData.tpAssetRefIds[k]) {
            console.warn('Overwriting existing userData.tpAssetRefIds.' + k, obj.userData.tpAssetRefIds[k], texture, obj)
        }
        obj.userData.tpAssetRefIds[k] = texture._tpRootPath + ':' + texture.uuid

        return null
    },
    revertTextures: (obj)=>{
        if (obj.userData.tpAssetRefIds) {
            delete obj.userData.tpAssetRefIds
        }
    },
    revertObject: (obj)=>{
        if (obj.userData.tpAssetRefIds) {
            delete obj.userData.tpAssetRefIds
        }
    },
}
