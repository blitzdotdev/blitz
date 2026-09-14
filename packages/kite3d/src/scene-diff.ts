export interface SceneIdentity {
    name?: string
    uuid?: string
}

export interface SceneNodeRename {
    uuid?: string
    oldName?: string
    newName?: string
}

export interface SceneTransformChange {
    node: SceneIdentity
    property: 'position' | 'rotation' | 'scale'
    old: number[] | undefined
    new: number[] | undefined
}

export interface SceneComponentChange {
    node: SceneIdentity
    id: string
    type?: string
    change: 'added' | 'removed' | 'state'
    old?: unknown
    new?: unknown
}

export interface SceneMaterialChange {
    material: SceneIdentity
    nodes: SceneIdentity[]
    property: string
    old?: unknown
    new?: unknown
}

export interface SceneDiff {
    nodesAdded: SceneIdentity[]
    nodesRemoved: SceneIdentity[]
    nodesRenamed: SceneNodeRename[]
    transforms: SceneTransformChange[]
    components: SceneComponentChange[]
    materials: SceneMaterialChange[]
    errors?: string[]
}

interface GltfNode {
    name?: string
    mesh?: number
    extras?: Record<string, unknown>
    translation?: number[]
    rotation?: number[]
    scale?: number[]
    matrix?: number[]
}

interface GltfMaterial {
    name?: string
    extras?: Record<string, unknown>
    [key: string]: unknown
}

interface GltfDocument {
    nodes?: GltfNode[]
    meshes?: Array<{primitives?: Array<{material?: number}>}>
    materials?: GltfMaterial[]
}

interface NodeMatch {
    before: number
    after: number
}

export function diffSceneGltf(beforeValue: unknown, afterValue: unknown): SceneDiff {
    const before = isRecord(beforeValue) ? beforeValue as GltfDocument : {}
    const after = isRecord(afterValue) ? afterValue as GltfDocument : {}
    const beforeNodes = before.nodes || []
    const afterNodes = after.nodes || []
    const matches = matchItems(beforeNodes, afterNodes, nodeIdentity)
    const matchedBefore = new Set(matches.map(({before: index}) => index))
    const matchedAfter = new Set(matches.map(({after: index}) => index))
    const diff: SceneDiff = {
        nodesAdded: afterNodes.flatMap((node, index) => matchedAfter.has(index) ? [] : [nodeIdentity(node)]),
        nodesRemoved: beforeNodes.flatMap((node, index) => matchedBefore.has(index) ? [] : [nodeIdentity(node)]),
        nodesRenamed: [],
        transforms: [],
        components: [],
        materials: [],
    }

    for (const match of matches) {
        const oldNode = beforeNodes[match.before]
        const newNode = afterNodes[match.after]
        const identity = mergeIdentity(nodeIdentity(oldNode), nodeIdentity(newNode))
        if (oldNode.name !== newNode.name) {
            diff.nodesRenamed.push({uuid: identity.uuid, oldName: oldNode.name, newName: newNode.name})
        }
        compareNodeTransform(diff, identity, 'position', oldNode, newNode)
        compareNodeTransform(diff, identity, 'rotation', oldNode, newNode)
        compareNodeTransform(diff, identity, 'scale', oldNode, newNode)
        compareComponents(diff, identity, oldNode, newNode)
    }

    compareMaterials(diff, before, after)
    return diff
}

export function diffSceneGltfText(beforeText: string | undefined, afterText: string): SceneDiff {
    const errors: string[] = []
    let before: unknown = {}
    let after: unknown = {}
    if (beforeText) {
        try { before = JSON.parse(beforeText) as unknown } catch (error) { errors.push(`before: ${errorMessage(error)}`) }
    }
    try { after = JSON.parse(afterText) as unknown } catch (error) { errors.push(`after: ${errorMessage(error)}`) }
    const diff = diffSceneGltf(before, after)
    if (errors.length) diff.errors = errors
    return diff
}

function compareTransform(
    diff: SceneDiff,
    node: SceneIdentity,
    property: SceneTransformChange['property'],
    oldValue: number[] | undefined,
    newValue: number[] | undefined,
): void {
    if (jsonEqual(oldValue, newValue)) return
    diff.transforms.push({node, property, old: oldValue, new: newValue})
}

