import {
    AssetExporter,
    AssetImporter,
    copyObject3DUserData,
    EventDispatcher,
    getPartialProps, IImportResultUserData,
    IMaterial,
    IMaterialEventMap,
    ImportResult,
    ImportResultExtras,
    IObject3D,
    IObject3DEventMap,
    ITexture,
    Object3DManager, PickingPlugin,
    Quaternion,
    setPartialProps,
    threeMaterialPropList, ThreeViewer, TypedType, TypeSystem,
    Vector3
} from "threepipe"
import {
    getSObjects,
    populateRootPath,
    populateRootPathMat,
    populateRootPathTex,
    subscribeToObjectDispose,
    trackerExportHooks
} from "./assetTrackerUtils"
import {ObservableSet} from "./observableSet.ts";
import {PickingPluginEventMap} from "threepipe";

export type AssetRefItem = any // todo
export interface AssetRegistryItem{
    pms: Promise<ImportResult|undefined>,
    object?: ImportResult|undefined
    refs: ObservableSet<AssetRefItem>
}

export class AssetTracker extends EventDispatcher<{
    registryChanged: {path: string, action: 'add'|'remove'|'refresh'|'load'},
    replaceItem: {old: ImportResult, new: ImportResult}
}> {

    isEditor = false
    importer: AssetImporter

    constructor(
        public viewer: ThreeViewer
    ) {
        super()
        const exporter = viewer.assetManager.exporter
        const manager = viewer.object3dManager
        this.importer = viewer.assetManager.importer
        this._setupObjectProcess()
        // todo chain hooks if they already exist by some other plugin
        exporter.exportHooks = trackerExportHooks
        manager.addEventListener('textureAdd', (e)=>{
            const rootPath = e.texture.userData?.rootPath
            if(!rootPath || typeof rootPath !== 'string') return
            const asset = this.getFromRegistry(rootPath, e.texture.userData.rootPathOptions)
            if(!asset) return;
            asset.refs.add(e.texture)
        })
        manager.addEventListener('textureRemove', (e)=>{
            const rootPath = e.texture.userData?.rootPath
            if(!rootPath || typeof rootPath !== 'string') return
            const asset = this.registry[rootPath]
            if(!asset) return;
            asset.refs.delete(e.texture)
            if(!asset.refs.size){
                this.removeFromRegistry(rootPath)
            }
        })
        manager.addEventListener('materialAdd', (e)=>{
            const rootPath = e.material.userData?.rootPath
            if(!rootPath || typeof rootPath !== 'string') return
            const asset = this.getFromRegistry(rootPath, e.material.userData.rootPathOptions)
            if(!asset) return;
            asset.refs.add(e.material)
        })
        manager.addEventListener('materialRemove', (e)=>{
            const rootPath = e.material.userData?.rootPath
            if(!rootPath || typeof rootPath !== 'string') return
            const asset = this.registry[rootPath]
            if(!asset) return;
            asset.refs.delete(e.material)
            if(!asset.refs.size){
                this.removeFromRegistry(rootPath)
            }
        })
        manager.addEventListener('geometryAdd', (e)=>{
            const rootPath = e.geometry.userData?.rootPath
            if(!rootPath || typeof rootPath !== 'string') return
            const asset = this.getFromRegistry(rootPath, e.geometry.userData.rootPathOptions)
            if(!asset) return;
            asset.refs.add(e.geometry)
        })
        manager.addEventListener('geometryRemove', (e)=>{
            const rootPath = e.geometry.userData?.rootPath
            if(!rootPath || typeof rootPath !== 'string') return
            const asset = this.registry[rootPath]
            if(!asset) return;
            asset.refs.delete(e.geometry)
            if(!asset.refs.size){
                this.removeFromRegistry(rootPath)
            }
        })
        manager.addEventListener('objectAdd', (e)=>{
            const rootPath = e.object.userData?.rootPath
            if(!rootPath || typeof rootPath !== 'string') return
            const asset = this.getFromRegistry(rootPath, e.object.userData.rootPathOptions)
            if(!asset) return;
            asset.refs.add(e.object)
        })
        manager.addEventListener('objectRemove', (e)=>{
            const rootPath = e.object.userData?.rootPath
            if(!rootPath || typeof rootPath !== 'string') return
            const asset = this.registry[rootPath]
            if(!asset) return;
            asset.refs.delete(e.object)
            if(!asset.refs.size){
                this.removeFromRegistry(rootPath)
            }
        })

        const selectionChange = (e:PickingPluginEventMap['selectedObjectChanged'])=>{
            const picking = viewer.getPlugin(PickingPlugin)
            if(!picking) return
            const {value, lastValue} = e
            if(value === lastValue) return
            const lastRootPath = (lastValue as ImportResultExtras)?.__rootPath // not userdata rootpath
            if (lastRootPath && typeof lastRootPath === 'string') {
                const asset = this.registry[lastRootPath]
                const uid = lastValue?.uuid
                if (asset && uid) {
                    // todo it could be a file also? anything else?
                    const regs = manager.getObject(uid) ||
                        manager.getMaterial(uid) || manager.getTexture(uid) ||
                        manager.getGeometry(uid)
                    if(!regs) {
                        asset.refs.delete(lastValue)
                        if (!asset.refs.size) {
                            this.removeFromRegistry(lastRootPath)
                        }
                    }
                }
            }
            const rootPath = (value as ImportResultExtras)?.__rootPath
            if (rootPath && typeof rootPath === 'string') {
                const asset = this.getFromRegistry(rootPath, (value as ImportResultExtras).__rootPathOptions)
                if (asset) {
                    asset.refs.add(value)
                }
            }
        }
        viewer.forPlugin(PickingPlugin, (picking)=>{
            picking.addEventListener('selectedObjectChanged', selectionChange)
        }, (picking)=>{
            picking.removeEventListener('selectedObjectChanged', selectionChange)
        }, )
    }

    protected _setupObjectProcess() {
        this.importer.addEventListener('processRaw', (event) => {
            const object = event.data
            if(!object) return

            // fill in rootpath and asset ids to all sub assets, this is useful in editor to know which asset something belongs to
            if(this.isEditor) this.processRawPopulateRefs(object)

            // if an embedded asset is loaded from the importer or some loader(like from LoadRootPathTextures, GLTFLoader, etc), it wont be in the registry so we need to add it
            const rootPath = object.__rootPath
            if(rootPath) { // todo check for asset url prefix maybe

                if(object.userData?.sProperties){
                    console.error('AssetTracker: Imported object already has sProperties, this may cause issues with asset management, clearing', object)
                    delete object.userData.sProperties
                }
                if(!this.registry[rootPath]) { // already loaded through the tracker
                    this.addToRegistry(rootPath, object, object.__rootPathOptions)
                }

                if(object.serializableClassId){
                    const type = TypeSystem.GetType(object, false)
                    const cls = type ? TypeSystem.GetClass(type) : undefined
                    if(type && cls){
                        const uuid = cls.getId(object)
                        const existing = this.cachedFileMeta[rootPath]
                        if(existing){
                            if(existing.uuid !== uuid){
                                console.warn('AssetTracker: Asset changed at path', rootPath, 'old uuid:', existing.uuid, 'new uuid:', uuid)
                            }else if(existing.type !== type){
                                console.warn('AssetTracker: Asset type changed at path', rootPath, 'old type:', existing.type, 'new type:', type)
                            }
                        }
                        // todo check if file with uuid already exists at some other path and remove that.
                        this.cachedFileMeta[rootPath] = {type, uuid, path: rootPath}
                        // console.log('file meta', {type, uuid, path: rootPath})
                    }
                }

            }

            // load any embedded assets in this
            if (object.isObject3D) {
                const node = object as IObject3D
                this.loadObjectDependencies(node)
                return
            }

        })

    }

    processRawPopulateRefs = (node: ImportResult) => {
        if(!this.isEditor) return
        if (node && node.isObject3D) {
            node = node as IObject3D
            if (node.userData.rootPath && !node.userData.rootSceneModelRoot) {
                const objects = getSObjects(node, false)
                populateRootPath(node, objects)
                // populateTpAssetIds(node, objects)
            }
        }
        // console.log('preprocess mat', mat)
        if (node && node.isMaterial && node.uuid) {
            const mat = node as IMaterial
            if (mat.userData.rootPath) {
                populateRootPathMat(mat)
                // populateTpAssetIdsMat(mat)
            }
        }
        if (node && node.isTexture) {
            const tex = node as ITexture
            if (tex.userData.rootPath) {
                populateRootPathTex(tex)
                // todo populateTpAssetIdsTex (right now textures cannot have asset ids)
            }
        }
        // todo geometry same as texture?
    }

    // todo remove path from asset registry after none of the sub assets are in the scene? (track when cloned)
    // this is diff from cachedAssets in asset importer, as same thing could be reloaded with cacheAsset: false and refreshed, and this tracks differently
    registry: Record<string, AssetRegistryItem> = {}

    private _onAssetRefreshL = new Set<(path: string, asset: AssetRegistryItem) => void|Promise<void>>()

    onAssetRefresh(l: (path: string, asset: AssetRegistryItem) => void|Promise<void>) {
        this._onAssetRefreshL.add(l)
        return ()=>{
            this._onAssetRefreshL.delete(l)
        }
    }

    private async _onAssetRefresh(path: string, asset: AssetRegistryItem) {
        for (const l of this._onAssetRefreshL) {
            try {
                await l(path, asset)
            } catch (e) {
                console.error('Error in onAssetRefresh listener', e)
            }
        }
    }

    getFromRegistry(path: string, options: any) {
        let asset = this.registry[path]
        if (!asset) {
            this.registry[path] = asset = {
                pms: this.importer.importSingle(path, options || {}).then(async(res) => {
                    if (res === asset.object) return res
                    asset.object = res
                    await this._onAssetRefresh(path, asset)
                    this.dispatchEvent({type: 'registryChanged', path, action: 'load'})
                    return res
                }),
                refs: new ObservableSet<AssetRefItem>(),
            }
            // console.log('AssetTracker: Added asset to registry for path', path)
            this.dispatchEvent({type: 'registryChanged', path, action: 'add'})
        }
        return asset
    }

    addToRegistry(path: string, object: ImportResult, options?: any) {
        let asset = this.registry[path]
        if (!asset) {
            this.registry[path] = asset = {
                pms: (async()=>{
                    await this._onAssetRefresh(path, asset)
                    this.dispatchEvent({type: 'registryChanged', path, action: 'load'})
                    return object
                })(),
                object,
                refs: new ObservableSet<AssetRefItem>(),
            }
            // console.log('AssetTracker: Added asset to registry for path', path, object)
            this.dispatchEvent({type: 'registryChanged', path, action: 'add'})
        } else {
            this.refreshFromRegistry(path, options, Promise.resolve(object))
        }
        return asset
    }

    refreshFromRegistry(path: string, options?: any, res?: Promise<ImportResult>) {
        const asset = this.registry[path]
        if (!asset) return this.getFromRegistry(path, options)
        asset.pms = (res ?? this.importer.importSingle(path, options || {})).then(async(res) => {
            if(!res){
                console.error('AssetTracker: Unable to refresh asset, import returned empty result for path', path)
                return asset.object
            }
            const current = asset.object
            if (res === current) {
                console.warn('Imported asset same as current(maybe its being cached somewhere), not refreshing', path, res)
                return res
            }
            if(current) this.dispatchEvent({type: 'replaceItem', old: current, new: res}) // to replace in picking etc
            this.removeFromRegistry(path, false)
            // todo unload current (traverse) and dispatch _assetUnload and dispose?
            asset.object = res
            await this._onAssetRefresh(path, asset)
            // console.log('AssetTracker: Refreshed asset in registry for path', path)
            this.dispatchEvent({type: 'registryChanged', path, action: 'load'})
            return res
        })
        // console.log('AssetTracker: Refreshing asset in registry for path', path)
        this.dispatchEvent({type: 'registryChanged', path, action: 'refresh'})
        return asset
    }

    removeFromRegistry(path: string, remove = true) {
        const asset = this.registry[path]
        if (!asset) return
        if(asset.refs.size && remove){
            console.error('Removing an asset that still has references', path, asset)
        }
        if (asset.object) {
            if ((asset.object as IObject3D).isObject3D) {
                const object = asset.object as IObject3D
                object.traverse((obj: IObject3D) => {
                    // @ts-expect-error later
                    obj.dispatchEvent({type: '_assetUnload'})
                    // @ts-expect-error later
                    obj.dispatchEvent({type: '__unregister'}) // to unselect any selected object in picking on this
                    obj.dispose && obj.dispose(false)
                })
                if(object.dispose) object.dispose(true)
                if(object.parent) object.removeFromParent()
            } else if (typeof asset.object.dispose === 'function') {
                asset.object.dispose()
            }
            // todo it needs to be dispatched to all children
            if(asset.object.dispatchEvent) {
                asset.object.dispatchEvent({type: '_assetUnload'})
                asset.object.dispatchEvent({type: '__unregister'}) // to unselect any selected object in picking on this
            }
        }
        if (remove) {
            delete this.registry[path]
            // console.log('AssetTracker: Removed asset from registry for path', path)
            this.dispatchEvent({type: 'registryChanged', path, action: 'remove'})
        }
    }

    removeAssetItem(obj: ImportResult | {
        pms: Promise<ImportResult|undefined>
    }){
        const reg = this.registry
        // todo move to asset manager or one place
        const rootPath = (obj as ImportResult).userData?.rootPath ?? Object.entries(reg).find(e=>e[1] === obj)?.[0]
        if(!rootPath){
            console.warn('Unable to find asset in registry to remove', obj)
            return
        }
        return this.removeFromRegistry(rootPath)
    }

    // refreshes the contents of the object obj, when the root path asset is loaded/refreshed
    private _objectRefresh = async(obj: IObject3D | IMaterial, path: string, asset: AssetRegistryItem|null)=>{
        if (path !== obj.userData.rootPath) return
        if (!asset) {
            // todo asset unloaded
            return
        }
        // todo append to obj._loadingPromise?
        const res1 = asset.object
        if (!res1) {
            console.error('AssetImporter: No asset found in asset for rootPath', obj.userData.rootPath, asset)
            return
        }
        if(res1 === obj) {
            console.log('Tried to subscribe to the same object for asset refresh, ignoring', obj.userData.rootPath, obj)
            return
        }
        if (res1._loadingPromise) await res1._loadingPromise // wait for parent to load first

        if ((res1 as IObject3D).isObject3D && (obj as IObject3D).isObject3D) {
            obj = obj as IObject3D
            // reset children to _sChildren
            if (obj._sChildren) {
                for (const child of [...obj.children]) {
                    if (obj._sChildren.includes(child)) continue
                    child.dispose && child.dispose(true)
                    if(child.parent) child.removeFromParent()
                }
            }

            updateObjectAsset(res1 as IObject3D, obj, this)
        } else if ((res1 as IMaterial).isMaterial && (obj as IMaterial).isMaterial) {
            obj = obj as IMaterial

            updateMaterialAsset(res1 as IMaterial, obj, this)
        } else {
            console.error('AssetImporter: Imported rootPath is not an Object3D or Material or type mismatch', obj.userData.rootPath, res1)
            return
        }
    }

    /**
     * Load the embedded `rootPath` assets within this object
     * @param object
     * @private
     */
    async loadObjectDependencies(object: IObject3D) {
        if (!object.traverseModels) {
            console.error('AssetManager - Object not upgraded, cannot load dependencies', object)
            return
        }

        if (object.isObject3D && object.traverse) {
            const children: IObject3D[] = []
            const materials = new Set<IMaterial>()
            object.traverse((obj: any) => { // todo traverseModels?
                // if (object !== obj)
                children.push(obj)
                if (obj.material) {
                    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
                    mats.forEach((m: any)=>m && m.isMaterial && m.userData && materials.add(m))
                }
            })

            const pms = []
            for (const obj of children) {
                if (!obj.userData.rootPath || (obj as ImportResultExtras).__rootPath || obj.userData.rootPathRefresh) continue // todo merge with loadObjectDep logic with rootPathRefresh
                if (obj._loadingPromise) {
                    pms.push(obj._loadingPromise)
                    continue
                }
                if (obj.userData.sProperties === undefined) continue // not an embedded asset
                obj._sChildren = [...obj.children] // save current children (extra objects)

                if(!obj.userData.sProperties.length){ // if empty, set to default (temp, remove later)
                    obj.userData.sProperties = [...defSPropsObj]
                }

                pms.push(this.subsToAsset(obj))
            }
            for (const obj of materials) {
                if (!obj.userData.rootPath || (obj as ImportResultExtras).__rootPath || obj.userData.rootPathRefresh) continue
                if (obj._loadingPromise) {
                    pms.push(obj._loadingPromise)
                    continue
                }
                if (obj.userData.sProperties === undefined) continue
                // obj._sChildren = [...obj.children] // save current children (extra objects)

                if(!obj.userData.sProperties.length){ // if empty, set to default (temp, remove later)
                    obj.userData.sProperties = [...defSPropsMat]
                }

                // obj.userData.sLocked = true // todo set this?

                pms.push(this.subsToAsset(obj))
            }
            if (pms.length) object._loadingPromise = Promise.allSettled(pms)
        }
    }

    subsToAsset(obj: IMaterial|IObject3D) {
        if(!obj.userData.rootPath) return

        if((obj as IObject3D).isObject3D){
            const refresher = (obj1: any)=>this.onAssetRefresh((path, asset)=>this._objectRefresh(obj1, path, asset))
            // todo when to remove? on asset unload? maybe we shouldn't
            const remove = subscribeToObjectDispose(obj as IObject3D, refresher)
        }else {

            // todo when to remove? on material applied meshes size = 0? see subscribeToObjectDispose above for object
            const remove = this.onAssetRefresh((path, asset) => this._objectRefresh(obj, path, asset))

        }

        const asset = this.getFromRegistry(obj.userData.rootPath, obj.userData.rootPathOptions)
        const assetPms = asset.object ?
            this._objectRefresh(obj, obj.userData.rootPath, asset) :
            // this._onAssetRefresh(obj.userData.rootPath, asset) : // already loaded, we need to just trigger refresh
            asset.pms
        obj._loadingPromise = assetPms.catch((err) => {
            console.error('AssetImporter: Error updating asset from rootPath', obj.userData.rootPath, err)
        })
        return obj._loadingPromise
    }

    // cachedFileTypes: Record<string, TypedType> = {}
    cachedFileMeta: Record<string, AssetFileMeta> = {}
    getCachedFileMeta(path: string): AssetFileMeta | undefined{
        console.log(path)
        return this.cachedFileMeta[path]
    }
}
interface AssetFileMeta{
    type: TypedType
    uuid: string
    path: string
}

