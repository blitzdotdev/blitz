import type {ThreeViewer} from 'threepipe'

export interface SerializeSceneGltfOptions {
    scenePath?: string
    viewerConfig?: boolean
    textureHashLength?: number
}

export interface SerializedSceneFile {
    path: string
    bytes: Uint8Array
}

export interface SerializedSceneGltf {
    document: Record<string, unknown>
    gltf: Uint8Array
    files: SerializedSceneFile[]
}

interface GltfBuffer {
    byteLength?: number
    uri?: string
    [key: string]: unknown
}

interface GltfBufferView {
    buffer: number
    byteOffset?: number
    [key: string]: unknown
}

interface GltfImage {
    uri?: string
    mimeType?: string
    [key: string]: unknown
}

interface GltfDocument extends Record<string, unknown> {
    buffers?: GltfBuffer[]
    bufferViews?: GltfBufferView[]
    images?: GltfImage[]
}

const encoder = new TextEncoder()

/** Export a viewer scene as deterministic text glTF plus external resources. */
export async function serializeSceneGltf(
    viewer: Pick<ThreeViewer, 'exportScene'>,
    options: SerializeSceneGltfOptions = {},
): Promise<SerializedSceneGltf> {
    const blob = await viewer.exportScene({
        exportExt: 'gltf',
        preserveUUIDs: true,
        viewerConfig: options.viewerConfig ?? true,
        embedUrlImages: false,
        jsonSpaces: 2,
    }, false)
    if (!blob) throw new Error('The scene exporter returned no glTF data')
    return serializeSceneGltfDocument(JSON.parse(await blob.text()), options)
}

/** Canonicalize JSON glTF and extract every embedded resource. */
export async function serializeSceneGltfDocument(
    input: unknown,
    options: SerializeSceneGltfOptions = {},
): Promise<SerializedSceneGltf> {
    if (!isRecord(input) || !isRecord(input.asset)) {
        throw new Error('The scene is not a JSON glTF document')
    }
    const document = cloneJson(input) as GltfDocument
    const scenePath = normalizeProjectPath(options.scenePath || 'assets/main.scene.gltf')
    const sceneDirectory = directoryName(scenePath)
    const files: SerializedSceneFile[] = []

    extractBuffers(document, sceneDirectory, fileStem(scenePath), files)
    await extractImages(document, sceneDirectory, files, options.textureHashLength ?? 16)

    const sorted = sortObjectKeys(document) as GltfDocument
    return {
        document: sorted,
        gltf: encoder.encode(`${JSON.stringify(sorted, null, 2)}\n`),
        files: files.sort((left, right) => left.path.localeCompare(right.path)),
    }
}

function extractBuffers(
    document: GltfDocument,
    sceneDirectory: string,
    baseName: string,
    files: SerializedSceneFile[],
): void {
    const buffers = document.buffers
    if (!buffers?.length) return

    const embedded = buffers.map((buffer) => buffer.uri?.startsWith('data:') ? decodeDataUrl(buffer.uri).bytes : undefined)
    if (embedded.every((value) => value === undefined)) return
    if (embedded.some((value, index) => value === undefined && buffers[index]?.uri)) {
        throw new Error('A scene cannot combine embedded and external buffers during serialization')
    }

    let byteLength = 0
    const offsets = embedded.map((bytes) => {
        const offset = align4(byteLength)
        byteLength = offset + (bytes?.byteLength || 0)
        return offset
    })
    const combined = new Uint8Array(byteLength)
    embedded.forEach((bytes, index) => {
        if (bytes) combined.set(bytes, offsets[index])
    })

    for (const view of document.bufferViews || []) {
        const offset = offsets[view.buffer]
        if (offset === undefined) throw new Error(`Invalid glTF buffer index: ${view.buffer}`)
        view.byteOffset = (view.byteOffset || 0) + offset
        view.buffer = 0
    }

    const binName = `${baseName}.bin`
    document.buffers = [{byteLength: combined.byteLength, uri: binName}]
    files.push({path: joinProjectPath(sceneDirectory, binName), bytes: combined})
}

async function extractImages(
    document: GltfDocument,
    sceneDirectory: string,
    files: SerializedSceneFile[],
    hashLength: number,
): Promise<void> {
    const byPath = new Map<string, Uint8Array>()
    for (const image of document.images || []) {
        if (!image.uri?.startsWith('data:')) continue
        const decoded = decodeDataUrl(image.uri)
        const mimeType = decoded.mimeType || image.mimeType || 'application/octet-stream'
        const hash = await sha256(decoded.bytes)
        const path = `assets/textures/${hash.slice(0, hashLength)}.${imageExtension(mimeType)}`
        byPath.set(path, decoded.bytes)
        image.uri = relativeProjectPath(sceneDirectory, path)
        image.mimeType = mimeType
    }
    for (const [path, bytes] of byPath) files.push({path, bytes})
}

function decodeDataUrl(uri: string): {bytes: Uint8Array, mimeType?: string} {
    const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(uri)
    if (!match) throw new Error('Invalid data URL in glTF')
    return {
        bytes: match[2] ? decodeBase64(match[3]) : encoder.encode(decodeURIComponent(match[3])),
        mimeType: match[1] || undefined,
    }
}

function decodeBase64(value: string): Uint8Array {
    if (typeof atob === 'function') {
        const decoded = atob(value)
        return Uint8Array.from(decoded, (character) => character.charCodeAt(0))
    }
    const nodeBuffer = (globalThis as unknown as {
        Buffer?: {from(value: string, encoding: string): Uint8Array}
    }).Buffer
    if (!nodeBuffer) throw new Error('No base64 decoder is available')
    return new Uint8Array(nodeBuffer.from(value, 'base64'))
}

async function sha256(bytes: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
    return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}

function imageExtension(mimeType: string): string {
    const normalized = mimeType.toLowerCase().split(';', 1)[0]
    const extensions: Record<string, string> = {
        'image/avif': 'avif',
        'image/gif': 'gif',
        'image/jpeg': 'jpg',
        'image/ktx2': 'ktx2',
        'image/png': 'png',
        'image/svg+xml': 'svg',
        'image/webp': 'webp',
    }
    return extensions[normalized] || normalized.split('/')[1]?.replace(/[^a-z0-9.+-]/g, '') || 'bin'
}

function sortObjectKeys(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortObjectKeys)
    if (!isRecord(value)) return value
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObjectKeys(value[key])]))
}

function cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeProjectPath(path: string): string {
    const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '')
    if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) {
        throw new Error(`Invalid project path: ${path}`)
    }
    return normalized
}

function directoryName(path: string): string {
    const end = path.lastIndexOf('/')
    return end < 0 ? '' : path.slice(0, end)
}

function fileStem(path: string): string {
    const name = path.slice(path.lastIndexOf('/') + 1)
    const end = name.lastIndexOf('.')
    return end < 0 ? name : name.slice(0, end)
}

function joinProjectPath(directory: string, name: string): string {
    return directory ? `${directory}/${name}` : name
}

function relativeProjectPath(fromDirectory: string, target: string): string {
    const from = fromDirectory ? fromDirectory.split('/') : []
    const to = target.split('/')
    while (from.length && to.length && from[0] === to[0]) {
        from.shift()
        to.shift()
    }
    return [...from.map(() => '..'), ...to].join('/') || '.'
}

function align4(value: number): number {
    return (value + 3) & ~3
}
