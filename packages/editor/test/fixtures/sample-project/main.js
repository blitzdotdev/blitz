import {publishGameTelemetry, registerGameValidation} from '@blitzdev/engine'

export function main({viewer}) {
    window.__kite3dMainRan = true
    window.__kite3dViewer = viewer
    publishGameTelemetry({state: 'playing', generated: 3})
    registerGameValidation(() => ({
        status: viewer.scene.modelRoot.getObjectByName('GeneratorRoot')?.children.length === 3 ? 'pass' : 'fail',
        summary: 'The runtime generator produced three preview objects.',
    }))
}