// adding anything here, also update copyProps function below if required for type
const propListObject: (keyof IObject3D)[] = ['position', 'quaternion', 'scale', 'visible', 'castShadow', 'receiveShadow', 'frustumCulled', 'renderOrder']
// todo sProperties - getPartialProps, setPartialProps
// todo userdata copy using deep clone copy like setValues
function copySPropsObject(props: Partial<IObject3D>, obj: IObject3D) {
    const sprops = (obj.userData.sProperties || []) as string[]
    // const props = getPartialProps(obj, sprops)
    const name = obj.name
    const visible = obj.visible

    // obj.copy(resMat)
    for (const prop of propListObject) {
        if (sprops.includes(prop as string)) continue
        const v = props[prop]
        if (v !== undefined) {
            if (v && (v as Vector3).isVector3) (obj[prop] as Vector3).copy(v as Vector3)
            else if (v && (v as Quaternion).isQuaternion) (obj[prop] as Quaternion).copy(v as Quaternion)
            else { // @ts-expect-error use mutable keys or something
                obj[prop] = v
            }
        }
    }
    if (props.layers?.mask !== undefined) obj.layers.mask = props.layers.mask

    // todo merge .userdata
    // todo .animations

    if (props.userData) {
        const ud = obj.userData
        obj.userData = {} // clear existing userData
        copyObject3DUserData(obj.userData, props.userData, ['uuid', 'sProperties'])
        Object.assign(obj.userData, ud)
        // todo add entity components
    }

    obj.name = name
    obj.visible = visible

    // setPartialProps(props, obj)
    obj.userData.uuid = obj.uuid // just in case
    obj.userData.sProperties = sprops // it might be cleared above

    obj.setDirty && obj.setDirty()
}

