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
        compareTransform(diff, identity, 'position', oldNode.translation, newNode.translation)
        compareTransform(diff, identity, 'rotation', oldNode.rotation, newNode.rotation)
        compareTransform(diff, identity, 'scale', oldNode.scale, newNode.scale)
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
        const properties = new Set([...flattenMaterial(oldMaterial).keys(), ...flattenMaterial(newMaterial).keys()])
        const nodes = materialNodes(after, match.after)
        for (const property of [...properties].sort()) {
            const oldValue = flattenMaterial(oldMaterial).get(property)
            const newValue = flattenMaterial(newMaterial).get(property)
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
    return JSON.stringify(left) === JSON.stringify(right)
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}
