import {
    SavedSceneFile,
    SavedSceneFileMeta, SavedSceneFileMetaStored,
    useManager,
    useProject,
    ViewerInstanceManager
} from './ViewerInstanceManager.ts'
import {useCallback} from 'react'
import {uploadFile} from 'threepipe'
import {showSuccessErrorToast} from "./Toaster.tsx";

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

function refreshQueryState(data: {project: string|null, file: string|null}) {
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

const packageFilePath = 'package.json'
const iconFilePath = 'icon.png'
const assetsDirPath = 'assets/'
const mainScenePath = `${assetsDirPath}main.scene.glb`

export type LoadedProject = SavedSceneFile & {
    settings?: {
        mainScene: string|null
        json: any
    }
}
export async function checkInitProject(meta: SavedSceneFileMeta | SavedSceneFileMetaStored): Promise<LoadedProject>{
    if(!meta.handle) throw new Error('No handle to check project init')
    const handle = meta.handle
    let packageFileHandle = await handle.getFileHandle(meta.file).catch(() => undefined)
    if(!packageFileHandle){
        packageFileHandle = await handle.getFileHandle(meta.file, {create: true}).catch(e=>{
            console.error('ThreeEditor - cannot create package.json file', e)
            return undefined
        })
        if(!packageFileHandle) throw new Error('No package.json file in project and cannot create one')
        const writer = await packageFileHandle.createWritable()
        const defaultPackageJson = {
            name: meta.path,
            version: '1.0.0',
            private: true,
            description: '',
            scripts: {},
            mainScene: mainScenePath,
            keywords: ['3d', 'game', 'threepipe', 'three-editor'],
        }
        await writer.write(JSON.stringify(defaultPackageJson, null, 2))
        await writer.close()
    }
    if(typeof meta.preview === 'string') { // todo when is it a File object? is it possible in package.json projects?
        let iconFileHandle = await handle.getFileHandle(meta.preview).catch(() => undefined)
        if (!iconFileHandle) {
            iconFileHandle = await handle.getFileHandle(meta.preview, {create: true}).catch(e=>{
                console.error('ThreeEditor - cannot create icon file', e)
                return undefined
            })
            if(iconFileHandle) {
                const writer = await iconFileHandle.createWritable()
                // write empty png
                const emptyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ipXkAAAAASUVORK5CYII='
                await writer.write(Uint8Array.from(atob(emptyPng), c => c.charCodeAt(0)))
                await writer.close()
            }
        }
    }
    if(meta.assets) {
        const p = meta.assets.replace(/\/$/, '')
        let assetsDirHandle = await handle.getDirectoryHandle(p).catch(() => undefined)
        if (!assetsDirHandle) {
            assetsDirHandle = await handle.getDirectoryHandle(p, {create: true}).catch(e=>{
                console.error('ThreeEditor - cannot create assets dir', e)
                return undefined
            })
        }
    }

    try {
        let packageJsonFile = await packageFileHandle.getFile()
        const text = await packageJsonFile.text()
        const json = JSON.parse(text)
        if(!json.mainScene){
            json.mainScene = 'assets/main.scene.glb'
        }
        return {
            ...meta,
            file: packageJsonFile,
            settings: {mainScene: json.mainScene, json: json}
        }
    }catch (e){
        console.error('ThreeEditor - cannot read package.json file', e)
        throw new Error('Cannot read package.json file')
    }
}

export function useProjectActions() {
    const manager = useManager()
    const {setProject, setWelcomeOpen, projectFile, setPFile, project} = useProject()

    const loadFile = useCallback((meta: LoadedProject, file: SavedSceneFile | null = null) => {
        refreshQueryState({project: meta.path, file: file?.path??null})
        setProject(meta)
        setPFile(file)
    }, [setProject])

    const setProjectFile = (file: SavedSceneFile|null, p?: LoadedProject)=>{
        if(p && p !== project) {
            console.error('Invalid project')
            return
        }
        refreshQueryState({project: project?.path||null, file: file?.path??null})
        setPFile(file)
    }

    const unloadFile = useCallback(() => {
        refreshQueryState({project: null, file: null})
        setProject(null)
        setPFile(null)
        setWelcomeOpen(true)
        return null
    }, [setProject])

    const loadProject = useCallback(async (metaOrPath: LoadedProject | string | null, file?: string|null) => {
        if (!metaOrPath) {
            return unloadFile()
        }
        let meta: LoadedProject|null = null
        if(typeof metaOrPath === 'string') {
            const meta1 = await manager.getMeta(metaOrPath) ?? null
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
            loadFile(meta, fi)
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
            if(meta){
                const meta1 = await manager.getLoadedProject(meta)
                if(!meta1) {
                    console.error('ThreeEditor - cannot load project from meta', meta)
                    return
                }
                return await loadProject(meta1)
            }
            else {
                return loadFile({
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
            const meta = await manager.getMeta(newName)
            if(!!meta){
                // conflict
                newName = await resolveNameConflict(newName, manager)
            }
            return loadFile({
                path: newName,
                lastModified: Date.now(),
                file: file,
            })
        }
    }, [loadFile, manager])

    const openProjectFolder = useCallback(async (_newFolder = false) => {
        if('showDirectoryPicker' in window && ViewerInstanceManager.ENABLE_FS_WRITE_API) {
            const folderHandle = await showDirectoryPicker({
                id: 'open-project',
                mode: 'readwrite',
                // startIn: todo meta handle?
            }).catch((e) => {
                console.error(e)
                return null
            })
            if(!folderHandle) return

            const projectName = folderHandle.name
            // let newName = projectName
            let meta = await manager.getMeta(projectName)
            let isSameEntry = false
            if(meta){
                let perm = await meta.handle?.queryPermission({mode: 'read'})
                if(meta.handle) {
                    if (perm !== 'granted') perm = await meta.handle.requestPermission({mode: 'read'})
                    if (perm !== 'granted') {
                        console.error('ThreeEditor - no permission to match files from db and fs', meta, projectName)
                        isSameEntry = true
                    }
                }
                // const fileHandle2 = !isSameEntry ? await meta.handle?.getDirectoryHandle(meta?.file).catch(() => undefined) : undefined
                isSameEntry = isSameEntry || await meta?.handle?.isSameEntry(folderHandle) || false
                if(!isSameEntry){
                    // meta = undefined
                    // newName = await resolveNameConflict(newName, manager)
                    throw new Error('A project with the same name already exists, please rename it first in order to avoid conflicts')
                }
                const meta1 = await manager.getLoadedProject(meta)
                if(!meta1) {
                    console.error('ThreeEditor - cannot load project from meta', meta)
                    return {error: 'Cannot load project from meta'}
                }
                return await loadProject(meta1)
            }
            else {

                const handle = folderHandle
                    let perm = await handle.queryPermission({mode: 'readwrite'})
                    if (perm !== 'granted') {
                        perm = await handle.requestPermission({mode: 'readwrite'})
                    }
                    if (perm !== 'granted') {
                        return {
                            error: 'no permission to write to the file system, cannot save file'
                        }
                    }

                    // const fileHandle = await handle.getFileHandle(name + '.' + fileExt, {create: true})
                    // const previewHandle = previewFile && await handle.getFileHandle(name + '.' + previewExt!, {create: true})
                    // const writer = await fileHandle.createWritable()
                    // await writer.write(fileFile)
                    // await writer.close()
                    // if (previewHandle) {
                    //     const writer = await previewHandle.createWritable()
                    //     await writer.write(previewFile)
                    //     await writer.close()
                    // }
                    // file = name + '.' + fileExt
                    // this is commented so that the preview is always stored in idb, since handles can require permission on reload.
                    // preview = previewFile && (name + '.' + previewExt)

                // store meta in idb
                const meta1 = {
                    path: projectName.replace(/\/$/, '').split('/').pop() || '',
                    lastModified: Date.now(),
                    file: packageFilePath,
                    preview: iconFilePath,
                    assets: assetsDirPath,
                    handle,
                }
                if(!meta1.path){
                    throw new Error('Invalid project name')
                }
                if (!meta1.path.endsWith('/')) meta1.path += '/'
                await manager.browserStore.put(meta1, meta1.path + ViewerInstanceManager.FILE_META_KEY)
                // if (file !== meta1.file) await this.browserStore.put(file, meta1.path + fileKey)
                // if (preview !== meta1.preview) await this.browserStore.put(preview, meta1.path + previewKey)
                const meta2 = await checkInitProject(meta1)
                return await loadProject(meta2)

                // return await loadFile(await folderHandle.getDirectory(), newName)
            }
        }else{
            throw new Error('File System Access API not supported')
        }
    }, [loadProject, manager])

    const saveProjectFile = useCallback(async ()=>{
        if(!projectFile || !project) return
        const res = await manager.saveProjectSceneOrAsset(project, projectFile).catch(e=>{
            console.error(e)
            return {error: 'Unable to save file: ' + (e.message || e.toString())}
        })
        // todo update projectFile.file?

        // todo use this everywhere
        return showSuccessErrorToast(`Saved ${project.path}/${projectFile.path} successfully.`, 'Unable to save file.', res as any)
        // if(closeProject){
        //     await loadProject(null)
        // }
    }, [manager, project, projectFile])

    return {loadProject, openProject, openProjectFolder, saveProjectFile, setProjectFile}
}

export function isPackageProject(meta?: SavedSceneFile|SavedSceneFileMeta|SavedSceneFileMetaStored|null){
    return meta && (meta.file as string === 'package.json' || (meta.file as any as File)?.name === 'package.json')
}