function copySPropsMaterial(props1: Partial<IMaterial>, obj: IMaterial) {
    const sprops = obj.userData.sProperties
    const props = getPartialProps(obj, sprops)
    const name = obj.name
    obj.setValues(props1)
    obj.name = name

    setPartialProps(props, obj)
    obj.userData.uuid = obj.uuid // just in case
    obj.userData.sProperties = sprops // it will be cleared above in setValues
    // Note that _tpAssetId is not set on the obj here, but userData.tpAssetId should be copied in setValues above
}

function updateObjectAsset(assetRoot: IObject3D, obj: IObject3D, manager: AssetTracker) {
    // if (assetRoot._isTpAsset) {
    // todo check if tpAssetId is saved in obj.userData.tpAssetId, if not, save it and set needs save.
    //  if it exists but mismatch use some manifest to find the correct asset by id, if not found, assume the id has changed of the same file.
    // }

    // todo - if 404 or diff id, find new path from manifest/some hook and use that and set _tpAssetNeedsSave and call setDirty

    // console.log('AssetTracker: Updating object asset for rootPath', assetRoot.userData?.rootPath, obj, assetRoot)
    // clone and copy children
    assetRoot.children.forEach(assetChild => {
        // if (!c._tpAssetId) {
        //     console.warn('AssetImporter: Object inside an asset does not contain _tpAssetId, this may cause issues with asset management', c)
        // }
        const cl = cloneAssetItem(assetChild) as IObject3D
        obj.add(cl) // todo add to same index

        // if(!cl._tpRootPath) cl._tpRootPath = assetChild.userData.rootPath

        if(manager.isEditor){
            // todo subs to userdata changes in assetRoot also, right now only keeps the children in sync
            cl.traverse(clo=>{
                if (!clo._tpRootPath) {
                    console.error('Object inside an asset does not contain _tpRootPath', assetChild, clo)
                    return
                }
                const rp = clo._tpRootPath
                const ruid = clo._tpRootUid
                let obj1 = manager.registry[rp].object as IObject3D | undefined
                if (obj1 && ruid) {
                    if (obj1.uuid !== ruid) {
                        obj1.traverse((o: IObject3D) => {
                            if (o.uuid === ruid) {
                                obj1 = o
                            }
                        })
                    }
                }
                if (!obj1 || !obj1.isObject3D) {
                    console.error('Cannot find asset in registry for rootPath', rp, clo, obj1)
                } else {

                    let obj2 = obj1 as IObject3D | null
                    // let clo2 = clo as IObject3D | null

                    let onUpdate: ((e: IObject3DEventMap['objectUpdate']) => void) | null = null

                    // this is for when object is added again after dispose like when undoing
                    const removeSubs = subscribeToObjectDispose(clo, (target)=>{
                        onUpdate = onUpdate1(target)
                        obj2?.addEventListener('objectUpdate', onUpdate)
                        return ()=>{
                            onUpdate && obj2?.removeEventListener('objectUpdate', onUpdate)
                            onUpdate = null
                        }
                    })
                    obj2?.addEventListener('_assetUnload', () => {
                        removeSubs()
                        obj2 = null
                    })
                }
            })
        }
    // Note that _tpAssetId is not set on the obj here, but userData.tpAssetId should be present already
    })

    copySPropsObject(assetRoot, obj)

    // todo
    // merge userdata
    // copy sProperties
    // check textures attached to this object
    // check materials attached to this object
    // check geometries attached to this object
    // if light, check shadow, target children
    // check troika text, tiles renderer, embedded splat files.
    // what happens on local file drop
    // check code for load object dependencies in AssetManager
    // subscribe to changes in assetRoot and apply to obj.

    if(manager.isEditor){
        const onObjUpdate = (e: IObject3DEventMap['objectUpdate'])=> {
            // todo root object updated
            console.log('asset root obj updated', e)
        }
        assetRoot.addEventListener('objectUpdate', onObjUpdate)
        assetRoot.addEventListener('_assetUnload', ()=>{ // todo dispatch this when unloaded
            assetRoot?.removeEventListener('objectUpdate', onObjUpdate)
            // assetRoot = null
        })
    }
}

