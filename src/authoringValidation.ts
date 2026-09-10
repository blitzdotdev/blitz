import {
    Box3,
    EntityComponentPlugin,
    Frustum,
    Matrix4,
    Vector3,
    type IObject3D,
    type ThreeViewer,
} from 'threepipe'
import {
    BLITZ_AUTHORING_METADATA_KEY,
    getAuthoringMetadata,
    getRuntimeObjectMetadata,
    getTrackedRuntimeObjects,
    type AuthoringMetadata,
    type RuntimeMutableProperty,
} from './authoring.ts'

export type AuthoringFailureCode =
    | 'NO_VISIBLE_AUTHORED_CONTENT'
    | 'GENERATOR_PREVIEW_MISSING'
    | 'RUNTIME_OBJECT_AFTER_STOP'
    | 'MISSING_AUTHORING_SOURCE'
    | 'RUNTIME_SOURCE_DRIFT'
    | 'CAMERA_NOT_USEFUL'
    | 'CAMERA_CONTAINMENT_UNVERIFIED'
    | 'PERSISTENCE_DRIFT'

export interface AuthoringValidationIssue {
    code: AuthoringFailureCode
    severity: 'error' | 'warning'
    message: string
    object?: {uuid: string, name: string}
    path?: string
    before?: unknown
    after?: unknown
}

export interface AuthoringQualityReport {
    ok: boolean
    status: 'pass' | 'fail'
    summary: string
    issues: AuthoringValidationIssue[]
    checks: {
        visibleAuthoredContent: boolean
        selectableAuthoredContent: boolean
        relationshipsValid: boolean
        generatorPreviews: boolean
        cameraUseful: boolean
    }
    metrics: {
        authoredObjectCount: number
        renderableCount: number
        visibleRenderableCount: number
        selectableCount: number
        generatorCount: number
        generatorPreviewCount: number
        cameraFramedRenderableCount: number
        cameraInsideRenderableCount: number
    }
}

export interface RuntimeCleanupReport {
    ok: boolean
    status: 'pass' | 'fail'
    summary: string
    issues: AuthoringValidationIssue[]
    trackedObjectCount: number
    outsideRenderableCount: number
}

export interface SemanticSceneSnapshot {
    schemaVersion: 1
    scene: unknown[]
}

export interface PersistenceChange {
    path: string
    before: unknown
    after: unknown
}

export interface PersistenceReport {
    ok: boolean
    status: 'pass' | 'fail'
    summary: string
    issues: AuthoringValidationIssue[]
    changes: PersistenceChange[]
    beforeBytes: number
    afterBytes: number
}

type ViewerLike = Pick<ThreeViewer, 'scene'>
type SceneLike = IObject3D & {modelRoot: IObject3D, mainCamera?: IObject3D, defaultCamera?: IObject3D}

interface SourceRecord {
    object: IObject3D
    metadata: AuthoringMetadata
}

