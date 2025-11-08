import {FileManifestEntry, SelectedInspectorItem} from "./AssetsProvider.ts";
import {SelectFileRef, SelObjectType} from "./ViewerInstanceManager.ts";
import {objectToType} from "../components/RefSelectionObjectComponent.tsx";
import {IconName, MaybeElement} from "@blueprintjs/core";
import {TypedClass} from "../../../threepipe/lib";

export function iconForSelectionObject(object?: SelectedInspectorItem|SelectFileRef|null): IconName | MaybeElement{
    const type = objectToType(object)
    return iconForSelectionObjectType(type)
}

export function iconForSelectionObjectType(type: SelObjectType|'image'|'script'|TypedClass[]): IconName | MaybeElement{
    if(Array.isArray(type)){
        if(type.length > 1) return 'layers'
        return type.length ? type[0].getIcon?.() || 'layer' : 'help'
    }
    switch(type){
        case 'none': return 'circle'
        case 'object': return 'cube'
        case 'material': return 'style'
        case 'texture': return 'image-rotate-left'
        case 'image': return 'image-rotate-right'
        case 'geometry': return 'grid-view'
        case 'plugin': return 'document-code'
        case 'script': return 'code'
        default: return 'help'
    }
}


export const fileExtToIcons = {
    'directory': 'folder-close',
    '.scene.glb': 'cubes',
    '.asset.glb': 'package',
    '.asset.mat': 'style',
    '.mat.json': 'style',
    'package.json': 'box',
    '.png': 'media',
    '.jpg': 'media',
    '.jpeg': 'media',
    '.webp': 'media',
    '.gif': 'media',
    '.mp4': 'video',
    '.webm': 'video',
    '.exr': 'media',
    '.hdr': 'media',
    '.ktx2': 'media',
    '.ktx': 'media',
    '.glb': 'cube',
    '.gltf': 'cube',
    '.fbx': 'cube',
    '.obj': 'cube',
    '.zip': 'archive',
    '.stl': 'cube',
    '.3dm': 'cube',
    '.txt': 'document',
    '.md': 'document',
    '.mat': 'style',
    '.js': 'code',
    '.ts': 'code',
    '.json': 'document-code',
    '': 'document',
} satisfies Record<string, IconName>

export function fileToIcon(f: {path: string, type?: 'file'|'directory'}):IconName {
    const name = f.path.split('/').filter(Boolean).pop() || f.path
    const icon = f.type && f.type === 'directory' ? fileExtToIcons['directory'] : Object.entries(fileExtToIcons).reduce((acc, [ext, icon]) => {
        if (ext && (ext[0] === '.' ? name.endsWith(ext) : name === ext) && ext.length > acc[0].length) return [ext, icon]
        return acc
    }, ['', 'document'])[1]
    return icon;
}
