import {EventDispatcher, type ImportResult} from 'threepipe'
import type {AssetRegistryItem} from '../utils/AssetTracker.ts'

type RegistryEvent = {path: string, action: 'add' | 'remove' | 'refresh' | 'load'}

/**
 * AGREED-4: DevServerSource owns asset lifetimes. This compatibility registry
 * lets the byte-restored Memory surface observe the same empty asset registry
 * without installing the browser-file AssetTracker's import mutations.
 */
export class DevServerAssetTracker extends EventDispatcher<{registryChanged: RegistryEvent}> {
    readonly registry: Record<string, AssetRegistryItem> = {}

    removeAssetItem(asset: ImportResult | {pms: Promise<ImportResult | undefined>}) {
        const entry = Object.entries(this.registry).find(([, value]) => value === asset)
        if (!entry) return
        delete this.registry[entry[0]]
        this.dispatchEvent({type: 'registryChanged', path: entry[0], action: 'remove'})
    }
}