/** Validate the stopped authoring hierarchy, its sources, previews, and saved camera. */
export function authoringQualityReport(viewer: ViewerLike): AuthoringQualityReport {
    const scene = viewer.scene as SceneLike
    if (!scene?.modelRoot) throw new Error('Authoring validation requires viewer.scene.modelRoot')
    scene.updateMatrixWorld(true)

    const issues: AuthoringValidationIssue[] = []
    const sources = collectSources(scene.modelRoot)
    const generators: SourceRecord[] = []
    const previews: SourceRecord[] = []
    const boundedPreviewSourceIds = new Set<string>()
    const visibleBounds: Array<{object: IObject3D, bounds: Box3}> = []
    let authoredObjectCount = 0
    let renderableCount = 0
    let visibleRenderableCount = 0
    let selectableCount = 0

    scene.modelRoot.traverse((object) => {
        if (object === scene.modelRoot) return
        authoredObjectCount += 1
        const metadata = getAuthoringMetadata(object)
        if (metadata?.role === 'generator' && !metadata.sourceId) generators.push({object, metadata})
        if (metadata?.role === 'generator' && metadata.sourceId) previews.push({object, metadata})
        if (!isRenderable(object)) return
        renderableCount += 1
        if (!isEffectivelyVisible(object, scene.modelRoot)) return
        visibleRenderableCount += 1
        if (isSelectable(object)) selectableCount += 1
        const bounds = new Box3().setFromObject(object)
        if (!bounds.isEmpty() && finiteVector(bounds.min) && finiteVector(bounds.max)) {
            visibleBounds.push({object, bounds})
            if (metadata?.role === 'generator' && metadata.sourceId) boundedPreviewSourceIds.add(metadata.sourceId)
        }
    })

    for (const preview of previews) {
        const source = sources.get(preview.metadata.sourceId || '')
        if (!source || source.metadata.role !== 'generator') {
            pushIssue(issues, {
                code: 'MISSING_AUTHORING_SOURCE',
                severity: 'error',
                message: `Generator output source "${preview.metadata.sourceId || '(missing)'}" is not present beneath modelRoot.`,
                object: objectEvidence(preview.object),
            })
        }
    }
    for (const generator of generators) {
        if (!boundedPreviewSourceIds.has(generator.metadata.id)) {
            pushIssue(issues, {
                code: 'GENERATOR_PREVIEW_MISSING',
                severity: 'error',
                message: 'An authored generator needs a bounded stopped-mode preview.',
                object: objectEvidence(generator.object),
            })
        }
    }
    issues.push(...runtimeRelationshipIssues(scene, sources))

    if (visibleRenderableCount === 0 || selectableCount === 0) {
        issues.push({
            code: 'NO_VISIBLE_AUTHORED_CONTENT',
            severity: 'error',
            message: visibleRenderableCount === 0
                ? 'No visible renderable authored content exists beneath modelRoot.'
                : 'Visible authored renderables are not selectable.',
        })
    }

    const camera = scene.mainCamera || scene.defaultCamera
    const cameraResult = validateCamera(camera, visibleBounds, issues)
    const errors = issues.filter(({severity}) => severity === 'error')
    const relationshipsValid = !errors.some(({code}) =>
        code === 'MISSING_AUTHORING_SOURCE' || code === 'RUNTIME_SOURCE_DRIFT')
    const generatorPreviews = !errors.some(({code}) => code === 'GENERATOR_PREVIEW_MISSING')
    const ok = errors.length === 0
    return {
        ok,
        status: ok ? 'pass' : 'fail',
        summary: ok ? 'Stopped-mode authored representation passed.' : `${errors.length} authoring check(s) failed.`,
        issues,
        checks: {
            visibleAuthoredContent: visibleRenderableCount > 0,
            selectableAuthoredContent: selectableCount > 0,
            relationshipsValid,
            generatorPreviews,
            cameraUseful: cameraResult.useful,
        },
        metrics: {
            authoredObjectCount,
            renderableCount,
            visibleRenderableCount,
            selectableCount,
            generatorCount: generators.length,
            generatorPreviewCount: boundedPreviewSourceIds.size,
            cameraFramedRenderableCount: cameraResult.framed,
            cameraInsideRenderableCount: cameraResult.inside,
        },
    }
}

