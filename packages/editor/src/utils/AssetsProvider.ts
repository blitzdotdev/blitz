import {createContext, createElement, useContext, useEffect, useMemo, useState, type ReactNode} from 'react'
import {PickingPlugin, type SelectionObject, type UiObjectConfig} from 'threepipe'
import {useManagerVersion} from './UseManager.ts'

export type SelectedInspectorItem = Exclude<SelectionObject, null> | {
    name: string
    uuid: string
    uiConfig?: UiObjectConfig
    userData?: Record<string, unknown>
}

export interface FileManifestEntry {
    path: string
    name: string
    type: 'file'
    size: number
    sha256: string
    mtime: number
    isFSEntry: true
}

function useSetupAssets() {
    const manager = useManagerVersion()
    const [selectedInspectorItems, setSelectedInspectorItems] = useState<SelectedInspectorItem[]>([])
    const [selectedFiles, setSelectedFiles] = useState<FileManifestEntry[]>([])
    const [currentPath, setCurrentPath] = useState('/')
    const fileManifest = useMemo(() => manager.manifest.map((entry) => ({
        ...entry,
        name: entry.path.split('/').pop() || entry.path,
        type: 'file' as const,
        isFSEntry: true as const,
    })), [manager.manifest])

    return {
        selectedInspectorItems,
        setSelectedInspectorItems,
        selectedFiles,
        setSelectedFiles,
        currentPath,
        setCurrentPath,
        fileManifest,
        refreshManifest: async () => fileManifest,
    }
}

const AssetsContext = createContext<ReturnType<typeof useSetupAssets> | undefined>(undefined)

export function useAssets() {
    const value = useContext(AssetsContext)
    if (!value) throw new Error('Assets context is missing')
    return value
}

export function AssetsProvider({children}: {children: ReactNode}) {
    const value = useSetupAssets()
    const manager = useManagerVersion()
    const {setSelectedInspectorItems} = value

    useEffect(() => {
        const picking = manager.get().getPlugin(PickingPlugin)
        const changed = () => {
            const selected = picking?.getSelectedObject()
            setSelectedInspectorItems(selected ? [selected] : [])
        }
        picking?.addEventListener('selectedObjectChanged', changed)
        return () => picking?.removeEventListener('selectedObjectChanged', changed)
    }, [manager, setSelectedInspectorItems])

    return createElement(AssetsContext.Provider, {value}, children)
}

export function getFileByPath(path: string, entries: FileManifestEntry[]) {
    return entries.find((entry) => entry.path === path) || null
}

export function traverseFiles(callback: (file: FileManifestEntry) => void, entries: FileManifestEntry[]) {
    entries.forEach(callback)
}
