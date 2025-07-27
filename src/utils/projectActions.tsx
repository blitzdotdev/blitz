import {SavedSceneFileMeta, useManager, useProject, ViewerInstanceManager} from './ViewerInstanceManager.ts'
import {useCallback} from 'react'
import {uploadFile} from 'threepipe'

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
        const meta2 = await manager.getMeta(newName)
        conflict = !!meta2
    }
    return newName
}

function refreshQueryState(newProject: string|null) {
    if (newProject) {
        console.log('Project changed:', newProject)
    }
    const params = new URLSearchParams(location.search)
    const current = params.get('project') || params.get('p') || null
    if (current !== newProject) {
        if (params.has('project')) params.delete('project')
        if (params.has('p')) params.delete('p')
        if(newProject) params.set('p', newProject)
        window.history.replaceState({}, '', '?' + params.toString())
    }
}

export function useProjectActions() {
    const manager = useManager()
    const {setFile, setProject, setWelcomeOpen} = useProject()

    const loadFile = useCallback((file: File, name?: string) => {
        const newName = name || file.name.split('.').slice(0, -1).join('.')
        refreshQueryState(newName)
        setProject(newName)
        setFile(file)
        return name
    }, [setFile, setProject])

    const unloadFile = useCallback(() => {
        refreshQueryState(null)
        setProject('')
        setFile(null)
        setWelcomeOpen(true)
        return null
    }, [setFile, setProject])

    const loadProject = useCallback(async (metaOrPath: SavedSceneFileMeta | string | null, doSetFile = true) => {
        if (!metaOrPath) {
            return unloadFile()
        }
        let meta
        let path
        if(typeof metaOrPath === 'string') {
            path = metaOrPath
            meta = doSetFile ? await manager.getMeta(metaOrPath) : null
        }else {
            path = metaOrPath.path
            meta = metaOrPath
        }
        const scene = meta && doSetFile ? await manager.getFileFromMeta(meta) : null
        const newProject = path.replace(/\/$/, '').split('/').pop()!

        if(doSetFile) {
            if (!scene?.file) {
                console.error('ThreeEditor - no file found for project', newProject, scene)
                return
            }
            if (typeof scene.file === 'string') {
                console.error('ThreeEditor - TODO: loading strings as files not implemented')
            } else {
                loadFile(scene.file, newProject)
            }
        }
        else {
            refreshQueryState(newProject);
            setProject(newProject)
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
            let meta = await manager.getMeta(newName) // remove extension
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
                const fileHandle2 = !isSameEntry ? await meta?.handle?.getFileHandle(meta?.file).catch(() => undefined) : undefined
                isSameEntry = isSameEntry || await fileHandle2?.isSameEntry(fileHandle) || false
                if(!isSameEntry){
                    meta = undefined
                    newName = await resolveNameConflict(newName, manager)
                }
            }
            if(meta)
                return await loadProject(meta)
            else
                return await loadFile(await fileHandle.getFile(), newName)
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
            const meta = await manager.getMeta(newName)
            if(!!meta){
                // conflict
                newName = await resolveNameConflict(newName, manager)
            }
            return await loadFile(file, newName)
        }
    }, [loadFile, manager])

    return {loadProject, openProject, loadFile, unloadFile}
}
