import {publishGameTelemetry, registerGameValidation} from '@kite3d/engine'

export function main({viewer}) {
    window.__kite3dMainRan = true
    window.__kite3dViewer = viewer
    publishGameTelemetry({state: 'playing', nestedAsset: true})
    registerGameValidation(() => ({
        status: viewer.scene.modelRoot.getObjectByName('PropRef')?.children.length === 1 ? 'pass' : 'fail',
        summary: 'The runtime loaded one nested asset.',
    }))
}
