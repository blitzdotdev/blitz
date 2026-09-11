import {AViewerPluginAsync} from '@blitzdev/engine'

export default class FixturePlugin extends AViewerPluginAsync {
    static PluginType = 'PackedFixturePlugin'

    async onAdded(viewer) {
        await super.onAdded(viewer)
        const worker = new globalThis.Worker(new URL('./fixture.worker.js', import.meta.url), {type: 'module'})
        this.sidecarByte = await new Promise((resolve, reject) => {
            worker.onmessage = ({data}) => resolve(data)
            worker.onerror = ({message}) => reject(new Error(message))
        })
        worker.terminate()
    }
}