function updateMaterialAsset(res1: IMaterial, obj: IMaterial, manager: AssetTracker) {
    // if (res1._isTpAsset) {
    // todo check if tpAssetId is saved in obj.userData.tpAssetId, if not, save it and set needs save.
    //  if it exists but mismatch use some manifest to find the correct asset by id, if not found, assume the id has changed of the same file.
    // }

    // todo - if 404 or diff id, find new path from manifest/some hook and use that and set _tpAssetNeedsSave and call setDirty

    // const sprops = obj.userData.sProperties!

    copySPropsMaterial(res1, obj)

    if(manager.isEditor) {
        const onMatUpdate = (e: IMaterialEventMap['materialUpdate']) => {
            const change = e.change || e.key
            const sprops = obj.userData.sProperties
            if (change && sprops && sprops.includes(change)) return
            const propList = Object.keys(res1.constructor.MaterialProperties || threeMaterialPropList)
            if (change && !change.startsWith('userData.') && propList.includes(change)) {
                const name = obj.name
                obj.setValues({[change]: (res1 as any)[change]})
                obj.name = name
            } else {
                // copy all props
                copySPropsMaterial(res1, obj)
            }
        }
        // todo remove event listener when obj.appliedMeshes.size = 0, add again incase added
        res1.addEventListener('materialUpdate', onMatUpdate)
        res1.addEventListener('_assetUnload', () => { // todo dispatch this when unloaded
            res1?.removeEventListener('materialUpdate', onMatUpdate)
            // res1 = null
        })
    }
    // todo
    //  subscribe to changes in res1 and apply to obj. - done
    //  check textures attached to this material
    //  what happens on local file drop

}

