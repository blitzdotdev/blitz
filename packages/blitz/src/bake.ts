import {BLITZ_SERVER_CLIENT_ID} from '@blitzdev/engine/paths'

export interface BakeSafetyResult {
    ok: boolean
    code?: 'node_not_found' | 'node_ambiguous' | 'non_generated_children' | 'human_edits'
    reason?: string
}

export interface BakeJournalEntry {
    ts: string
    client: string
    summary: unknown
}

interface GltfNode {
    name?: string
    children?: number[]
    extras?: Record<string, unknown>
}

interface GltfDocument {
    nodes?: GltfNode[]
}

export function checkBakeSafety(
    document: GltfDocument,
    nodeName: string,
    journal: BakeJournalEntry[] = [],
    force = false,
): BakeSafetyResult {
    const nodes = document.nodes || []
    const matches = nodes.flatMap((node, index) => node.name === nodeName ? [{node, index}] : [])
    if (!matches.length) return {ok: false, code: 'node_not_found', reason: `Generator node not found: ${nodeName}`}
    if (matches.length > 1) return {ok: false, code: 'node_ambiguous', reason: `Generator node name is not unique: ${nodeName}`}
    if (force) return {ok: true}

    const target = matches[0]
    const realChildren = (target.node.children || [])
        .map((index) => nodes[index])
        .filter((node) => node && node.extras?.blitzGenerated !== true)
    if (realChildren.length) {
        return {
            ok: false,
            code: 'non_generated_children',
            reason: `${nodeName} already has non-generated children. Use --force to bake anyway.`,
        }
    }

    const bakedFrom = target.node.extras?.blitzBakedFrom
    const lastBake = isRecord(bakedFrom) && typeof bakedFrom.ts === 'string'
        ? Date.parse(bakedFrom.ts)
        : Number.NaN
    if (!Number.isFinite(lastBake)) return {ok: true}

    const subtree = collectSubtreeIdentities(nodes, target.index)
    const edited = journal.some((entry) => {
        if (Date.parse(entry.ts) <= lastBake || !isHumanClient(entry.client)) return false
        return valueTouchesIdentity(entry.summary, subtree)
    })
    if (edited) {
        return {
            ok: false,
            code: 'human_edits',
            reason: `${nodeName} has human edits since its last bake. Use --force to bake anyway.`,
        }
    }
    return {ok: true}
}

function collectSubtreeIdentities(nodes: GltfNode[], root: number): Set<string> {
    const identities = new Set<string>()
    const pending = [root]
    const visited = new Set<number>()
    while (pending.length) {
        const index = pending.pop()!
        if (visited.has(index)) continue
        visited.add(index)
        const node = nodes[index]
        if (!node) continue
        if (node.name) identities.add(node.name)
        const uuid = node.extras?.gltfUUID
        if (typeof uuid === 'string') identities.add(uuid)
        pending.push(...(node.children || []))
    }
    return identities
}

function valueTouchesIdentity(value: unknown, identities: Set<string>): boolean {
    if (typeof value === 'string') return identities.has(value)
    if (Array.isArray(value)) return value.some((item) => valueTouchesIdentity(item, identities))
    if (!isRecord(value)) return false
    return Object.values(value).some((item) => valueTouchesIdentity(item, identities))
}

function isHumanClient(client: string): boolean {
    return client !== 'external' && client !== BLITZ_SERVER_CLIENT_ID && client !== 'blitz-bake'
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