/** Validate that Play-only content was removed and its authored sources stayed valid. */
export function runtimeCleanupReport(viewer: ViewerLike): RuntimeCleanupReport {
    const scene = viewer.scene as SceneLike
    if (!scene?.modelRoot) throw new Error('Runtime cleanup validation requires viewer.scene.modelRoot')
    scene.updateMatrixWorld(true)
    const issues = runtimeRelationshipIssues(scene, collectSources(scene.modelRoot))
    const tracked = getTrackedRuntimeObjects(scene)
    const leaked = new Set<IObject3D>()
    let outsideRenderableCount = 0

    for (const object of tracked) {
        if (!hasRuntimeAncestor(object, leaked)) leaked.add(object)
    }
    scene.traverse((object) => {
        if (object === scene || object === scene.modelRoot || isInside(object, scene.modelRoot) || isEditorObject(object, scene)) return
        if (isRenderable(object)) outsideRenderableCount += 1
        const runtimeRoot = nearestRuntimeRoot(object)
        if (runtimeRoot) {
            if (!hasRuntimeAncestor(runtimeRoot, leaked)) leaked.add(runtimeRoot)
        } else if (isRenderable(object)) {
            leaked.add(object)
        }
    })
    for (const object of leaked) {
        pushIssue(issues, {
            code: 'RUNTIME_OBJECT_AFTER_STOP',
            severity: 'error',
            message: getRuntimeObjectMetadata(object)
                ? 'A tracked runtime object remains after Stop.'
                : 'An unmarked renderable remains outside modelRoot after Stop.',
            object: objectEvidence(object),
        })
    }
    const ok = !issues.some(({severity}) => severity === 'error')
    return {
        ok,
        status: ok ? 'pass' : 'fail',
        summary: ok ? 'Runtime cleanup passed.' : `${issues.filter(({severity}) => severity === 'error').length} runtime cleanup check(s) failed.`,
        issues,
        trackedObjectCount: tracked.length,
        outsideRenderableCount,
    }
}

/** Capture the supported saved semantics without transient engine identities. */
export function semanticSceneSnapshot(source: ViewerLike | SceneLike): SemanticSceneSnapshot {
    const scene = 'scene' in source ? source.scene as SceneLike : source
    if (!scene?.modelRoot) throw new Error('A semantic snapshot requires scene.modelRoot')
    return {
        schemaVersion: 1,
        scene: scene.modelRoot.children.map((object) => serializeObject(object)),
    }
}

/** Compare names, transforms, component state, and authored source relationships. */
export function persistenceReport(before: unknown, after: unknown): PersistenceReport {
    const beforeValue = canonicalValue(toSemanticSnapshot(before))
    const afterValue = canonicalValue(toSemanticSnapshot(after))
    const beforeText = JSON.stringify(beforeValue)
    const afterText = JSON.stringify(afterValue)
    const changes: PersistenceChange[] = []
    compareValues(beforeValue, afterValue, '', changes)
    const issues: AuthoringValidationIssue[] = changes.map((change) => ({
        code: 'PERSISTENCE_DRIFT',
        severity: 'error',
        message: `Saved authoring semantics changed at ${change.path || '/'}.`,
        ...change,
    }))
    const ok = changes.length === 0
    return {
        ok,
        status: ok ? 'pass' : 'fail',
        summary: ok ? 'Save/Reload semantic equivalence passed.' : `${changes.length} persisted semantic difference(s) found.`,
        issues,
        changes,
        beforeBytes: beforeText.length,
        afterBytes: afterText.length,
    }
}

export interface GameValidationResult {
    status: 'pass' | 'fail'
    summary: string
    checks?: Record<string, boolean | number | string>
}

export interface GameValidationReport {
    ok: boolean
    status: 'pass' | 'fail'
    summary: string
    results: GameValidationResult[]
}

export type GameValidationFunction = () => GameValidationResult | boolean | void | Promise<GameValidationResult | boolean | void>

interface GameHookHost {
    registerGameValidation(fn: GameValidationFunction): () => void
    publishGameTelemetry(value: object): () => void
    runGameValidation(): Promise<GameValidationReport>
    dispose(): void
}

let activeGameHooks: GameHookHost | undefined

/** Register a project-defined gameplay assertion for the currently starting game. */
export function registerGameValidation(fn: GameValidationFunction): () => void {
    if (!activeGameHooks) throw new Error('registerGameValidation must be called while createGame is active')
    return activeGameHooks.registerGameValidation(fn)
}

/** Publish an immutable telemetry snapshot on window.blitzGame.telemetry. */
export function publishGameTelemetry(value: object): () => void {
    if (!activeGameHooks) throw new Error('publishGameTelemetry must be called while createGame is active')
    return activeGameHooks.publishGameTelemetry(value)
}

