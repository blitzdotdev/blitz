import * as ThreePipe from 'threepipe'
import {
    type ComponentDefn,
    type IObject3D,
    Object3DComponent,
    type ThreeViewer,
} from 'threepipe'
import {getAuthoringMetadata, setAuthoringMetadata, type AuthoringMetadata} from '../authoring.ts'
import {
    parseGeneratorParamsSchema,
    type GeneratorParamDefinition,
    type GeneratorParamSchema,
} from '../generatorParams.ts'

export interface GeneratorParams {
    [key: string]: unknown
}

export interface GeneratorContext {
    node: IObject3D
    params: GeneratorParams
    viewer: ThreeViewer
    engine: Record<string, unknown>
}

export interface GeneratorModule {
    default?: (context: GeneratorContext) => unknown | Promise<unknown>
    params?: Record<string, GeneratorParamDefinition>
}

export interface GeneratorViewerOptions {
    base: string | URL
    onError?: (error: unknown) => void
}

interface GeneratorViewerConfig {
    base: URL
    onError?: (error: unknown) => void
    pending: Set<Promise<void>>
}

const viewerConfigs = new WeakMap<ThreeViewer, GeneratorViewerConfig>()
let generatorImportRevision = 0

export class GeneratorComponent extends Object3DComponent {
    static ComponentType = 'Generator'
    static StateProperties: ComponentDefn['StateProperties'] = ['module', 'params']

    module = ''
    params: GeneratorParams = {}
    schema: GeneratorParamSchema = {}
    private runRevision = 0

    static configureViewer(viewer: ThreeViewer, options: GeneratorViewerOptions): void {
        viewerConfigs.set(viewer, {
            base: typeof options.base === 'string' ? new URL(options.base) : options.base,
            onError: options.onError,
            pending: new Set(),
        })
    }

    static async waitForViewer(viewer: ThreeViewer): Promise<void> {
        const config = viewerConfigs.get(viewer)
        while (config?.pending.size) await Promise.all([...config.pending])
    }

    init(object: IObject3D, state: Record<string, unknown>): void {
        super.init(object, state)
        const run = () => { void this.run().catch((error) => reportGeneratorError(this.ctx.viewer, error)) }
        this.onStateChange('module', run)
        this.onStateChange('params', run)
        run()
    }

    async run(): Promise<void> {
        const viewer = this.ctx.viewer
        const config = viewerConfigs.get(viewer)
        if (!config) throw new Error('Generator viewer is not configured')
        const revision = ++this.runRevision
        const task = runGenerator({
            node: this.object,
            params: this.params,
            viewer,
            module: this.module,
            base: config.base,
            revision: ++generatorImportRevision,
            isCurrent: () => revision === this.runRevision,
            onSchema: (schema) => { this.schema = schema },
        }).then(() => {
            if (revision === this.runRevision) viewer.setDirty(this)
        }).finally(() => config.pending.delete(task))
        config.pending.add(task)
        await task
    }

    async bake(): Promise<number> {
        await this.run()
        const node = this.object
        const generated = node.children.filter((child) => child.userData.kite3dGenerated === true)
        const bakedFrom = {
            module: this.module,
            params: JSON.parse(JSON.stringify(this.params)) as GeneratorParams,
            ts: new Date().toISOString(),
        }
        for (const child of generated) unmarkGenerated(child as IObject3D)
        this.ctx.ecp.removeComponent(node, this.uuid)
        const metadata = getAuthoringMetadata(node)
        if (metadata?.role === 'generator' && !metadata.sourceId) {
            setAuthoringMetadata(node, {
                role: 'direct',
                id: metadata.id,
                ...(metadata.allowCameraInside !== undefined ? {allowCameraInside: metadata.allowCameraInside} : {}),
            })
        }
        node.userData.kite3dBakedFrom = bakedFrom
        node._sChildren = [...node.children]
        node.setDirty?.({change: 'userData.kite3dBakedFrom', source: 'kite3d bake'})
        return generated.length
    }

    destroy(): Record<string, unknown> {
        this.runRevision += 1
        removeGeneratedChildren(this.object)
        return super.destroy()
    }
}

export interface RunGeneratorOptions extends Omit<GeneratorContext, 'engine'> {
    module: string
    base: URL
    revision?: number
    isCurrent?: () => boolean
    onSchema?: (schema: GeneratorParamSchema) => void
}

