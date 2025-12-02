import {isPackageProject, ViewerInstanceManager} from './ViewerInstanceManager.ts'
import {useCallback} from 'react'
import {uploadFile} from 'threepipe'
import {ErrorRes, showSuccessErrorToast} from "./Toaster.tsx";
import {getMeta, LoadedProject, SavedSceneFile} from "./project.ts";
import {useProject} from "./UseProject.ts";
import {useManager} from "./UseManager.ts";
import {resolveNameConflict} from "./resolveNameConflict.ts";
import {refreshProjectQueryState} from "./refreshProjectQueryState.ts";

export function useProjectActions() {
    const manager = useManager()
    const {setProject, setWelcomeOpen} = useProject()

    const loadFile = useCallback(async (meta: LoadedProject, file: SavedSceneFile | null = null) => {
        await manager.loadProject(meta, {})
        // await manager.loadProjectFile(file)
        // refreshQueryState({project: meta.path, file: file?.path??null})
        const res = await manager.loadProjectFile(file).catch(e=>{
            console.error(e)
            return {error: e?.message ?? 'Unknown error'}
        })
        // console.log(res)
        if(meta.path) showSuccessErrorToast(`Loaded ${meta.path}${file?.path||''}`, 'Unable to load project file', res as ErrorRes)
        // setPFile(file)
        setProject(meta)
    }, [setProject, manager])

    const unloadFile = useCallback(async () => {
        if(manager.loadedNeedsSave) return
        // refreshQueryState({project: null, file: null})
        const res = await manager.loadProjectFile(null, false, true).catch(e=>{
            return {error: e?.message ?? 'Unknown error'}
        })
        if(manager.loadedProject) showSuccessErrorToast(`Closed Project`, 'Unable to close project', res as ErrorRes)
        await manager.loadProject(null, {})
        setProject(null)
        setWelcomeOpen(true)
        return null
    }, [setProject, manager])

    const loadProject1 = useCallback(async (metaOrPath: LoadedProject | string | null, file?: string|null) => {
        if (!metaOrPath) {
            return await unloadFile()
        }
        let meta: LoadedProject|null = null
        if(typeof metaOrPath === 'string') {
            try {
                const meta1 = await getMeta(metaOrPath) ?? null
                meta = await manager.getLoadedProject(meta1) ?? {
                    path: metaOrPath,
                    file: new File(['{}'], 'dummy.scene.glb'),
                    lastModified: Date.now()
                }
            }catch (e: any) {
                showSuccessErrorToast('', 'Unable to load project', {error: e?.message || e?.toString()})
                console.error('ThreeEditor - unable to load project meta for path', metaOrPath, e)
                return
            }
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
                    newName = await resolveNameConflict(newName)
                }
            }
            if(meta){
                const meta1 = await manager.getLoadedProject(meta)
                if(!meta1) {
                    console.error('ThreeEditor - cannot load project from meta', meta)
                    return
                }
                // return await loadProject(meta1)
                refreshProjectQueryState({project: meta.path, file: null}, true)
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
                newName = await resolveNameConflict(newName)
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

    return {loadProject1, openProject, saveProjectFile}
}
