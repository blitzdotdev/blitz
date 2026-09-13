import type {IObject3D} from 'threepipe'

export const KITE3D_AUTHORING_METADATA_KEY = 'kite3dAuthoring'
export const KITE3D_RUNTIME_METADATA_KEY = 'kite3dRuntime'

export type AuthoringRole = 'direct' | 'template'

export interface AuthoringMetadata {
    role: AuthoringRole
    id: string
    sourceId?: string
    allowCameraInside?: boolean
}

export interface RuntimeObjectMetadata {
    ownerId: string
    kind: 'clone' | 'effect'
    sourceId: string
    overrides?: RuntimeMutableProperty[]
}

export type RuntimeMutableProperty = 'position' | 'rotation' | 'scale' | 'visible' | 'material'

export interface RuntimeCloneOptions {
    name?: string
    visible?: boolean
    position?: [number, number, number]
    rotation?: [number, number, number]
    scale?: [number, number, number]
    runtimeMutable?: RuntimeMutableProperty[]
}

export interface RuntimeScene extends IObject3D {
    modelRoot: IObject3D
}

interface TrackedRuntimeObject {
    object: IObject3D
    owner: IObject3D
    scene?: RuntimeScene
}

const authoringRoles = new Set<AuthoringRole>(['direct', 'template'])
const trackedRuntimeObjects = new Map<IObject3D, TrackedRuntimeObject>()

/** Store a validated, serializable authored identity on an object. */
export function setAuthoringMetadata(object: IObject3D, metadata: AuthoringMetadata): AuthoringMetadata {
    const value = normalizeAuthoringMetadata(metadata)
    object.userData[KITE3D_AUTHORING_METADATA_KEY] = value
    object.setDirty?.({source: 'Kite3D authoring', change: `userData.${KITE3D_AUTHORING_METADATA_KEY}`})
    return value
}

/** Read authoring metadata without trusting arbitrary userData. */
export function getAuthoringMetadata(object: IObject3D): AuthoringMetadata | undefined {
    const value = object.userData?.[KITE3D_AUTHORING_METADATA_KEY]
    if (!isRecord(value) || !authoringRoles.has(value.role as AuthoringRole)
        || typeof value.id !== 'string' || !value.id.trim()
        || (value.sourceId !== undefined && (typeof value.sourceId !== 'string' || !value.sourceId.trim()))
        || (value.allowCameraInside !== undefined && typeof value.allowCameraInside !== 'boolean')) return undefined
    return value as unknown as AuthoringMetadata
}

export function getRuntimeObjectMetadata(object: IObject3D): RuntimeObjectMetadata | undefined {
    const value = object.userData?.[KITE3D_RUNTIME_METADATA_KEY]
    if (!isRecord(value) || typeof value.ownerId !== 'string' || !value.ownerId
        || !['clone', 'effect'].includes(String(value.kind))
        || typeof value.sourceId !== 'string' || !value.sourceId) return undefined
    return value as unknown as RuntimeObjectMetadata
}

export function isRuntimeObject(object: IObject3D): boolean {
    return getRuntimeObjectMetadata(object) !== undefined
}

/** Return the live objects tracked against one viewer scene. */
export function getTrackedRuntimeObjects(scene: IObject3D): readonly IObject3D[] {
    return [...trackedRuntimeObjects.values()]
        .filter((record) => record.scene === scene)
        .map(({object}) => object)
}

/**
 * Owns Play-only roots and clones. A single owner should be created in start()
 * and cleaned in stop(); cleanup is idempotent.
 */
export class RuntimeObjectOwner {
    private readonly objects = new Set<IObject3D>()
    private readonly protectedResources = new Set<object>()
    private runtimeParent?: IObject3D
    private nextObject = 0

    constructor(readonly ownerId: string) {
        if (!ownerId?.trim()) throw new Error('RuntimeObjectOwner requires a stable owner id')
    }

