import type {SelObjectType} from '../utils/projectUtils.ts'

export const typesExts: Partial<Record<SelObjectType | 'image' | 'script', string[]>> = {
    plugin: ['.plugin.js', '.plugin.ts'],
    script: ['.script.js', '.script.ts'],
    material: ['.mat', '.mat.json'],
    image: ['.png', '.jpeg', '.jpg', '.gif', '.bmp', '.tiff', '.webp', '.hdr', '.exr', '.ktx2', '.svg'],
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
