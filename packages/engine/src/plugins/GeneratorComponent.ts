import * as ThreePipe from 'threepipe'
import {
    type ComponentDefn,
    type IObject3D,
    Object3DComponent,
    type ThreeViewer,
} from 'threepipe'

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
}

export interface GeneratorViewerOptions {
    base: string | URL
    engine?: Record<string, unknown>
    importModule?: (url: string) => Promise<GeneratorModule>
    onError?: (error: unknown) => void
}

interface GeneratorViewerConfig {
    base: URL
    engine: Record<string, unknown>
    importModule: (url: string) => Promise<GeneratorModule>
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
    private runRevision = 0

    static configureViewer(viewer: ThreeViewer, options: GeneratorViewerOptions): void {
        viewerConfigs.set(viewer, {
            base: typeof options.base === 'string' ? new URL(options.base) : options.base,
            engine: options.engine || ThreePipe as unknown as Record<string, unknown>,
            importModule: options.importModule || importGeneratorModule,
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
        this.onStateChange('module', () => { void this.run() })
        this.onStateChange('params', () => { void this.run() })
        void this.run()
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
            engine: config.engine,
            module: this.module,
            base: config.base,
            importModule: config.importModule,
            revision: ++generatorImportRevision,
        }).then(() => {
            if (revision === this.runRevision) viewer.setDirty(this)
        }).catch((error) => {
            config.onError?.(error)
            if (!config.onError) console.error('[blitz] Generator error', error)
        }).finally(() => config.pending.delete(task))
        config.pending.add(task)
        await task
    }

    destroy(): Record<string, unknown> {
        this.runRevision += 1
        removeGeneratedChildren(this.object)
        return super.destroy()
    }
}

export interface RunGeneratorOptions extends GeneratorContext {
    module: string
    base: URL
    revision?: number
    importModule?: (url: string) => Promise<GeneratorModule>
}

export async function runGenerator({
    node,
    params,
    viewer,
    engine,
    module,
    base,
    revision = 0,
    importModule = importGeneratorModule,
}: RunGeneratorOptions): Promise<IObject3D[]> {
    removeGeneratedChildren(node)
    if (!module) return []
    const moduleUrl = resolveGeneratorModule(module, base)
    if (revision) moduleUrl.searchParams.set('blitz-generator', String(revision))
    const loaded = await importModule(moduleUrl.href)
    if (typeof loaded.default !== 'function') {
        throw new Error(`Generator module must have a default generate function: ${module}`)
    }

    const existingChildren = new Set(node.children)
    const returned = await loaded.default({node, params, viewer, engine})
    const returnedObjects = normalizeGeneratedResult(returned)
    for (const child of returnedObjects) {
        if (child.parent !== node) node.add(child)
    }

    const generated = node.children.filter((child) => !existingChildren.has(child)) as IObject3D[]
    for (const child of generated) markGenerated(child)
    return generated
}

export function removeGeneratedChildren(node: IObject3D): void {
    for (const child of [...node.children] as IObject3D[]) {
        if (child.userData.blitzGenerated !== true) continue
        node.remove(child)
    }
}

export function markGenerated(object: IObject3D): void {
    object.traverse((child: IObject3D) => {
        child.userData.blitzGenerated = true
        child.userData.excludeFromExport = true
    })
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