function compareNodeTransform(
    diff: SceneDiff,
    node: SceneIdentity,
    property: SceneTransformChange['property'],
    before: GltfNode,
    after: GltfNode,
): void {
    const field = property === 'position' ? 'translation' : property
    const usesMatrix = Boolean(before.matrix || after.matrix)
    const defaults = property === 'rotation' ? [0, 0, 0, 1] : property === 'scale' ? [1, 1, 1] : [0, 0, 0]
    const oldValue = before[field] || (before.matrix ? decomposeMatrix(before.matrix)[property] : usesMatrix ? defaults : undefined)
    const newValue = after[field] || (after.matrix ? decomposeMatrix(after.matrix)[property] : usesMatrix ? defaults : undefined)
    compareTransform(diff, node, property, oldValue, newValue)
}

function decomposeMatrix(matrix: number[]): Record<SceneTransformChange['property'], number[]> {
    if (matrix.length !== 16 || matrix.some((value) => !Number.isFinite(value))) {
        return {position: [], rotation: [], scale: []}
    }
    let sx = Math.hypot(matrix[0], matrix[1], matrix[2])
    const sy = Math.hypot(matrix[4], matrix[5], matrix[6])
    const sz = Math.hypot(matrix[8], matrix[9], matrix[10])
    const determinant = matrix[0] * (matrix[5] * matrix[10] - matrix[6] * matrix[9])
        - matrix[4] * (matrix[1] * matrix[10] - matrix[2] * matrix[9])
        + matrix[8] * (matrix[1] * matrix[6] - matrix[2] * matrix[5])
    if (determinant < 0) sx = -sx
    const rotationMatrix = [
        matrix[0] / sx, matrix[4] / sy, matrix[8] / sz,
        matrix[1] / sx, matrix[5] / sy, matrix[9] / sz,
        matrix[2] / sx, matrix[6] / sy, matrix[10] / sz,
    ]
    return {
        position: [matrix[12], matrix[13], matrix[14]],
        rotation: quaternionFromRotationMatrix(rotationMatrix),
        scale: [sx, sy, sz],
    }
}

function quaternionFromRotationMatrix(matrix: number[]): number[] {
    const [m11, m12, m13, m21, m22, m23, m31, m32, m33] = matrix
    const trace = m11 + m22 + m33
    let x: number
    let y: number
    let z: number
    let w: number
    if (trace > 0) {
        const s = 0.5 / Math.sqrt(trace + 1)
        x = (m32 - m23) * s
        y = (m13 - m31) * s
        z = (m21 - m12) * s
        w = 0.25 / s
    } else if (m11 > m22 && m11 > m33) {
        const s = 2 * Math.sqrt(1 + m11 - m22 - m33)
        x = 0.25 * s
        y = (m12 + m21) / s
        z = (m13 + m31) / s
        w = (m32 - m23) / s
    } else if (m22 > m33) {
        const s = 2 * Math.sqrt(1 + m22 - m11 - m33)
        x = (m12 + m21) / s
        y = 0.25 * s
        z = (m23 + m32) / s
        w = (m13 - m31) / s
    } else {
        const s = 2 * Math.sqrt(1 + m33 - m11 - m22)
        x = (m13 + m31) / s
        y = (m23 + m32) / s
        z = 0.25 * s
        w = (m21 - m12) / s
    }
    return [x, y, z, w]
}

function compareComponents(diff: SceneDiff, node: SceneIdentity, before: GltfNode, after: GltfNode): void {
    const oldComponents = componentMap(before)
    const newComponents = componentMap(after)
    const ids = new Set([...Object.keys(oldComponents), ...Object.keys(newComponents)])
    for (const id of [...ids].sort()) {
        const oldComponent = oldComponents[id]
        const newComponent = newComponents[id]
        if (!oldComponent) {
            diff.components.push({node, id, type: componentType(newComponent), change: 'added', new: newComponent})
        } else if (!newComponent) {
            diff.components.push({node, id, type: componentType(oldComponent), change: 'removed', old: oldComponent})
        } else if (!jsonEqual(oldComponent, newComponent)) {
            diff.components.push({
                node,
                id,
                type: componentType(newComponent) || componentType(oldComponent),
                change: 'state',
                old: componentState(oldComponent),
                new: componentState(newComponent),
            })
        }
    }
}

