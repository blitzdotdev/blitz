import {
    EntityComponentPlugin,
    IObject3D,
    Object3DWidgetsPlugin,
    ThreeViewer,
    TObject3DComponent,
} from 'threepipe'
import {HtmlUiComponent} from '../plugins/HtmlUiComponent.ts'
import {CannonPhysicsPlugin} from '../plugins/cannon/CannonPhysicsPlugin.ts'

export {HtmlUiComponent} from '../plugins/HtmlUiComponent.ts'
export {CannonPhysicsPlugin} from '../plugins/cannon/CannonPhysicsPlugin.ts'

export const KITE_GAME_RUNTIME_VERSION = 1
export const KITE_AUTHORING_METADATA_KEY = 'kiteAuthoring'

export type KiteAuthoringRole = 'direct' | 'template' | 'generator' | 'preview' | 'runtime-instance'

export interface KiteAuthoringMetadata {
    schemaVersion: 1
    role: KiteAuthoringRole
    kind?: 'effect'
    id: string
    sourceId?: string
    ownerId?: string
    overrides?: string[]
    /** Allow an intentional enclosing mesh, such as a back-sided sky dome, to
     * contain the saved Edit camera without failing camera framing checks. */
    allowCameraInside?: boolean
}

type PersistentAuthoringMetadata = Omit<KiteAuthoringMetadata, 'schemaVersion'> & {
    role: Exclude<KiteAuthoringRole, 'runtime-instance'>
}

const persistentRoles = new Set<KiteAuthoringRole>(['direct', 'template', 'generator', 'preview'])

/** Read validated authoring metadata without trusting arbitrary userData. */
export function getKiteAuthoringMetadata(object: IObject3D): KiteAuthoringMetadata | undefined {
    const value = object.userData?.[KITE_AUTHORING_METADATA_KEY] as Partial<KiteAuthoringMetadata> | undefined
    if (!value || value.schemaVersion !== 1 || typeof value.id !== 'string' || !value.id ||
        !['direct', 'template', 'generator', 'preview', 'runtime-instance'].includes(String(value.role))) return undefined
    return value as KiteAuthoringMetadata
}

/** Mark a persistent authored source with an explicit stable identity. */
export function setKiteAuthoringMetadata(
    object: IObject3D,
    metadata: PersistentAuthoringMetadata,
): KiteAuthoringMetadata {
    if (!persistentRoles.has(metadata.role) || !metadata.id?.trim()) {
        throw new Error('Persistent Kite authoring metadata requires a valid role and stable id')
    }
    if (metadata.role === 'preview' && !metadata.sourceId?.trim()) {
        throw new Error('A Kite authoring preview requires its generator sourceId')
    }
    const value: KiteAuthoringMetadata = {schemaVersion: 1, ...metadata, id: metadata.id.trim()}
    object.userData[KITE_AUTHORING_METADATA_KEY] = value
    object.setDirty?.({source: 'KiteAuthoringMetadata', change: 'userData'})
    return value
}

export interface KiteRuntimeCloneOptions {
    name?: string
    visible?: boolean
    position?: [number, number, number]
    rotation?: [number, number, number]
    scale?: [number, number, number]
    runtimeMutable?: Array<'position' | 'rotation' | 'scale' | 'visible' | 'material'>
}

/**
 * Own runtime copies created from saved authored sources. Mutable materials are
 * cloned, geometry remains shared, and cleanup never disposes the source.
 */
export class KiteRuntimeObjectOwner {
    private readonly instances = new Set<IObject3D>()
    private readonly materials = new Set<{dispose?: () => void}>()
    private nextInstance = 0

    constructor(readonly ownerId: string) {
        if (!ownerId?.trim()) throw new Error('KiteRuntimeObjectOwner requires a stable owner id')
    }

    /** Track transient visuals against a saved owner without treating them as
     * template copies. The caller remains responsible for effect resources. */
    trackEffect<T extends IObject3D>(effect: T, source: IObject3D): T {
        const metadata = getKiteAuthoringMetadata(source)
        if (metadata?.role === 'runtime-instance' || metadata?.role === 'preview') {
            throw new Error('Effects require a persistent authored owner')
        }
        effect.userData[KITE_AUTHORING_METADATA_KEY] = {
            schemaVersion: 1, role: 'runtime-instance', kind: 'effect',
            id: `${this.ownerId}:${++this.nextInstance}`, ownerId: this.ownerId,
            sourceId: metadata?.id || source.uuid,
        } satisfies KiteAuthoringMetadata
        this.instances.add(effect)
        return effect
    }

    /** Attach one owned runtime root directly to the live Three.js scene.
     * `scene.addObject()` is intentionally not used because Kite treats it as
     * authored content and may place the object beneath `modelRoot`. */
    attachRuntimeRoot<T extends IObject3D>(
        root: T,
        scene: IObject3D & {modelRoot: IObject3D},
        source: IObject3D,
    ): T {
        let current: IObject3D | null = source
        let authored = false
        while (current) {
            if (current === root) throw new Error('A runtime root cannot be its authored owner or contain that owner')
            if (current === scene.modelRoot) authored = true
            current = current.parent as IObject3D | null
        }
        if (!authored) throw new Error('A runtime root requires an authored owner beneath modelRoot')
        if (root === scene.modelRoot) throw new Error('modelRoot cannot be used as a runtime root')
        this.trackEffect(root, source)
        scene.add(root)
        return root
    }

