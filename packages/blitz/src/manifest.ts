import type {ManifestFile, ProjectEntry, ReleaseManifest, RuntimeRecord} from './types.ts'

const MIME_TYPES: Record<string, string> = {
    html: 'text/html; charset=utf-8',
    js: 'text/javascript; charset=utf-8',
    mjs: 'text/javascript; charset=utf-8',
    json: 'application/json; charset=utf-8',
    gltf: 'model/gltf+json',
    glb: 'model/gltf-binary',
}

export async function sha256(file: Blob): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function buildManifest(
    entries: ProjectEntry[],
    runtime: Pick<RuntimeRecord, 'sha256' | 'size'>,
): Promise<ReleaseManifest> {
    const files: Record<string, ManifestFile> = {}
    const sorted = [...entries].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
    for (const entry of sorted) {
        files[entry.path] = descriptor(entry.path, await sha256(entry.file), entry.file.size)
    }
    files['_blitz/runtime.js'] = descriptor('_blitz/runtime.js', runtime.sha256, runtime.size)
    return {files: sortFiles(files)}
}

export async function manifestHash(manifest: ReleaseManifest): Promise<string> {
    return sha256(new Blob([canonicalizeManifest(manifest)]))
}

export function canonicalizeManifest(manifest: ReleaseManifest): string {
    return JSON.stringify({files: sortFiles(manifest.files)})
}

function descriptor(path: string, hash: string, size: number): ManifestFile {
    const extension = path.toLowerCase().split('.').pop() || ''
    const mime = MIME_TYPES[extension]
    return mime ? {sha256: hash, size, mime} : {sha256: hash, size}
}

function sortFiles(files: Record<string, ManifestFile>): Record<string, ManifestFile> {
    const sorted: Record<string, ManifestFile> = {}
    for (const path of Object.keys(files).sort()) {
        const file = files[path]
        sorted[path] = file.mime
            ? {sha256: file.sha256, size: file.size, mime: file.mime}
            : {sha256: file.sha256, size: file.size}
    }
    return sorted
}
