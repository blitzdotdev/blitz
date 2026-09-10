export type BlitzFileType = 'plugin' | 'script' | 'material' | 'image'

export const typesExts: Partial<Record<BlitzFileType, string[]>> = {
    'plugin': ['.plugin.js', '.plugin.ts'],
    'script': ['.script.js', '.script.ts'],
    'material': ['.mat', '.mat.json'],
    'image': ['.png', '.jpeg', '.jpg', '.gif', '.bmp', '.tiff', '.webp', '.hdr', '.exr', '.ktx2', '.svg'],
    // 'texture': ['.png', '.jpeg', '.jpg', '.gif', '.bmp', '.tiff', '.webp', '.tex.json'],
    // 'geometry': ['.glb', '.gltf', '.obj', '.fbx', '.ply', '.stl', '.geom.json'],
    // 'object': ['.glb', '.gltf', '.obj', '.fbx', '.ply', '.stl', '.geom.json'],
}
export const mimeToExt: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/svg+xml': 'svg',
    'image/webp': 'webp',
    'image/x-exr': 'exr',
    'image/x-hdr': 'hdr',
    'model/gltf+binary': 'glb',
    'model/gltf+json': 'gltf',
    'model/gltf': 'gltf',
}

export const extensionMimeTypes: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.ts': 'text/typescript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.gltf': 'model/gltf+json',
    '.glb': 'model/gltf-binary',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.wasm': 'application/wasm',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.wav': 'audio/wav',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
}

export function mimeTypeForPath(path: string): string {
    const lower = path.toLowerCase()
    const extension = Object.keys(extensionMimeTypes)
        .sort((a, b) => b.length - a.length)
        .find((candidate) => lower.endsWith(candidate))
    return extension ? extensionMimeTypes[extension] : 'application/octet-stream'
}