/**
 * Copy properties to target object when source object is updated.
 * @param target
 */
const onUpdate1 = (target: IObject3D)=>(e: IObject3DEventMap['objectUpdate'])=>{
    console.log('object update event', e)
    const source = e.object
    const change = e.change || e.key
    const sprops = target.userData.sProperties
    if (change && sprops && sprops.includes(change)) return
    // todo only update selected prop
    // // const propList = Object.keys(res1.constructor.MaterialProperties || threeMaterialPropList)
    if (change && !change.startsWith('userData.') && propListObject.includes(change as any)) {
        const name = target.name
        const visible = target.visible
        copySPropsObject({[change]: (source as any)[change]}, target)
        target.name = name
        target.visible = visible
    } else {
        // copy all props
        copySPropsObject(source, target)
    }
}
declare module 'threepipe' {
    interface IObject3D{
        // /**
        //  * This is set to the asset id of the asset this object belongs to.
        //  * @internal - for assets
        //  */
        // ['_tpAssetId']?: string
        /**
         * This is set to the root path of the asset this object belongs to.
         * @internal - for assets
         */
        ['_tpRootPath']?: string
        /**
         * UID of the object in the asset/path it belongs to.
         * @internal - for assets
         */
        ['_tpRootUid']?: string
    }
}
declare module 'threepipe' {
    interface IMaterial{
        // /**
        //  * This is set to the asset id of the asset this object belongs to.
        //  * @internal - for assets
        //  */
        // ['_tpAssetId']?: string
        /**
         * This is set to the root path of the asset this object belongs to.
         * @internal - for assets
         */
        ['_tpRootPath']?: string

    }
}
declare module 'threepipe' {
    interface IGeometry{
        // /**
        //  * This is set to the asset id of the asset this object belongs to.
        //  * @internal - for assets
        //  */
        // ['_tpAssetId']?: string
        /**
         * This is set to the root path of the asset this object belongs to.
         * @internal - for assets
         */
        ['_tpRootPath']?: string
    }
}
declare module 'threepipe' {
    interface ITexture{
        // /**
        //  * This is set to the asset id of the asset this object belongs to.
        //  * @internal - for assets
        //  */
        // ['_tpAssetId']?: string
        /**
         * This is set to the root path of the asset this object belongs to.
         * @internal - for assets
         */
        ['_tpRootPath']?: string
    }
}

