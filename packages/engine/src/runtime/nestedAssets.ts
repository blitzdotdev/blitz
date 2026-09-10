import {
    copyObject3DUserData,
    getPartialProps,
    IMaterial,
    ImportResult,
    ImportResultExtras,
    IObject3D,
    Quaternion,
    setPartialProps,
    ThreeViewer,
    Vector3,
} from 'threepipe'

type RuntimeErrorHandler = (error: unknown) => void

const defaultObjectOverrides = ['visible', 'name', 'position', 'quaternion', 'scale']
const defaultMaterialOverrides = ['name']
const objectProperties: (keyof IObject3D)[] = [
    'position',
    'quaternion',
    'scale',
    'visible',
    'castShadow',
    'receiveShadow',
    'frustumCulled',
    'renderOrder',
]

/**
 * Loads the embedded rootPath references written by the editor's AssetTracker.
 * This is deliberately runtime-only: it keeps root overrides, but has no file
 * watching, picking, export hooks, refresh subscriptions, or editor registry.
 */
export class RuntimeNestedAssetLoader {
    private readonly importer: ThreeViewer['assetManager']['importer']
    private readonly cache = new Map<string, Promise<ImportResult | undefined>>()
    private readonly pending = new Set<Promise<void>>()

    constructor(
        private readonly viewer: ThreeViewer,
        private readonly onError: RuntimeErrorHandler,
    ) {
        this.importer = viewer.assetManager.importer
        this.importer.addEventListener('processRaw', this.onProcessRaw)
    }

    dispose() {
        this.importer.removeEventListener('processRaw', this.onProcessRaw)
        this.cache.clear()
        this.pending.clear()
    }

    async loadObjectDependencies(object: IObject3D): Promise<void> {
        if (!object.traverse) return

        const objects: IObject3D[] = []
        const materials = new Set<IMaterial>()
        object.traverse((child: IObject3D) => {
            objects.push(child)
            const material = (child as IObject3D & {material?: IMaterial | IMaterial[]}).material
            if (material) {
                const entries = Array.isArray(material) ? material : [material]
                entries.forEach((entry) => entry?.isMaterial && materials.add(entry))
            }
        })

        const loads: Promise<void>[] = []
        for (const child of objects) {
            if (!this.isEmbeddedReference(child)) continue
            if (child._loadingPromise) {
                loads.push(child._loadingPromise.then(() => undefined))
                continue
            }

            if (!(child.userData.sProperties as string[]).length) {
                child.userData.sProperties = [...defaultObjectOverrides]
            }
            child._sChildren = [...child.children]
            const load = this.loadReference(child)
            child._loadingPromise = load
            loads.push(load)
        }

        for (const material of materials) {
            if (!this.isEmbeddedReference(material)) continue
            if (material._loadingPromise) {
                loads.push(material._loadingPromise.then(() => undefined))
                continue
            }

            if (!(material.userData.sProperties as string[]).length) {
                material.userData.sProperties = [...defaultMaterialOverrides]
            }
            const load = this.loadReference(material)
            material._loadingPromise = load
            loads.push(load)
        }

        if (!loads.length) return
        const loading = Promise.allSettled(loads).then((results) => {
            for (const result of results) {
                if (result.status === 'rejected') this.onError(result.reason)
            }
        })
        object._loadingPromise = loading
        this.track(loading)
        await loading
    }

    async waitForPending(): Promise<void> {
        while (this.pending.size) {
            await Promise.all([...this.pending])
        }
    }

    private readonly onProcessRaw = (event: {data?: ImportResult}) => {
        const object = event.data
        if (!object?.isObject3D) return
        const loading = this.loadObjectDependencies(object as IObject3D)
        this.track(loading)
    }

    private isEmbeddedReference(value: IObject3D | IMaterial): boolean {
        const rootPath = value.userData?.rootPath
        return typeof rootPath === 'string'
            && !(value as ImportResultExtras).__rootPath
            && !value.userData.rootPathRefresh
            && Array.isArray(value.userData.sProperties)
    }

    private loadAsset(path: string, options: Record<string, unknown> | undefined) {
        let loading = this.cache.get(path)
        if (!loading) {
            loading = this.importer.importSingle(path, options || {})
            this.cache.set(path, loading)
        }
        return loading
    }

    private async loadReference(target: IObject3D | IMaterial): Promise<void> {
        const path = target.userData.rootPath as string
        const imported = await this.loadAsset(path, target.userData.rootPathOptions)
        if (!imported) throw new Error(`Unable to load nested asset from ${path}`)
        if (imported._loadingPromise) await imported._loadingPromise

        const targetObject = target as IObject3D
        const targetMaterial = target as IMaterial
        if (targetObject.isObject3D && imported.isObject3D) {
            this.updateObject(imported as IObject3D, targetObject)
            return
        }
        if (targetMaterial.isMaterial && imported.isMaterial) {
            this.updateMaterial(imported as IMaterial, targetMaterial)
            return
        }
        throw new Error(`Nested asset at ${path} does not match its reference type`)
    }

    private updateObject(source: IObject3D, target: IObject3D) {
        if (target._sChildren) {
            for (const child of [...target.children]) {
                if (!target._sChildren.includes(child)) child.removeFromParent()
            }
        }

        for (const child of source.children) target.add(cloneObject(child))

        const overrideProperties = target.userData.sProperties as string[]
        const name = target.name
        const visible = target.visible
        for (const property of objectProperties) {
            if (overrideProperties.includes(property)) continue
            const value = source[property]
            const current = target[property]
            if (value && current && (value as Vector3).isVector3) {
                (current as Vector3).copy(value as Vector3)
            } else if (value && current && (value as Quaternion).isQuaternion) {
                (current as Quaternion).copy(value as Quaternion)
            } else if (value !== undefined) {
                Object.assign(target, {[property]: value})
            }
        }

        const targetUserData = target.userData
        target.userData = {}
        copyObject3DUserData(target.userData, source.userData, ['uuid', 'sProperties'])
        Object.assign(target.userData, targetUserData)
        target.name = name
        target.visible = visible
        target.userData.uuid = target.uuid
        target.userData.sProperties = overrideProperties
        target.setDirty?.({source: 'RuntimeNestedAssetLoader'})
    }

    private updateMaterial(source: IMaterial, target: IMaterial) {
        const overrideProperties = target.userData.sProperties as string[]
        const overrides = getPartialProps(target, overrideProperties)
        const name = target.name
        target.setValues(source)
        target.name = name
        setPartialProps(overrides, target)
        target.userData.uuid = target.uuid
        target.userData.sProperties = overrideProperties
    }

    private track(promise: Promise<void>) {
        this.pending.add(promise)
        const remove = () => this.pending.delete(promise)
        promise.then(remove, remove)
    }
}

function cloneObject(source: IObject3D): IObject3D {
    const clone = source.clone(false) as IObject3D
    const sourceRoot = source as IObject3D & {_tpRootPath?: string, _tpRootUid?: string}
    const cloneRoot = clone as IObject3D & {_tpRootPath?: string, _tpRootUid?: string}
    cloneRoot._tpRootPath = sourceRoot._tpRootPath
    cloneRoot._tpRootUid = sourceRoot._tpRootUid || source.uuid
    delete clone.userData.cloneParent
    for (const child of source.children) clone.add(cloneObject(child))
    return clone
}
