import {Callout, Spinner, Tab, Tabs} from '@blueprintjs/core'
import {useEffect, useMemo, useState} from 'react'
import {useManager} from '../utils/UseManager.ts'

export const ASSET_LIBRARY_PROXY_URL = 'https://blitz-asset-library-proxy.blitzapp.workers.dev'

export interface TExternalFile {
    path: string
    name: string
    type: 'file' | 'directory'
    children: TExternalFile[]
    assetType?: string
    libFileId?: string
    isFSEntry?: false
    icon?: string
    size?: number
    sha256?: string
    mtime?: number
}

interface LibraryAsset {
    id: string
    name: string
    fileUrl: string
    thumbnailUrl: string
    type: string
}

interface AssetGroup {
    key: string
    title: string
}

const groups: AssetGroup[] = [
    {key: 'model', title: '3D Models'},
    {key: 'material', title: 'Materials'},
    {key: 'hdri', title: 'Environment Maps'},
    {key: 'texture', title: 'Textures'},
]

export function ExternalFilesPanel() {
    const manager = useManager()
    const [assets, setAssets] = useState<LibraryAsset[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')

    useEffect(() => {
        const controller = new AbortController()
        void fetch(`${ASSET_LIBRARY_PROXY_URL}/assets/v1/list`, {signal: controller.signal})
            .then(async (response) => {
                if (!response.ok) throw new Error(`Asset library returned ${response.status}.`)
                const body = await response.json() as {assets?: unknown}
                if (!Array.isArray(body.assets)) throw new Error('Asset library returned an invalid response.')
                setAssets(body.assets.filter(isLibraryAsset))
            })
            .catch((caught) => {
                if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : String(caught))
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false)
            })
        return () => controller.abort()
    }, [])

    const grouped = useMemo(() => Object.fromEntries(groups.map(({key}) => [
        key,
        assets.filter((asset) => asset.type === key),
    ])), [assets])

    if (loading) return <div className="asset-library-status"><Spinner size={24}/><span>Loading asset library...</span></div>
    if (error) return <Callout intent="danger" title="Asset library unavailable">{error}</Callout>

    return <div className="asset-library" data-testid="asset-library">
        <Tabs animate={false} renderActiveTabPanelOnly defaultSelectedTabId={groups[0].key}>
            {groups.map((group) => <Tab
                key={group.key}
                id={group.key}
                title={group.title}
                panel={<AssetGrid
                    assets={grouped[group.key] || []}
                    onImport={(asset) => void manager.importUrl(asset.fileUrl).catch((caught) => manager.reportError(caught))}
                />}
            />)}
        </Tabs>
    </div>
}

function AssetGrid({assets, onImport}: {assets: LibraryAsset[], onImport(asset: LibraryAsset): void}) {
    if (!assets.length) return <p className="asset-library-empty">No assets in this category.</p>
    return <div className="asset-library-grid">
        {assets.map((asset) => <button
            className="asset-library-item"
            data-testid="asset-library-item"
            key={asset.id}
            type="button"
            title={`Double-click to import ${asset.name}`}
            onDoubleClick={() => onImport(asset)}
        >
            <img src={asset.thumbnailUrl} alt=""/>
            <span>{asset.name}</span>
        </button>)}
    </div>
}

function isLibraryAsset(value: unknown): value is LibraryAsset {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const asset = value as Record<string, unknown>
    return typeof asset.id === 'string'
        && typeof asset.name === 'string'
        && typeof asset.fileUrl === 'string'
        && typeof asset.thumbnailUrl === 'string'
        && typeof asset.type === 'string'
}