// maybe just accept AssetRegistryItem
export function cloneAssetItem<T extends IObject3D|IMaterial|ITexture= IObject3D|IMaterial|ITexture>(item: T, rootPath?: string) {
    // if (this._tpAssetId) clone._tpAssetId = this._tpAssetId // todo copy/remove on add and remove from parent?
    const clone = ((item as IObject3D).isObject3D ? (item as IObject3D).clone(false) : (item as IMaterial).isMaterial ? (item as IMaterial).clone(false) : item.clone()) as typeof item
    if (rootPath||item._tpRootPath) {// todo copy/remove on add and remove from parent?
        clone._tpRootPath = rootPath||item._tpRootPath
    }
    if ((item as IObject3D).isObject3D) {
        (clone as IObject3D)._tpRootUid = (item as IObject3D)._tpRootUid || item.uuid
        delete clone.userData.cloneParent

        const obj = item as IObject3D
        const cobj = clone as IObject3D
        for ( let i = 0; i < obj.children.length; i ++ ) {
            const child = obj.children[ i ];
            cobj.add( cloneAssetItem(child) );
        }
        if (obj._sChildren) {
            cobj._sChildren = []
            for (const c of obj._sChildren) {
                if (!c) continue
                let cClone
                if (obj.children.includes(c as any)) {
                    const ind = obj.children.indexOf(c as any)
                    cClone = cobj.children[ind] as IObject3D
                } else
                    cClone = cloneAssetItem(c as IObject3D) as IObject3D
                cobj._sChildren.push(cClone)
            }
        }
    }

    // todo track for removal from registry?
    return clone
}

export const defSPropsObj = ['visible', 'name', 'position', 'quaternion', 'scale']
export const defSPropsMat = ['name']
