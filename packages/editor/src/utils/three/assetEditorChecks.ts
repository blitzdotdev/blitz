// @ts-nocheck -- reference asset checks inspect legacy runtime metadata when present.
import {assetUrlPrefix} from "../project.ts";
import {ViewerInstanceManager} from "../ViewerInstanceManager.ts";
import {IGeometry, IMaterial, ITexture} from "threepipe";

export function isMatEditable(obj: IMaterial, manager: ViewerInstanceManager){
    return obj
        // && !obj.userData.tpAssetId  // not an asset itself
        && (!obj.userData.rootPath || !obj.userData.rootPath.startsWith(assetUrlPrefix))  // not an asset itself
        // && (!obj._tpAssetId || obj._tpAssetId === manager.loadedAssetId) // part of an asset, but not the current loaded asset
        // && (!obj._tpRootPath /*|| !obj._tpRootUid*/) // part of an asset, but not the current loaded asset
        && !obj.userData.isPlaceholder
}
export function isGeomEditable(obj: IGeometry, manager: ViewerInstanceManager){
    return obj
        // && !obj.userData.tpAssetId  // not an asset itself
        && (!obj.userData.rootPath || !obj.userData.rootPath.startsWith(assetUrlPrefix))  // not an asset itself
        // && (!obj._tpAssetId || obj._tpAssetId === manager.loadedAssetId) // part of an asset, but not the current loaded asset
        // && (!obj._tpRootPath /*|| !obj._tpRootUid*/) // part of an asset, but not the current loaded asset
        && !obj.userData.isPlaceholder
}
export function isTexEditable(obj: ITexture, manager: ViewerInstanceManager){
    return obj
        // && !obj.userData.tpAssetId  // not an asset itself
        && (!obj.userData.rootPath || !obj.userData.rootPath.startsWith(assetUrlPrefix))  // not an asset itself
        && (!obj._tpRootPath /*|| !obj._tpRootUid*/) // part of an asset, but not the current loaded asset
        && !obj.userData.isPlaceholder
}