/** Install the per-createGame hook host before project modules are evaluated. */
export function installGameHooks(): GameHookHost {
    const validations = new Set<GameValidationFunction>()
    let telemetry: object | undefined
    let disposed = false
    const api = Object.freeze({
        get telemetry() { return telemetry },
        validate: () => host.runGameValidation(),
    })
    const host: GameHookHost = {
        registerGameValidation(fn) {
            if (disposed || typeof fn !== 'function') throw new Error('Game validation must be a function on an active game')
            validations.add(fn)
            return () => validations.delete(fn)
        },
        publishGameTelemetry(value) {
            if (disposed || !value || typeof value !== 'object' || Array.isArray(value)) {
                throw new Error('Game telemetry must be an object on an active game')
            }
            const published = immutableCopy(value)
            telemetry = published
            return () => {
                if (telemetry === published) telemetry = undefined
            }
        },
        async runGameValidation() {
            const results: GameValidationResult[] = []
            for (const validate of validations) {
                try {
                    const result = await validate()
                    if (result === undefined || result === true) {
                        results.push({status: 'pass', summary: 'Project validation passed.'})
                    } else if (result === false) {
                        results.push({status: 'fail', summary: 'Project validation failed.'})
                    } else if (result && ['pass', 'fail'].includes(result.status) && typeof result.summary === 'string') {
                        results.push(result)
                    } else {
                        results.push({status: 'fail', summary: 'Project validation returned an invalid result.'})
                    }
                } catch (error) {
                    results.push({status: 'fail', summary: `Project validation threw: ${errorMessage(error)}`})
                }
            }
            const failed = results.filter(({status}) => status === 'fail')
            return {
                ok: failed.length === 0,
                status: failed.length ? 'fail' : 'pass',
                summary: failed.length ? failed.map(({summary}) => summary).join(' ') : 'Project validations passed.',
                results,
            }
        },
        dispose() {
            disposed = true
            validations.clear()
            telemetry = undefined
            if (activeGameHooks === host) activeGameHooks = undefined
            if (typeof window !== 'undefined' && window.blitzGame === api) delete window.blitzGame
        },
    }
    activeGameHooks?.dispose()
    activeGameHooks = host
    if (typeof window !== 'undefined') window.blitzGame = api
    return host
}

function collectSources(modelRoot: IObject3D): Map<string, SourceRecord> {
    const sources = new Map<string, SourceRecord>()
    modelRoot.traverse((object) => {
        if (object === modelRoot) return
        const metadata = getAuthoringMetadata(object)
        if (metadata && !metadata.sourceId) sources.set(metadata.id, {object, metadata})
        else if (!metadata) sources.set(object.uuid, {object, metadata: {role: 'direct', id: object.uuid}})
    })
    return sources
}

function runtimeRelationshipIssues(scene: SceneLike, sources: Map<string, SourceRecord>): AuthoringValidationIssue[] {
    const issues: AuthoringValidationIssue[] = []
    scene.traverse((object) => {
        const metadata = getAuthoringMetadata(object)
        if (!metadata?.sourceId) return
        const source = sources.get(metadata.sourceId)
        if (!source) {
            pushIssue(issues, {
                code: 'MISSING_AUTHORING_SOURCE',
                severity: 'error',
                message: `Authored source "${metadata.sourceId}" is not present beneath modelRoot.`,
                object: objectEvidence(object),
            })
            return
        }
        const runtime = getRuntimeObjectMetadata(object)
        if (!runtime || runtime.kind === 'effect' || source.metadata.role === 'generator') return
        const overrides = new Set<RuntimeMutableProperty>(runtime.overrides || [])
        if (JSON.stringify(runtimeSignature(source.object, overrides)) !== JSON.stringify(runtimeSignature(object, overrides))) {
            pushIssue(issues, {
                code: 'RUNTIME_SOURCE_DRIFT',
                severity: 'error',
                message: 'A runtime copy differs from its authored source in a non-mutable field.',
                object: objectEvidence(object),
            })
        }
    })
    return issues
}