    attachRuntimeRoot<T extends IObject3D>(root: T, scene: RuntimeScene, authoredOwner: IObject3D): T {
        if ((root as IObject3D) === (scene as IObject3D) || root === scene.modelRoot
            || root === authoredOwner || isDescendantOf(authoredOwner, root)) {
            throw new Error('A runtime root cannot be its authored owner or an ancestor of that owner')
        }
        if (!isDescendantOf(authoredOwner, scene.modelRoot)) {
            throw new Error('A runtime root requires an authored owner beneath modelRoot')
        }
        this.track(root, authoredOwner, 'effect', scene)
        scene.add(root)
        this.runtimeParent = root
        return root
    }

    trackEffect<T extends IObject3D>(root: T, owner: IObject3D): T {
        if (root === owner || isDescendantOf(owner, root) || isRuntimeObject(owner)) {
            throw new Error('An effect root requires a persistent authored owner outside that root')
        }
        const scene = findTrackedScene(root) || findRuntimeScene(owner)
        if (scene && isDescendantOf(root, scene.modelRoot)) {
            throw new Error('Runtime effects must live outside modelRoot')
        }
        this.track(root, owner, 'effect', scene)
        return root
    }

    cloneFrom<T extends IObject3D>(source: T, parent: IObject3D | undefined = this.runtimeParent, options: RuntimeCloneOptions = {}): T {
        const sourceMetadata = getAuthoringMetadata(source)
        if (!sourceMetadata || sourceMetadata.sourceId) {
            throw new Error('Runtime clones require a direct or template source with a stable authored id')
        }
        if (!parent) throw new Error('Runtime clones require a parent or an attached runtime root')
        const scene = findTrackedScene(parent) || findRuntimeScene(source) || findRuntimeScene(parent)
        if (scene && isDescendantOf(parent, scene.modelRoot)) {
            throw new Error('Runtime clones must live outside modelRoot')
        }

        collectResources(source, this.protectedResources)
        const clone = source.clone(true) as T
        clone.traverse((child) => {
            if (child !== clone) {
                delete child.userData?.[KITE3D_AUTHORING_METADATA_KEY]
                delete child.userData?.[KITE3D_RUNTIME_METADATA_KEY]
            }
            cloneMaterials(child)
        })
        clone.name = options.name || `${source.name || sourceMetadata.id} (Runtime)`
        clone.visible = options.visible ?? true
        if (options.position) clone.position.set(...options.position)
        if (options.rotation) clone.rotation.set(...options.rotation)
        if (options.scale) clone.scale.set(...options.scale)

        const overrides = new Set<RuntimeMutableProperty>(options.runtimeMutable || ['position', 'rotation'])
        if (options.position) overrides.add('position')
        if (options.rotation) overrides.add('rotation')
        if (options.scale) overrides.add('scale')
        if (options.visible !== undefined || clone.visible !== source.visible) overrides.add('visible')
        this.markRuntimeObject(clone, sourceMetadata, 'clone', [...overrides])
        parent.add(clone)
        this.objects.add(clone)
        trackedRuntimeObjects.set(clone, {object: clone, owner: source, scene})
        return clone
    }

    cleanup(): void {
        const disposed = new Set<object>()
        for (const object of this.objects) {
            object.removeFromParent()
            disposeObjectResources(object, this.protectedResources, disposed)
            trackedRuntimeObjects.delete(object)
        }
        this.objects.clear()
        this.protectedResources.clear()
        this.runtimeParent = undefined
    }

    private track<T extends IObject3D>(
        object: T,
        owner: IObject3D,
        kind: RuntimeObjectMetadata['kind'],
        scene?: RuntimeScene,
    ): void {
        const ownerMetadata = getAuthoringMetadata(owner)
        const sourceId = ownerMetadata?.id || owner.uuid
        collectResources(owner, this.protectedResources)
        this.markRuntimeObject(object, ownerMetadata || {role: 'direct', id: sourceId}, kind)
        this.objects.add(object)
        trackedRuntimeObjects.set(object, {object, owner, scene})
    }