export async function runGenerator({
    node,
    params,
    viewer,
    module,
    base,
    revision = 0,
    isCurrent,
    onSchema,
}: RunGeneratorOptions): Promise<IObject3D[]> {
    removeGeneratedChildren(node)
    onSchema?.({})
    if (!module) return []
    const source = ensureGeneratorMetadata(node)
    const moduleUrl = resolveGeneratorModule(module, base)
    if (revision) moduleUrl.searchParams.set('kite3d-generator', String(revision))
    const loaded = await importGeneratorModule(moduleUrl.href)
    onSchema?.(parseGeneratorParamsSchema(loaded.params, module))
    if (typeof loaded.default !== 'function') {
        throw new Error(`Generator module must have a default generate function: ${module}`)
    }

    const existingChildren = new Set(node.children)
    const returned = await loaded.default({
        node,
        params,
        viewer,
        engine: ThreePipe as unknown as Record<string, unknown>,
    })
    const returnedObjects = normalizeGeneratedResult(returned)
    for (const [index, child] of returnedObjects.entries()) {
        if (child.parent === node) continue
        markGenerated(child, source.id, index)
        node.add(child)
    }

    const generated = node.children.filter((child) => !existingChildren.has(child)) as IObject3D[]
    if (isCurrent && !isCurrent()) {
        for (const child of generated) removeGeneratedObject(child)
        return []
    }
    generated.forEach((child, index) => markGenerated(child, source.id, index))
    return generated
}

export function removeGeneratedChildren(node: IObject3D): void {
    for (const child of [...node.children] as IObject3D[]) {
        if (child.userData.kite3dGenerated !== true) continue
        removeGeneratedObject(child)
    }
}

export function markGenerated(object: IObject3D, sourceId?: string, outputIndex = 0): void {
    let descendantIndex = 0
    object.traverse((child: IObject3D) => {
        child.userData.kite3dGenerated = true
        child.userData.excludeFromExport = true
        if (sourceId) {
            child.userData.kite3dAuthoring = {
                role: 'generator',
                id: `${sourceId}:preview:${outputIndex}:${descendantIndex++}`,
                sourceId,
            } satisfies AuthoringMetadata
        }
    })
}

function unmarkGenerated(object: IObject3D): void {
    object.traverse((child: IObject3D) => {
        delete child.userData.kite3dGenerated
        delete child.userData.excludeFromExport
        const metadata = getAuthoringMetadata(child)
        if (metadata?.role === 'generator' && metadata.sourceId) delete child.userData.kite3dAuthoring
    })
}

function ensureGeneratorMetadata(node: IObject3D): AuthoringMetadata {
    const current = getAuthoringMetadata(node)
    if (current?.role === 'generator' && !current.sourceId) return current
    const savedId = typeof node.userData.gltfUUID === 'string' && node.userData.gltfUUID.trim()
        ? node.userData.gltfUUID.trim()
        : current?.id || generatorPathId(node)
    setAuthoringMetadata(node, {role: 'generator', id: savedId})
    return getAuthoringMetadata(node)!
}

function generatorPathId(node: IObject3D): string {
    const parts: string[] = []
    for (let current: IObject3D | null = node; current?.parent; current = current.parent as IObject3D) {
        const index = current.parent.children.indexOf(current)
        parts.push(`${current.name || current.type}:${index}`)
        if (current.parent.userData?.rootSceneModelRoot) break
    }
    return `generator:${parts.reverse().join('/')}`
}

function removeGeneratedObject(object: IObject3D): void {
    object.removeFromParent()
    const disposed = new Set<object>()
    object.traverse((child) => {
        const renderable = child as IObject3D & {geometry?: {dispose?(): void}, material?: unknown | unknown[]}
        disposeResource(renderable.geometry, disposed)
        const materials = Array.isArray(renderable.material) ? renderable.material : [renderable.material]
        for (const material of materials) {
            if (!material || typeof material !== 'object') continue
            for (const value of Object.values(material)) {
                if (value && typeof value === 'object' && 'isTexture' in value) disposeResource(value, disposed)
            }
            disposeResource(material, disposed)
        }
    })
}

function disposeResource(resource: unknown, disposed: Set<object>): void {
    if (!resource || typeof resource !== 'object' || disposed.has(resource)) return
    disposed.add(resource)
    ;(resource as {dispose?(): void}).dispose?.()
}

export function resolveGeneratorModule(module: string, base: URL): URL {
    if (!module || module.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(module)) {
        throw new Error(`Generator module must be a project-relative path: ${module}`)
    }
    const resolved = new URL(module, base)
    if (resolved.origin !== base.origin) {
        throw new Error(`Generator module must be same-origin: ${resolved.href}`)
    }
    return resolved
}

function normalizeGeneratedResult(value: unknown): IObject3D[] {
    if (!value) return []
    const values = Array.isArray(value) ? value : [value]
    const objects: IObject3D[] = []
    for (const candidate of values) {
        if (!(candidate as IObject3D | undefined)?.isObject3D) {
            throw new Error('Generator output must be an Object3D, an array of Object3D values, or undefined')
        }
        objects.push(candidate as IObject3D)
    }
    return objects
}

async function importGeneratorModule(url: string): Promise<GeneratorModule> {
    return import(/* @vite-ignore */ url) as Promise<GeneratorModule>
}

function reportGeneratorError(viewer: ThreeViewer, error: unknown): void {
    const onError = viewerConfigs.get(viewer)?.onError
    if (onError) onError(error)
    else console.error('[kite3d] Generator error', error)
}
