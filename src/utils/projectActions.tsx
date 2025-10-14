import {
    isPackageProject,
    useManager,
    useProject,
    ViewerInstanceManager
} from './ViewerInstanceManager.ts'
import {useCallback} from 'react'
import {uploadFile} from 'threepipe'
import {showSuccessErrorToast} from "./Toaster.tsx";
import {getMeta, LoadedProject, SavedSceneFile} from "./project.ts";

export async function resolveNameConflict(newName: string, manager: ViewerInstanceManager) {
    let conflict = true
    while (conflict) {
        const parts = newName.split('-')
        const last = parts[parts.length - 1]
        if (!isNaN(Number(last))) {
            parts[parts.length - 1] = (Number(last) + 1).toString()
        } else {
            parts.push('1')
        }
        newName = parts.join('-')
        const meta2 = await getMeta(newName)
        conflict = !!meta2
    }
    return newName
}

export function refreshQueryState(data: {project: string|null, file: string|null}) {
    const params = new URLSearchParams(location.search)
    const current = {
        project: params.get('project') || params.get('p') || null,
        file: params.get('file') || params.get('f') || null,
    }
    if (JSON.stringify(current) !== JSON.stringify(data)) {
        if (params.has('project')) params.delete('project')
        if (params.has('p')) params.delete('p')
        if (params.has('file')) params.delete('file')
        if (params.has('f')) params.delete('f')

        if (data.project) params.set('p', data.project)
        if (data.file) params.set('f', data.file)
        window.history.replaceState({}, '', '?' + params.toString())
        if(!data.project && current.project) {
            // force reload to reset state and import maps
            window.location.reload()
        }

    }
}

export function useProjectActions() {
    const manager = useManager()
    const {setProject, setWelcomeOpen} = useProject()

    const loadFile = useCallback(async (meta: LoadedProject, file: SavedSceneFile | null = null) => {
        manager.loadProject(meta, {})
        await manager.loadProjectFile(file)
        // refreshQueryState({project: meta.path, file: file?.path??null})
        setProject(meta)
        // setPFile(file)
    }, [setProject, manager])

    const unloadFile = useCallback(async () => {
        // refreshQueryState({project: null, file: null})
        await manager.loadProjectFile(null)
        manager.loadProject(null, {})
        setProject(null)
        setWelcomeOpen(true)
        return null
    }, [setProject, manager])

    const loadProject = useCallback(async (metaOrPath: LoadedProject | string | null, file?: string|null) => {
        if (!metaOrPath) {
            return await unloadFile()
        }
        let meta: LoadedProject|null = null
        if(typeof metaOrPath === 'string') {
            const meta1 = await getMeta(metaOrPath) ?? null
            meta = await manager.getLoadedProject(meta1) ?? {path: metaOrPath, file: new File(['{}'], 'dummy'), lastModified: Date.now() }
        }else {
            meta = metaOrPath
        }

        if(meta && isPackageProject(meta)){
            if(!meta.handle){
                console.error('ThreeEditor - cannot load a project without handle', meta)
                return
            }
            // await checkInitProject(meta)
        }
        if(!meta) {
            console.error({'ThreeEditor - no meta found for project': metaOrPath, meta})
            return
        }

        if (typeof meta.file === 'string') {
            console.error('ThreeEditor - TODO: loading strings as files not supported')
        } else {
            file = file || meta.settings?.mainScene
            const fi = file ? await manager.getLoadedFile(meta, file??null) : null
            await loadFile(meta, fi)
        }
        return meta
    }, [manager, unloadFile])

    const openProject = useCallback(async () => {
        if('showOpenFilePicker' in window && ViewerInstanceManager.ENABLE_FS_WRITE_API) {
            const [fileHandle] = await showOpenFilePicker({
                excludeAcceptAllOption: false,
                multiple: false, // todo allow multiple
                types: [
                    {
                        description: 'Models',
                        accept: {
                            'model/gltf+json': ['.gltf'],
                            'model/gltf-binary': ['.glb'],
                            'model/gltf+zip': ['.zip'],
                            'model/fbx': ['.fbx'],
                            'model/obj': ['.obj'],
                            'model/mtl': ['.mtl'],
                            'model/3dm': ['.3dm'],
                            'model/ply': ['.ply'],
                            'model/stl': ['.stl'],
                            // todo
                        },
                    },
                    {
                        description: 'JSON',
                        accept: {
                            'application/json': ['.json', '.vjson'],
                        },
                    },
                ]
            }).catch((e) => {
                console.error(e)
                return []
            })
            if(!fileHandle) return

            const fileName = fileHandle.name
            const fileNameWithoutExt = fileName.split('.').slice(0, -1).join('.')
            let newName = fileNameWithoutExt
            let meta = await getMeta(newName) // remove extension
            let isSameEntry = false
            if(meta?.file === fileName){
                let perm = await meta?.handle?.queryPermission({mode: 'read'})
                if(meta?.handle) {
                    if (perm !== 'granted') perm = await meta.handle.requestPermission({mode: 'read'})
                    if (perm !== 'granted') {
                        console.error('ThreeEditor - no permission to match files from db and fs', meta, fileName)
                        isSameEntry = true
                    }
                }
                const fileHandle2 = !isSameEntry ? await meta?.handle?.getFileHandle(meta?.file).catch((e) => {
        // todo handle if there is dir with same name
        // if(e.name === "NotFoundError") return null
        // if(e.name === "TypeMismatchError") return true
        return undefined
    }) : undefined
                isSameEntry = isSameEntry || await fileHandle2?.isSameEntry(fileHandle) || false
                if(!isSameEntry){
                    meta = undefined
                    newName = await resolveNameConflict(newName, manager)
                }
            }
            if(meta){
                const meta1 = await manager.getLoadedProject(meta)
                if(!meta1) {
                    console.error('ThreeEditor - cannot load project from meta', meta)
                    return
                }
                return await loadProject(meta1)
            }
            else {
                return await loadFile({
                    path: newName,
                    lastModified: Date.now(),
                    file: await fileHandle.getFile(),
                })
            }
        }else{
            const [file] = await uploadFile(
                false,
                false,
                ['gltf', 'glb', 'zip', 'fbx', 'obj', 'mtl', '3dm', 'ply', 'stl', 'json', 'vjson']
                    .join('|')
            ).catch(() => [])
            if(!file) return
            const fileName = file.name
            const fileNameWithoutExt = fileName.split('.').slice(0, -1).join('.')
            let newName = fileNameWithoutExt
            const meta = await getMeta(newName)
            if(!!meta){
                // conflict
                newName = await resolveNameConflict(newName, manager)
            }
            return await loadFile({
                path: newName,
                lastModified: Date.now(),
                file: file,
            })
        }
    }, [loadFile, manager])

    const saveProjectFile = useCallback(async ()=>{
        if(!manager.loadedProjectFile || !manager.loadedProject) return
        const res = await manager.saveProjectSceneOrAsset(manager.loadedProject, manager.loadedProjectFile).catch(e=>{
            console.error(e)
            return {error: 'Unable to save file: ' + (e.message || e.toString())}
        })
        // todo update projectFile.file?

        // todo use this everywhere
        return showSuccessErrorToast(`Saved ${manager.loadedProject.path}${manager.loadedProjectFile.path} successfully.`, 'Unable to save file.', res as any)
        // if(closeProject){
        //     await loadProject(null)
        // }
    }, [manager])

    return {loadProject, openProject, saveProjectFile}
}