    private markRuntimeObject(
        object: IObject3D,
        source: AuthoringMetadata,
        kind: RuntimeObjectMetadata['kind'],
        overrides?: RuntimeMutableProperty[],
    ): void {
        const sourceId = source.id
        object.userData[KITE3D_AUTHORING_METADATA_KEY] = {
            role: source.role,
            id: `${this.ownerId}:${++this.nextObject}`,
            sourceId,
        } satisfies AuthoringMetadata
        object.userData[KITE3D_RUNTIME_METADATA_KEY] = {
            ownerId: this.ownerId,
            kind,
            sourceId,
            ...(overrides?.length ? {overrides} : {}),
        } satisfies RuntimeObjectMetadata
    }
}

function normalizeAuthoringMetadata(metadata: AuthoringMetadata): AuthoringMetadata {
    if (!metadata || !authoringRoles.has(metadata.role) || typeof metadata.id !== 'string' || !metadata.id.trim()) {
        throw new Error('Kite3D authoring metadata requires a supported role and stable id')
    }
    if (metadata.sourceId !== undefined && (typeof metadata.sourceId !== 'string' || !metadata.sourceId.trim())) {
        throw new Error('Kite3D authoring sourceId must be a non-empty string')
    }
    if (metadata.allowCameraInside !== undefined && typeof metadata.allowCameraInside !== 'boolean') {
        throw new Error('Kite3D allowCameraInside must be a boolean')
    }
    return {
        role: metadata.role,
        id: metadata.id.trim(),
        ...(metadata.sourceId ? {sourceId: metadata.sourceId.trim()} : {}),
        ...(metadata.allowCameraInside !== undefined ? {allowCameraInside: metadata.allowCameraInside} : {}),
    }
}

function cloneMaterials(object: IObject3D): void {
    const renderable = object as IObject3D & {material?: {clone?: () => unknown} | Array<{clone?: () => unknown}>}
    if (Array.isArray(renderable.material)) {
        renderable.material = renderable.material.map((material) => material?.clone?.() || material) as typeof renderable.material
    } else if (renderable.material) {
        renderable.material = (renderable.material.clone?.() || renderable.material) as typeof renderable.material
    }
}

function findTrackedScene(object: IObject3D): RuntimeScene | undefined {
    for (let current: IObject3D | null = object; current; current = current.parent as IObject3D | null) {
        const record = trackedRuntimeObjects.get(current)
        if (record?.scene) return record.scene
    }
    return undefined
}

function findRuntimeScene(object: IObject3D): RuntimeScene | undefined {
    let current: IObject3D | null = object
    while (current?.parent) current = current.parent as IObject3D
    return current && 'modelRoot' in current ? current as RuntimeScene : undefined
}

function isDescendantOf(object: IObject3D, ancestor: IObject3D): boolean {
    for (let current: IObject3D | null = object; current; current = current.parent as IObject3D | null) {
        if (current === ancestor) return true
    }
    return false
}

function collectResources(object: IObject3D, target: Set<object>): void {
    object.traverse((child) => {
        const resourceOwner = child as IObject3D & {geometry?: object, material?: object | object[]}
        if (resourceOwner.geometry) target.add(resourceOwner.geometry)
        const materials = Array.isArray(resourceOwner.material) ? resourceOwner.material : [resourceOwner.material]
        for (const material of materials) {
            if (!material) continue
            target.add(material)
            for (const value of Object.values(material)) {
                if (isRecord(value) && value.isTexture === true) target.add(value)
            }
        }
    })
}

function disposeObjectResources(object: IObject3D, protectedResources: Set<object>, disposed: Set<object>): void {
    const dispose = (resource: unknown) => {
        if (!isRecord(resource) || protectedResources.has(resource) || disposed.has(resource)) return
        disposed.add(resource)
        if (typeof resource.dispose === 'function') resource.dispose()
    }
    object.traverse((child) => {
        const resourceOwner = child as IObject3D & {geometry?: object, material?: object | object[]}
        dispose(resourceOwner.geometry)
        const materials = Array.isArray(resourceOwner.material) ? resourceOwner.material : [resourceOwner.material]
        for (const material of materials) {
            if (!material) continue
            for (const value of Object.values(material)) {
                if (isRecord(value) && value.isTexture === true) dispose(value)
            }
            dispose(material)
        }
    })
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
