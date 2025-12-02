import {TExternalFile} from "../components/FilesPanel.tsx";

const envMaps = [
    ['Quarry', 'https://threejs.org/examples/textures/equirectangular/quarry_01_1k.hdr', 'https://cdn.polyhaven.com/asset_img/thumbs/quarry_01.png?width=256&height=256'],
    ['Moonless Golf', 'https://threejs.org/examples/textures/equirectangular/moonless_golf_1k.hdr', 'https://cdn.polyhaven.com/asset_img/thumbs/moonless_golf.png?width=256&height=256'],
    ['Royal Esplanade', 'https://threejs.org/examples/textures/equirectangular/royal_esplanade_1k.hdr', 'https://cdn.polyhaven.com/asset_img/thumbs/royal_esplanade.png?width=256&height=256'],
    ['Empty Warehouse', 'https://samples.threepipe.org/minimal/empty_warehouse_01_1k.hdr', 'https://cdn.polyhaven.com/asset_img/thumbs/empty_warehouse_01.png?width=256&height=256'],
    ['Venice Sunset', 'https://samples.threepipe.org/minimal/venice_sunset_1k.hdr', 'https://cdn.polyhaven.com/asset_img/thumbs/venice_sunset.png?width=256&height=256'],
]

export const externalFiles: TExternalFile[] = [{
    name: '3D Models',
    path: 'models-3d/',
    type: 'directory',
    children: [{
        name: 'Iridescent Dish With Olives',
        path: 'https://threejs.org/examples/models/gltf/IridescentDishWithOlives.glb',
        type: 'file',
        children: [],
    }],
}, {
    name: 'Materials',
    path: 'materials/',
    type: 'directory',
    children: [],
}, {
    name: 'Environment Maps',
    path: 'env-maps/',
    type: 'directory',
    children: envMaps.map(([name, url, icon]) => ({
        name, path: url, type: 'file', children: [], icon,
    })),
}, {
    name: 'Textures',
    path: 'textures/',
    type: 'directory',
    children: [],
},
]