function validateCamera(
    camera: IObject3D | undefined,
    renderables: Array<{object: IObject3D, bounds: Box3}>,
    issues: AuthoringValidationIssue[],
): {useful: boolean, framed: number, inside: number} {
    let framed = 0
    let inside = 0
    let facing = false
    let problem = 'The saved camera must be finite and face visible authored content.'
    const projectionMatrix = (camera as IObject3D & {projectionMatrix?: Matrix4, matrixWorldInverse?: Matrix4})?.projectionMatrix
    const matrixWorldInverse = (camera as IObject3D & {projectionMatrix?: Matrix4, matrixWorldInverse?: Matrix4})?.matrixWorldInverse
    if (camera && finiteVector(camera.position) && projectionMatrix && matrixWorldInverse && renderables.length) {
        camera.updateMatrixWorld(true)
        ;(camera as IObject3D & {updateProjectionMatrix?: () => void}).updateProjectionMatrix?.()
        const cameraPosition = camera.getWorldPosition(new Vector3())
        const totalBounds = new Box3().makeEmpty()
        for (const {bounds} of renderables) totalBounds.union(bounds)
        const center = totalBounds.getCenter(new Vector3())
        const direction = (camera as IObject3D & {getWorldDirection?: (target: Vector3) => Vector3}).getWorldDirection?.(new Vector3())
        const toward = center.clone().sub(cameraPosition)
        facing = !direction || toward.lengthSq() === 0 || direction.dot(toward.normalize()) > 0
        const frustum = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(projectionMatrix, matrixWorldInverse))
        framed = renderables.filter(({bounds}) => frustum.intersectsBox(bounds)).length

        for (const {object, bounds} of renderables) {
            if (cameraInsideAllowed(object) || !bounds.containsPoint(cameraPosition)) continue
            const mesh = object as IObject3D & {
                isMesh?: boolean
                isInstancedMesh?: boolean
                isSkinnedMesh?: boolean
                geometry?: {
                    type?: string
                    boundingBox?: Box3
                    morphAttributes?: {position?: unknown[]}
                    computeBoundingBox?(): void
                }
            }
            const geometry = mesh.geometry
            const deformed = mesh.isInstancedMesh || mesh.isSkinnedMesh || geometry?.morphAttributes?.position?.length
            if (!geometry || deformed || object.matrixWorld.determinant() === 0) {
                addContainmentWarning(issues, object)
                continue
            }
            geometry.computeBoundingBox?.()
            const localPosition = object.worldToLocal(cameraPosition.clone())
            if (!geometry.boundingBox?.containsPoint(localPosition)) continue
            if (mesh.isMesh && geometry.type === 'BoxGeometry') inside += 1
            else addContainmentWarning(issues, object)
        }
        if (inside) problem = `The saved camera is inside ${inside} visible authored mesh(es).`
        else if (!framed) problem = 'No visible authored renderable intersects the saved camera frustum.'
        else if (!facing) problem = 'The saved camera faces away from visible authored content.'
    }
    const useful = Boolean(camera && renderables.length && framed > 0 && inside === 0 && facing)
    if (!useful) issues.push({code: 'CAMERA_NOT_USEFUL', severity: 'error', message: problem})
    return {useful, framed, inside}
}

function addContainmentWarning(issues: AuthoringValidationIssue[], object: IObject3D): void {
    pushIssue(issues, {
        code: 'CAMERA_CONTAINMENT_UNVERIFIED',
        severity: 'warning',
        message: 'The camera intersects local geometry bounds, but hollow or imported mesh containment is unverified.',
        object: objectEvidence(object),
    })
}

