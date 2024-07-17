import {SavedSceneFileMeta, useManager, useProject, ViewerInstanceManager} from './ViewerInstanceManager.ts'
import {useCallback} from 'react'
import {uploadFile} from 'threepipe'

async function resolveNameConflict(newName: string, manager: ViewerInstanceManager) {
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

export function useProjectActions() {
    const manager = useManager()
    const {setFile, setProject} = useProject()

    const loadFile = useCallback(async (file: File, name?: string) => {
        const newName = name || file.name.split('.').slice(0, -1).join('.')
        setProject(newName)
        setFile(file)
    }, [setFile, setProject])

    const unloadFile = useCallback(async () => {
        setProject('')
        setFile(null)
    }, [setFile, setProject])

    const loadProject = useCallback(async (meta: SavedSceneFileMeta) => {
        const scene = await manager.getFileFromMeta(meta)
        if (!scene?.file) return
        if (typeof scene.file === 'string') {
            console.error('todo: not implemented')
        } else {
            const name = meta.path.replace(/\/$/, '').split('/').pop()!
            await loadFile(scene.file, name)
        }
        return meta
    }, [manager])

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
                        console.error('no permission to match files from db and fs', meta, fileName)
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
