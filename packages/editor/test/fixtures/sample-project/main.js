import {publishGameTelemetry, registerGameValidation} from '@blitzdev/engine'

export function main({viewer}) {
    window.__blitzMainRan = true
    window.__blitzViewer = viewer
    publishGameTelemetry({state: 'playing', generated: 3})
    registerGameValidation(() => ({
        status: viewer.scene.modelRoot.getObjectByName('GeneratorRoot')?.children.length === 3 ? 'pass' : 'fail',
        summary: 'The runtime generator produced three preview objects.',
    }))
}