function runtimeSignature(object: IObject3D, overrides: Set<RuntimeMutableProperty>, root = true): unknown {
    const renderable = object as IObject3D & {geometry?: {parameters?: unknown}, material?: unknown | unknown[]}
    const result: Record<string, unknown> = {
        type: semanticType(object),
        geometry: canonicalValue(renderable.geometry?.parameters),
        children: object.children.map((child) => runtimeSignature(child, new Set(), false)),
    }
    if (!root || !overrides.has('visible')) result.visible = object.visible
    if (!root || !overrides.has('position')) result.position = vectorValue(object.position)
    if (!root || !overrides.has('rotation')) result.rotation = vectorValue(object.rotation)
    if (!root || !overrides.has('scale')) result.scale = vectorValue(object.scale)
    if (renderable.material && (!root || !overrides.has('material'))) {
        result.material = Array.isArray(renderable.material)
            ? renderable.material.map(materialValue)
            : materialValue(renderable.material)
    }
    return result
}

function materialValue(value: unknown): unknown {
    const material = value as {
        type?: string
        color?: {getHex?(): number}
        emissive?: {getHex?(): number}
        opacity?: number
        transparent?: boolean
        metalness?: number
        roughness?: number
    }
    return canonicalValue({
        type: material?.type,
        color: material?.color?.getHex?.(),
        emissive: material?.emissive?.getHex?.(),
        opacity: material?.opacity,
        transparent: material?.transparent,
        metalness: material?.metalness,
        roughness: material?.roughness,
    })
}

function serializeObject(object: IObject3D): unknown {
    const metadata = getAuthoringMetadata(object)
    return canonicalValue({
        name: object.name,
        type: semanticType(object),
        visible: object.visible,
        position: vectorValue(object.position),
        rotation: vectorValue(object.rotation),
        scale: vectorValue(object.scale),
        components: componentValues(object),
        ...(metadata ? {authoring: metadata} : {}),
        children: object.children.map((child) => serializeObject(child)),
    })
}

function componentValues(object: IObject3D): unknown[] {
    const live = EntityComponentPlugin.ObjectToComponents.get(object)
    if (live?.length) {
        return live.map((component) => {
            const definition = component.constructor as {ComponentType?: string, StateProperties?: Array<string | {name?: string, key?: string}>}
            const keys = (definition.StateProperties || []).map((property) =>
                typeof property === 'string' ? property : property.name || property.key).filter((key): key is string => Boolean(key))
            return canonicalValue({
                id: component.uuid,
                type: definition.ComponentType || component.constructor.name,
                state: Object.fromEntries(keys.map((key) => [key, semanticValue((component as unknown as Record<string, unknown>)[key])])),
            })
        }).sort(compareJson)
    }
    const saved = object.userData?.EntityComponentPlugin
    if (!isRecord(saved)) return []
    return Object.entries(saved).map(([id, value]) => {
        const component = isRecord(value) ? value : {}
        return canonicalValue({id, type: component.type, state: semanticValue(component.state)})
    }).sort(compareJson)
}

function toSemanticSnapshot(value: unknown): SemanticSceneSnapshot {
    if (typeof value === 'string') return toSemanticSnapshot(JSON.parse(value))
    if (value instanceof Uint8Array) return toSemanticSnapshot(JSON.parse(new TextDecoder().decode(value)))
    if (isRecord(value) && isRecord(value.document)) return gltfSemanticSnapshot(value.document)
    if (isRecord(value) && value.schemaVersion === 1 && Array.isArray(value.scene)) return value as unknown as SemanticSceneSnapshot
    if (isRecord(value) && isRecord(value.asset)) return gltfSemanticSnapshot(value)
    if (isRecord(value) && 'scene' in value) return semanticSceneSnapshot(value as unknown as ViewerLike)
    if (isRecord(value) && 'modelRoot' in value) return semanticSceneSnapshot(value as unknown as SceneLike)
    throw new Error('Persistence comparison requires a semantic snapshot, viewer, scene, or serialized glTF document')
}

