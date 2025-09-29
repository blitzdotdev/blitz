import {useSafeContext} from "./useSafeContext.ts";
import {createContext, createElement, useState} from "react";
import {SelectionObject, UiObjectConfig} from "threepipe";
import {SavedSceneFile} from "./ViewerInstanceManager.ts";

export type SelectedInspectorItem = (SelectionObject | {
    name: string
    uiConfig?: UiObjectConfig,
    userData?: Record<string, any>
})[]

export type FileManifestEntry = {
    path: string
    name: string
    handle: FileSystemFileHandle | FileSystemDirectoryHandle
    type: 'file' | 'directory'
    children?: FileManifestEntry[]
    isFSEntry: true
}

export async function manifestEntryToFile(f: FileManifestEntry): Promise<File | null>{
    if(f.type === 'directory') return null
    const file = await (f.handle as FileSystemFileHandle).getFile()
    return file
}

export async function directoryToManifest(
    handle: FileSystemDirectoryHandle,
    basePath: string = ''
): Promise<FileManifestEntry[]> {
    const entries: FileManifestEntry[] = []

    // Iterate through all entries in the directory
    for await (const [name, entryHandle] of handle.entries()) {
        const fullPath = basePath ? `${basePath}/${name}` : name

        if (entryHandle.kind === 'file') {
            // Handle file entry
            entries.push({
                name,
                path: fullPath,
                handle: entryHandle,
                type: 'file',
                isFSEntry: true

            })
        } else if (entryHandle.kind === 'directory') {
            // Handle directory entry - recursively process subdirectories
            const children = await directoryToManifest(entryHandle, fullPath)

            entries.push({
                name,
                path: fullPath,
                handle: entryHandle,
                type: 'directory',
                children: children,
                isFSEntry: true
            })
        }
    }

    // console.log(entries)
    return entries
}

export function traverseFiles(cb: (f: FileManifestEntry)=>void, entries: FileManifestEntry[]) {
    for(const entry of entries) {
        if (entry.type === 'file') {
            cb(entry)
        } else if (entry.type === 'directory' && entry.children) {
            traverseFiles(cb, entry.children)
        }
    }
}

export function getFileByPath(path: string, entries: FileManifestEntry[]): FileManifestEntry | null {
    for(const entry of entries) {
        if(entry.path === path) return entry
        if (entry.type === 'directory' && entry.children) {
            const found = getFileByPath(path, entry.children)
            if(found) return found
        }
    }
    return null
}

function useSetupAssets() {
    const [selectedInspectorItem, setSelectedInspectorItem] = useState<SelectedInspectorItem>([])
    const [selectedFiles, setSelectedFiles] = useState<FileManifestEntry[]>([])
    const [fileManifest, setFileManifest] = useState<FileManifestEntry[]>([])

    const canRenderInspector = selectedInspectorItem.length || selectedFiles.length
    // const inspectorItem = selectedFiles.length === 1 ? selectedFiles[0] : selectedInspectorItem.length === 1 ? selectedInspectorItem[0] : null

    return {
        selectedInspectorItem, setSelectedInspectorItem,
        selectedFiles, setSelectedFiles,
        canRenderInspector,
        fileManifest, setFileManifest
    }
}

const AssetsContext = createContext<ReturnType<typeof useSetupAssets>|undefined>(undefined)
export const useAssets = () => useSafeContext(AssetsContext)

export function AssetsProvider({children}: { children: any }) {
    const value = useSetupAssets()
    return createElement(AssetsContext.Provider, {value}, children)
}