function compareMaterials(diff: SceneDiff, before: GltfDocument, after: GltfDocument): void {
    const oldMaterials = before.materials || []
    const newMaterials = after.materials || []
    for (const match of matchItems(oldMaterials, newMaterials, materialIdentity)) {
        const oldMaterial = oldMaterials[match.before]
        const newMaterial = newMaterials[match.after]
        const material = mergeIdentity(materialIdentity(oldMaterial), materialIdentity(newMaterial))
        const oldFlat = flattenMaterial(oldMaterial)
        const newFlat = flattenMaterial(newMaterial)
        const properties = new Set([...oldFlat.keys(), ...newFlat.keys()])
        const nodes = materialNodes(after, match.after)
        for (const property of [...properties].sort()) {
            const oldValue = oldFlat.get(property)
            const newValue = newFlat.get(property)
            if (!jsonEqual(oldValue, newValue)) diff.materials.push({material, nodes, property, old: oldValue, new: newValue})
        }
    }
}

function matchItems<T>(before: T[], after: T[], identity: (value: T) => SceneIdentity): NodeMatch[] {
    const matches: NodeMatch[] = []
    const usedBefore = new Set<number>()
    const usedAfter = new Set<number>()

    matchUnique('uuid')
    matchUnique('name')
    for (let index = 0; index < Math.min(before.length, after.length); index += 1) {
        if (!usedBefore.has(index) && !usedAfter.has(index)
            && !identity(before[index]).uuid && !identity(after[index]).uuid) add(index, index)
    }
    return matches

    function matchUnique(key: keyof SceneIdentity) {
        const oldValues = indexUnique(before.map((item) => identity(item)[key]))
        const newValues = indexUnique(after.map((item) => identity(item)[key]))
        for (const [value, oldIndex] of oldValues) {
            const newIndex = newValues.get(value)
            if (newIndex !== undefined && !usedBefore.has(oldIndex) && !usedAfter.has(newIndex)) add(oldIndex, newIndex)
        }
    }

    function add(oldIndex: number, newIndex: number) {
        matches.push({before: oldIndex, after: newIndex})
        usedBefore.add(oldIndex)
        usedAfter.add(newIndex)
    }
}

function indexUnique(values: Array<string | undefined>): Map<string, number> {
    const counts = new Map<string, number>()
    values.forEach((value) => {
        if (value) counts.set(value, (counts.get(value) || 0) + 1)
    })
    const unique = new Map<string, number>()
    values.forEach((value, index) => {
        if (value && counts.get(value) === 1) unique.set(value, index)
    })
    return unique
}

function componentMap(node: GltfNode): Record<string, unknown> {
    const value = node.extras?.EntityComponentPlugin
    return isRecord(value) ? value : {}
}

function componentType(component: unknown): string | undefined {
    return isRecord(component) && typeof component.type === 'string' ? component.type : undefined
}

function componentState(component: unknown): unknown {
    return isRecord(component) ? component.state : undefined
}

function nodeIdentity(node: GltfNode): SceneIdentity {
    return {name: node.name, uuid: serializedUuid(node.extras)}
}

function materialIdentity(material: GltfMaterial): SceneIdentity {
    return {name: material.name, uuid: serializedUuid(material.extras)}
}

function serializedUuid(extras: Record<string, unknown> | undefined): string | undefined {
    for (const key of ['gltfUUID', 'uuid']) {
        if (typeof extras?.[key] === 'string') return extras[key] as string
    }
    return undefined
}

function mergeIdentity(before: SceneIdentity, after: SceneIdentity): SceneIdentity {
    return {name: after.name || before.name, uuid: after.uuid || before.uuid}
}

function flattenMaterial(material: GltfMaterial): Map<string, unknown> {
    const values = new Map<string, unknown>()
    visit(material, '')
    return values

    function visit(value: unknown, path: string): void {
        if (isRecord(value)) {
            for (const key of Object.keys(value).sort()) {
                if (!path && (key === 'name' || key === 'extras')) continue
                visit(value[key], path ? `${path}.${key}` : key)
            }
        } else {
            values.set(path, value)
        }
    }
}

function materialNodes(document: GltfDocument, materialIndex: number): SceneIdentity[] {
    const meshes = new Set<number>()
    ;(document.meshes || []).forEach((mesh, meshIndex) => {
        if (mesh.primitives?.some(({material}) => material === materialIndex)) meshes.add(meshIndex)
    })
    return (document.nodes || []).filter(({mesh}) => mesh !== undefined && meshes.has(mesh)).map(nodeIdentity)
}

function jsonEqual(left: unknown, right: unknown): boolean {
    return JSON.stringify(canonicalValue(left)) === JSON.stringify(canonicalValue(right))
}

function canonicalValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalValue)
    if (!isRecord(value)) return value
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]))
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}
