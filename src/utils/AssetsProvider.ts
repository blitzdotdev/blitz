import {useSafeContext} from "./useSafeContext.ts";
import {createContext, createElement, useEffect, useMemo, useState} from "react";
import {PickingPlugin, SelectionObject, UiObjectConfig} from "threepipe";
import {useManager, useProject} from "./ViewerInstanceManager.ts";

export type SelectedInspectorItem = (Exclude<SelectionObject, null> | {
    name: string
    uuid: string
    uiConfig?: UiObjectConfig,
    userData?: Record<string, any>
})
export type SelectedInspectorItems = SelectedInspectorItem[]

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
    basePath: string = '',
    existingManifest?: FileManifestEntry[]
): Promise<FileManifestEntry[]> {
    const entries: FileManifestEntry[] = []

    // Iterate through all entries in the directory
    for await (const [name, entryHandle] of handle.entries()) {
        const fullPath = basePath ? `${basePath}/${name}` : name

        const existing = existingManifest?.find(e => e.path === fullPath && e.name === name && e.type === entryHandle.kind)

        if (entryHandle.kind === 'file') {
            if(existing){
                // reuse existing entry
                entries.push(existing)
                continue
            }
            // Handle file entry
            entries.push({
                name,
                path: fullPath,
                handle: entryHandle,
                type: 'file',
                isFSEntry: true

            })
        } else if (entryHandle.kind === 'directory') {
            if(existing){
                // reuse existing entry
                entries.push(existing)
            }

            // Handle directory entry - recursively process subdirectories
            const children = await directoryToManifest(entryHandle, fullPath, existing?.children)

            if(!existing)
            entries.push({
                name,
                path: fullPath,
                handle: entryHandle,
                type: 'directory',
                children: children,
                isFSEntry: true
            })
            else
            existing.children = children
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
    const [selectedInspectorItems, setSelectedInspectorItems] = useState<SelectedInspectorItems>([])
    const [selectedFiles, setSelectedFiles] = useState<FileManifestEntry[]>([])
    const [fileManifest, setFileManifest] = useState<FileManifestEntry[]>([])
    const [currentPath, setCurrentPath] = useState<string>('/')
    const {project} = useProject()

    const refreshManifest = useMemo(() => {
        let lastCall = 0;
        let last = undefined as FileManifestEntry[] | undefined
        return async (force = false) => {
            console.log('refresh manifest', force)
            const now = Date.now();
            if (project?.handle?.kind === "directory" && (force || (now - lastCall >= 3000))) {
                lastCall = now;
                return directoryToManifest(project.handle, '', last).then(f=>{
                    last = f
                    setFileManifest(f)
                    return f
                })
            }
        };
    }, [project]);

    // const inspectorItem = selectedFiles.length === 1 ? selectedFiles[0] : selectedInspectorItems.length === 1 ? selectedInspectorItems[0] : null

    return {
        selectedInspectorItems, setSelectedInspectorItems,
        selectedFiles, setSelectedFiles,
        // canRenderInspector,
        currentPath, setCurrentPath,
        fileManifest, /*setFileManifest,*/
        refreshManifest
    }
}

const AssetsContext = createContext<ReturnType<typeof useSetupAssets>|undefined>(undefined)
export const useAssets = () => useSafeContext(AssetsContext)

export function AssetsProvider({children}: { children: any }) {
    const value = useSetupAssets()
    const manager = useManager()

    const {setSelectedInspectorItems, setSelectedFiles, fileManifest} = value
    // console.log('fileManifest', fileManifest)
    useEffect(()=>{
        const picking = manager.get()?.getPlugin(PickingPlugin)
        const onSelectedChanged = ()=>{
            const sel = picking?.getSelectedObject()
            // console.log('selected object changed', sel)
            setSelectedInspectorItems(prev=>{
                // debugger
                // console.log('2selected object changed', sel, prev)
                if(!sel && !prev.length) return prev
                const curr = prev.length === 1 ? prev[0] : null
                if(curr === sel) return prev
                // if(Array.isArray(sel)){
                //     if(prev.length === sel.length && sel.every(s=>prev.includes(s))) return prev
                //     return sel
                // }
                // console.log('setting', sel ? [sel] : [])
                return sel ? [sel] : prev.length ? []: prev
            })
            // if(!sel) setSelectedFiles(p=>p.length ? [] : p) // if nothing is selected, clear selected files also

            // if sel is an asset itself, find the file and select it also, otherwise clear selected files
            // if(sel && /*sel?._isTpAsset &&*/ sel.userData.tpAssetId && sel.userData.rootPath?.startsWith('asset://') && fileManifest){
            //     const file = getFileByPath(sel.userData.rootPath.replace('asset://', ''), fileManifest)
            //     setSelectedFiles(f=>{
            //         // console.log('sel change 1')
            //         if(file && !f.includes(file)) return [file]
            //         return f.length ? [] : f
            //     })
            // }else{
            //     // console.log('sel change 2')
            //     setSelectedFiles(p=>p.length ? [] : p)
            // }
        }
        picking?.addEventListener('selectedObjectChanged', onSelectedChanged)
        return ()=>{
            picking?.removeEventListener('selectedObjectChanged', onSelectedChanged)
        }
    }, [manager, fileManifest])


    return createElement(AssetsContext.Provider, {value}, children)
}