function gltfSemanticSnapshot(document: Record<string, unknown>): SemanticSceneSnapshot {
    const nodes = Array.isArray(document.nodes) ? document.nodes : []
    const scenes = Array.isArray(document.scenes) ? document.scenes : []
    const sceneIndex = typeof document.scene === 'number' ? document.scene : 0
    const root = isRecord(scenes[sceneIndex]) ? scenes[sceneIndex] : {}
    const rootNodes = Array.isArray(root.nodes) ? root.nodes : []
    const visit = (index: unknown): unknown => {
        const node = typeof index === 'number' && isRecord(nodes[index]) ? nodes[index] : {}
        const extras = isRecord(node.extras) ? node.extras : {}
        const authoring = isRecord(extras[BLITZ_AUTHORING_METADATA_KEY]) ? extras[BLITZ_AUTHORING_METADATA_KEY] : undefined
        const savedComponents = isRecord(extras.EntityComponentPlugin) ? extras.EntityComponentPlugin : {}
        const components = Object.entries(savedComponents).map(([id, value]) => {
            const component = isRecord(value) ? value : {}
            return canonicalValue({id, type: component.type, state: semanticValue(component.state)})
        }).sort(compareJson)
        const translation = numericArray(node.translation, [0, 0, 0])
        const rotation = numericArray(node.rotation, [0, 0, 0, 1])
        const scale = numericArray(node.scale, [1, 1, 1])
        return canonicalValue({
            name: typeof node.name === 'string' ? node.name : '',
            type: typeof node.mesh === 'number' ? 'Mesh' : typeof node.camera === 'number' ? 'Camera' : 'Group',
            visible: extras.visible !== false,
            position: {x: translation[0], y: translation[1], z: translation[2]},
            quaternion: {x: rotation[0], y: rotation[1], z: rotation[2], w: rotation[3]},
            scale: {x: scale[0], y: scale[1], z: scale[2]},
            components,
            ...(authoring ? {authoring: semanticValue(authoring)} : {}),
            children: (Array.isArray(node.children) ? node.children : []).map(visit),
        })
    }
    return {schemaVersion: 1, scene: rootNodes.map(visit)}
}

function compareValues(left: unknown, right: unknown, path: string, changes: PersistenceChange[]): void {
    if (changes.length >= 50 || Object.is(left, right) || left === right) return
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object'
        || Array.isArray(left) !== Array.isArray(right)) {
        changes.push({path: path || '/', before: left, after: right})
        return
    }
    const leftRecord = left as Record<string, unknown>
    const rightRecord = right as Record<string, unknown>
    const keys = [...new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])].sort()
    for (const key of keys) compareValues(leftRecord[key], rightRecord[key], `${path}/${escapePointer(key)}`, changes)
}

function semanticValue(value: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
    if (typeof value === 'number') return normalizeNumber(value)
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
    if (value === undefined || typeof value === 'function') return undefined
    if (Array.isArray(value)) return value.map((item) => semanticValue(item, seen, depth + 1))
    if (typeof value !== 'object' || depth > 5) return String(value)
    if (seen.has(value)) return '[Circular]'
    seen.add(value)
    const candidate = value as Record<string, unknown> & {isColor?: boolean, getHexString?(): string, toArray?(): unknown[]}
    if (candidate.isColor && candidate.getHexString) return `#${candidate.getHexString()}`
    if (candidate.toArray && /Vector|Euler|Quaternion/.test(value.constructor?.name || '')) {
        return candidate.toArray().map((item) => semanticValue(item, seen, depth + 1))
    }
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(candidate).sort()) {
        if (key.startsWith('_') || ['id', 'uuid', 'uiConfig', 'object', 'ctx', 'body', 'world'].includes(key)) continue
        const normalized = semanticValue(candidate[key], seen, depth + 1)
        if (normalized !== undefined) result[key] = normalized
    }
    return result
}

function canonicalValue(value: unknown): unknown {
    if (typeof value === 'number') return normalizeNumber(value)
    if (Array.isArray(value)) return value.map(canonicalValue)
    if (!isRecord(value)) return value
    return Object.fromEntries(Object.keys(value).sort().flatMap((key) => {
        const child = canonicalValue(value[key])
        return child === undefined ? [] : [[key, child]]
    }))
}

function vectorValue(value: {x: number, y: number, z: number}): {x: number | null, y: number | null, z: number | null} {
    return {x: normalizeNumber(value.x), y: normalizeNumber(value.y), z: normalizeNumber(value.z)}
}

