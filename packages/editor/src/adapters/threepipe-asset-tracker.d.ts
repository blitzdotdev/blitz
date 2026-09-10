import type {DevServerAssetTracker} from './DevServerAssetTracker.ts'

declare module 'threepipe' {
    /** AGREED-4: restore the editor-only tracker slot removed from threepipe 0.5.1. */
    interface AssetManager {
        tracker: DevServerAssetTracker
    }
}
