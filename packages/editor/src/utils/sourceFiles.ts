import type {ProjectFileEntry} from '../ProjectSource.ts'

export const maxSourceBytes = 1024 * 1024

const binarySourceExtensions = new Set([
    '.3dm', '.7z', '.avif', '.bin', '.bmp', '.doc', '.docx', '.eot', '.exr', '.fbx', '.gif', '.glb',
    '.gz', '.hdr', '.ico', '.jar', '.jpeg', '.jpg', '.ktx', '.ktx2', '.m4a', '.mat', '.mov', '.mp3',
    '.mp4', '.obj', '.ogg', '.otf', '.pdf', '.ply', '.png', '.rar', '.stl', '.svg', '.tar', '.tif',
    '.tiff', '.ttf', '.wasm', '.wav', '.webm', '.webp', '.woff', '.woff2', '.zip',
])

export function isTextSourcePath(path: string): boolean {
    const name = path.split('/').pop() || path
    const dot = name.lastIndexOf('.')
    const extension = dot >= 0 ? name.slice(dot).toLowerCase() : ''
    return !binarySourceExtensions.has(extension)
}

export function isEditableSourceFile(entry?: ProjectFileEntry | null): entry is ProjectFileEntry {
    return Boolean(entry && entry.size <= maxSourceBytes && isTextSourcePath(entry.path))
}