    cloneFrom<T extends IObject3D>(source: T, parent: IObject3D, options: KiteRuntimeCloneOptions = {}): T {
        const sourceMetadata = getKiteAuthoringMetadata(source)
        if (!sourceMetadata || sourceMetadata.role === 'runtime-instance' || sourceMetadata.role === 'preview') {
            throw new Error('Runtime clones require a direct, template, or generator source with a stable id')
        }
        const clone = source.clone(true) as T
        clone.traverse(child => {
            if (child !== clone) delete child.userData?.[KITE_AUTHORING_METADATA_KEY]
            const material = (child as any).material
            const cloneMaterial = (value: any) => {
                const copy = value?.clone?.() || value
                if (copy !== value && copy?.dispose) this.materials.add(copy)
                return copy
            }
            if (Array.isArray(material)) (child as any).material = material.map(cloneMaterial)
            else if (material) (child as any).material = cloneMaterial(material)
        })
        clone.name = options.name || `${source.name || sourceMetadata.id} (Runtime)`
        clone.visible = options.visible ?? true
        if (options.position) clone.position.set(...options.position)
        if (options.rotation) clone.rotation.set(...options.rotation)
        if (options.scale) clone.scale.set(...options.scale)
        clone.userData[KITE_AUTHORING_METADATA_KEY] = {
            schemaVersion: 1,
            role: 'runtime-instance',
            id: `${this.ownerId}:${++this.nextInstance}`,
            sourceId: sourceMetadata.id,
            ownerId: this.ownerId,
            overrides: [...new Set([
                ...(options.runtimeMutable || ['position', 'rotation']),
                ...(['position', 'rotation', 'scale', 'visible'] as const).filter(key => options[key] !== undefined),
                ...(clone.visible !== source.visible ? ['visible'] : []),
            ])],
        } satisfies KiteAuthoringMetadata
        parent.add(clone)
        this.instances.add(clone)
        return clone
    }

    cleanup() {
        for (const instance of this.instances) instance.removeFromParent()
        for (const material of this.materials) material.dispose?.()
        this.instances.clear()
        this.materials.clear()
    }
}

/** Create or reuse one bounded preview root for an authored generator. */
export function ensureKiteAuthoringPreview<T extends IObject3D>(
    generator: IObject3D,
    createPreview: () => T,
    updatePreview?: (preview: T) => void,
): T {
    const generatorMetadata = getKiteAuthoringMetadata(generator)
    if (generatorMetadata?.role !== 'generator') {
        throw new Error('Kite previews require a generator with stable authoring metadata')
    }
    const matches = generator.children.filter(child => {
        const metadata = getKiteAuthoringMetadata(child as IObject3D)
        return metadata?.role === 'preview' && metadata.sourceId === generatorMetadata.id
    }) as T[]
    let preview = matches.shift()
    for (const duplicate of matches) duplicate.removeFromParent()
    if (!preview) {
        preview = createPreview()
        preview.name ||= `${generator.name || generatorMetadata.id} Preview`
        setKiteAuthoringMetadata(preview, {
            role: 'preview', id: `${generatorMetadata.id}:preview`, sourceId: generatorMetadata.id,
        })
        generator.add(preview)
    }
    updatePreview?.(preview)
    generator.setDirty?.({source: 'KiteAuthoringPreview', change: 'children'})
    return preview
}

export interface KiteGameTelemetry {
    playerPosition: {x: number, y?: number, z: number} | null
    collected: number
    target: number
    exitUnlocked: boolean
    state: 'idle' | 'ready' | 'playing' | 'paused' | 'won' | 'lost' | 'restarting' | 'error'
    restartCount: number
}

export interface KiteGameValidationResult {
    status: 'pass' | 'fail'
    summary: string
    checks?: Record<string, boolean | number | string>
}

/** Publish a read-only, host-neutral playtest surface for Kite and test tools. */
export function publishKiteGameTelemetry(read: () => KiteGameTelemetry) {
    const api = Object.freeze({read})
    ;(window as any).kiteGame = api
    return () => {
        if ((window as any).kiteGame === api) delete (window as any).kiteGame
    }
}

/** Publish genre-neutral, project-defined gameplay assertions for the host. */
export function publishKiteGameValidation(read: () => KiteGameValidationResult) {
    const api = Object.freeze({read})
    ;(window as any).kiteGameValidation = api
    return () => {
        if ((window as any).kiteGameValidation === api) delete (window as any).kiteGameValidation
    }
}

/**
 * Register the component types that Kite guarantees in both the editor and a
 * standalone game. Game-specific component classes are supplied by the caller.
 */
export function registerKiteGameComponentTypes(
    viewer: ThreeViewer,
    componentTypes: TObject3DComponent[] = [],
) {
    const entities = viewer.getPlugin(EntityComponentPlugin)
    if (!entities) throw new Error('Kite game runtime requires EntityComponentPlugin')

    const supportedTypes = [HtmlUiComponent, ...componentTypes]
    for (const componentType of supportedTypes) {
        if (!componentType?.ComponentType) continue
        entities.addComponentType(componentType)
    }
    return entities
}

/**
 * Install Kite's supported game runtime in the order required by the Cannon
 * component implementation. The caller owns scene loading and starting ECP.
 */
export async function installKiteGameRuntime(
    viewer: ThreeViewer,
    options: {
        componentTypes?: TObject3DComponent[]
        physicsRunning?: boolean
        editorWidgets?: boolean
    } = {},
) {
    let entities = viewer.getPlugin(EntityComponentPlugin)
    if (!entities) entities = viewer.addPluginSync(new EntityComponentPlugin(false))

    registerKiteGameComponentTypes(viewer, options.componentTypes)

    if (!viewer.getPlugin(Object3DWidgetsPlugin)) {
        viewer.addPluginSync(new Object3DWidgetsPlugin(options.editorWidgets ?? false))
    }

    let physics = viewer.getPlugin(CannonPhysicsPlugin)
    if (!physics) physics = await viewer.addPlugin(new CannonPhysicsPlugin())
    physics.running = options.physicsRunning ?? false

    return {entities, physics}
}
