import {describe, expect, it} from 'vitest'
import {createProjectAssetURLModifier, type AssetsJSONManifest} from '../../src/runtime/projectFormat.ts'

describe('createProjectAssetURLModifier', () => {
    const base = new URL('https://game.example/files/')

    it('maps every registered asset file independently', () => {
        const assets: AssetsJSONManifest = {
            version: 1,
            files: {
                camera: {
                    path: 'assets/imports/camera/f.gltf',
                    files: {
                        'f.gltf': 'assets/imports/camera/f.gltf',
                        'Camera.bin': 'assets/imports/camera/Camera.bin',
                        'textures/body.jpg': 'assets/imports/camera/textures/body.jpg',
                    },
                },
            },
        }
        const resolve = createProjectAssetURLModifier(base, assets)

        expect(resolve('/kite3d/@camera/f.gltf')).toBe('https://game.example/files/assets/imports/camera/f.gltf')
        expect(resolve('/kite3d/@camera/Camera.bin')).toBe('https://game.example/files/assets/imports/camera/Camera.bin')
        expect(resolve('/kite3d/@camera/textures/body.jpg'))
            .toBe('https://game.example/files/assets/imports/camera/textures/body.jpg')
        expect(() => resolve('/kite3d/@camera/missing.bin')).toThrow('Unknown file for asset camera: missing.bin')
    })

    it('keeps legacy single-file assets and sibling resources working', () => {
        const resolve = createProjectAssetURLModifier(base, {
            version: 1,
            files: {legacy: {path: 'assets/imports/legacy/model.gltf'}},
        })

        expect(resolve('/kite3d/@legacy/f.gltf')).toBe('https://game.example/files/assets/imports/legacy/model.gltf')
        expect(resolve('/kite3d/@legacy/mesh.bin')).toBe('https://game.example/files/assets/imports/legacy/mesh.bin')
        expect(resolve('/kite3d/assets/direct.glb')).toBe('https://game.example/files/assets/direct.glb')
        expect(resolve('https://cdn.example/model.glb')).toBe('https://cdn.example/model.glb')
    })
})
