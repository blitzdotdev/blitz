import {SelObjectType} from "../utils/projectUtils.ts";

export const typesExts: Partial<Record<SelObjectType|'image'|'script', string[]>> = {
    'plugin': ['.plugin.js', '.plugin.ts'],
    'script': ['.script.js', '.script.ts'],
    'material': ['.mat', '.mat.json'],
    'image': ['.png', '.jpeg', '.jpg', '.gif', '.bmp', '.tiff', '.webp', '.hdr', '.exr', '.ktx2', '.svg'],
    // 'texture': ['.png', '.jpeg', '.jpg', '.gif', '.bmp', '.tiff', '.webp', '.tex.json'],
    // 'geometry': ['.glb', '.gltf', '.obj', '.fbx', '.ply', '.stl', '.geom.json'],
    // 'object': ['.glb', '.gltf', '.obj', '.fbx', '.ply', '.stl', '.geom.json'],
}
export const mimeToExt: any = {
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