function normalizeNumber(value: number): number | null {
    if (!Number.isFinite(value)) return null
    const rounded = Math.round(value * 1_000_000) / 1_000_000
    return Object.is(rounded, -0) ? 0 : rounded
}

function numericArray(value: unknown, fallback: number[]): number[] {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'number')) return fallback
    return value.map((item) => normalizeNumber(item) ?? 0)
}

function immutableCopy<T extends object>(value: T): T {
    const copy = typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)) as T
    const freeze = (candidate: unknown): void => {
        if (!candidate || typeof candidate !== 'object' || Object.isFrozen(candidate)) return
        for (const child of Object.values(candidate)) freeze(child)
        Object.freeze(candidate)
    }
    freeze(copy)
    return copy
}

function pushIssue(issues: AuthoringValidationIssue[], issue: AuthoringValidationIssue): void {
    if (issues.some((candidate) => candidate.code === issue.code && candidate.object?.uuid === issue.object?.uuid
        && candidate.path === issue.path)) return
    issues.push(issue)
}

function objectEvidence(object: IObject3D): {uuid: string, name: string} {
    return {uuid: object.uuid, name: object.name || '(unnamed)'}
}

function isRenderable(object: IObject3D): boolean {
    const candidate = object as IObject3D & {isMesh?: boolean, isLine?: boolean, isPoints?: boolean, isSprite?: boolean}
    return Boolean(candidate.isMesh || candidate.isLine || candidate.isPoints || candidate.isSprite)
}

function isSelectable(object: IObject3D): boolean {
    return object.userData?.selectable !== false && !object.isWidget
}

function isEffectivelyVisible(object: IObject3D, modelRoot: IObject3D): boolean {
    for (let current: IObject3D | null = object; current; current = current.parent as IObject3D | null) {
        if (!current.visible) return false
        if (current === modelRoot) return true
    }
    return false
}

function isInside(object: IObject3D, ancestor: IObject3D): boolean {
    for (let current: IObject3D | null = object; current; current = current.parent as IObject3D | null) {
        if (current === ancestor) return true
    }
    return false
}

function isEditorObject(object: IObject3D, scene: SceneLike): boolean {
    if (object === scene.mainCamera || object === scene.defaultCamera) return true
    for (let current: IObject3D | null = object; current; current = current.parent as IObject3D | null) {
        if (current.isWidget) return true
    }
    return false
}

function nearestRuntimeRoot(object: IObject3D): IObject3D | undefined {
    for (let current: IObject3D | null = object; current; current = current.parent as IObject3D | null) {
        if (getRuntimeObjectMetadata(current)) return current
    }
    return undefined
}

function hasRuntimeAncestor(object: IObject3D, candidates: Set<IObject3D>): boolean {
    for (let current = object.parent as IObject3D | null; current; current = current.parent as IObject3D | null) {
        if (candidates.has(current)) return true
    }
    return false
}

function cameraInsideAllowed(object: IObject3D): boolean {
    for (let current: IObject3D | null = object; current; current = current.parent as IObject3D | null) {
        if (getAuthoringMetadata(current)?.allowCameraInside) return true
    }
    return false
}

function finiteVector(value: {x: number, y: number, z: number}): boolean {
    return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z)
}

function semanticType(object: IObject3D): string {
    const candidate = object as IObject3D & {isMesh?: boolean, isCamera?: boolean, isLight?: boolean}
    if (candidate.isMesh) return 'Mesh'
    if (candidate.isCamera) return 'Camera'
    if (candidate.isLight) return 'Light'
    return object.children.length ? 'Group' : object.type
}

function compareJson(left: unknown, right: unknown): number {
    return JSON.stringify(left).localeCompare(JSON.stringify(right))
}

function escapePointer(value: string): string {
    return value.replace(/~/g, '~0').replace(/\//g, '~1')
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

declare global {
    interface Window {
        blitzGame?: Readonly<{
            readonly telemetry: object | undefined
            validate(): Promise<GameValidationReport>
        }>
    }
}
