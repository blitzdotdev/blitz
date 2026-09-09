import {Alignment, Button, Colors, Icon} from '@blueprintjs/core'
import {useDialogPrompt, useLoadingState} from 'uiconfig-blueprint/lib/esm/lib'
import {useProjectActions} from '../utils/projectActions.tsx'
import {useCallback} from 'react'
import {useSaveFile} from "./UseSaveFile.tsx";
import {getMeta} from "../utils/project.ts";
import {ThreeViewer} from "threepipe";
import {useProject} from "../utils/UseProject.ts";
import {useManager} from "../utils/UseManager.ts";
import {resolveNameConflict} from "../utils/resolveNameConflict.ts";
import {refreshProjectQueryState} from "../utils/refreshProjectQueryState.ts";
import {queryHandlePerm} from "../utils/fsApi.ts";
import {ViewerInstanceManager} from "../utils/ViewerInstanceManager.ts";

export function useProjectFolderActions(){
    const manager = useManager()
    // const {loadProject} = useProjectActions()

    const openProjectFolder = useCallback(async (folderHandle?: FileSystemDirectoryHandle|null) => {
        if(!('showDirectoryPicker' in window && ViewerInstanceManager.ENABLE_FS_WRITE_API)) {
            throw new Error('File System Access API not supported')
        }
        folderHandle = folderHandle ?? await showDirectoryPicker({
            id: 'open-project',
            mode: 'readwrite',
            // startIn: todo meta handle?
        }).catch((e) => {
            console.error(e)
            return null
        })
        if(!folderHandle) {
            return {error: 'No folder selected'}
        }

        const projectName = folderHandle.name
        // let newName = projectName
        let meta = await getMeta(projectName)
        let isSameEntry = false
        if(meta){
            if(meta.handle) {
                await queryHandlePerm(meta.handle).catch(e=>{
                    console.error('ThreeEditor - no permission to match files from db and fs', meta, projectName)
                    isSameEntry = true
                })
            }
            isSameEntry = isSameEntry || await meta?.handle?.isSameEntry(folderHandle) || false
            if(!isSameEntry){
                // meta = undefined
                // newName = await resolveNameConflict(newName, manager)
                throw new Error('A project with the same name already exists, please rename it first in order to avoid conflicts')
            }
            // const meta1 = await manager.getLoadedProject(meta)
            // if(!meta1) {
            //     console.error('ThreeEditor - cannot load project from meta', meta)
            //     return {error: 'Cannot load project from meta'}
            // }
            // return await loadProject(meta1)
            refreshProjectQueryState({project: meta.path, file: null}, true)
        }
        else {
            const handle = folderHandle
            try {
                await queryHandlePerm(handle)
            }catch (e: any){
                return {
                    error: e?.message || 'Unknown error'
                }
            }
            const meta2 = await manager.createNewProjectMeta(projectName, handle)
            refreshProjectQueryState({project: meta2.path, file: null}, true)
            // const m = await loadProject(meta2)
            // if(!m){
            //     return {error: 'Unable to load project'}
            // }

            // return await loadFile(await folderHandle.getDirectory(), newName)
        }
    }, [manager])

    const {prompt} = useDialogPrompt()

    const createProjectFolder = useCallback(async () => {
        if(!('showDirectoryPicker' in window && ViewerInstanceManager.ENABLE_FS_WRITE_API)) {
            throw new Error('File System Access API not supported')
        }
        // const r1 = await prompt({
        //     title: 'Pick a folder',
        //     message: 'Select a location to create the new project, ideally this should be a "Projects" folder in your home directory.',
        //     showInput: false,
        //     closeButtonText: 'Cancel',
        //     submitButtonText: 'Okay',
        //     canClose: false,
        // })
        // if(r1 === null) return

        const folderHandle = await showDirectoryPicker({
            id: 'create-project',
            mode: 'readwrite',
            // startIn: todo meta handle?
        }).catch((e) => {
            console.error(e)
            return null
        })
        if(!folderHandle) {
            return {error: 'No folder selected'}
        }
        const hasPerm = await queryHandlePerm(folderHandle).catch(e=>{
            console.error(e)
            return false
        })
        if(!hasPerm) {
            return {error: 'No permission to access the selected folder'}
        }

        const resName = await prompt({
            title: 'Project name',
            message: 'Enter a name for the new project: ',
            placeholder: 'My File',
            closeButtonText: 'Cancel',
            submitButtonText: 'Create',
            value: 'blitz-project',
            // onClose: ()=>{console.log('close'); return true},
            onSubmit: async (value) => {
                const projectName = value.trim().replace(/[/\\?%*:|"<>\s]/g, '-')
                if(!projectName) {
                    return {error: 'Invalid project name'}
                }
                // console.log(projectName)
                const meta = await getMeta(projectName)
                if (meta) return {error: 'Project with the same name already exists'} // todo toaster
                const r = await folderHandle.getDirectoryHandle(projectName, {create: false}).catch(e=>{
                    if(e.name === "TypeMismatchError") return true
                    return false
                })
                if(!!r){
                    return {error: 'A folder with the same name already exists in the selected location'}
                }
                return !meta;
            },
        })
        if(resName === null) return

        const projectName = resName.trim().replace(/[/\\?%*:|"<>\s]/g, '-')
        if(!projectName.length) {
            return {error: 'Invalid project name'}
        }
        // create folder
        const projectFolderHandle = await folderHandle.getDirectoryHandle(projectName, {create: true}).catch(e=>{
            console.error('Unable to create project folder', e)
            return null
        })
        if(!projectFolderHandle) {
            return {error: 'Unable to create project folder'}
        }
        return openProjectFolder(projectFolderHandle)
    }, [openProjectFolder, manager, prompt])
    return {openProjectFolder, createProjectFolder}
}

export function WelcomeDialogCreateProjectActions(props: {alignText?: Alignment, minimal?: boolean, outlined?: boolean}) {
    const {loadingState, updateLoading} = useLoadingState()
    const {setWelcomeOpen} = useProject()
    const {saveFile} = useSaveFile()
    const {openProject} = useProjectActions()
    const {createProjectFolder, openProjectFolder} = useProjectFolderActions()
    const {prompt} = useDialogPrompt()

    const manager = useManager()
    const fileUrlPrompt = useCallback(async () => await prompt({
        title: 'File URL',
        message: 'Enter a URL to a 3D file: ',
        placeholder: 'https://example.com/file.glb',
        closeButtonText: 'Cancel',
        submitButtonText: 'Import',
        value: 'https://threejs.org/examples/models/gltf/DamagedHelmet/glTF/DamagedHelmet.gltf',
        // onClose: ()=>{console.log('close'); return true},
        onSubmit: async (value) => manager.get().load(value).then(()=>true).catch(e => {
            console.error(e)
            return {error: 'Unable to load file'}
        }),
    }), [prompt, manager])

    const importUrl = useCallback(async () => {
        // todo
        // const allowed = ['gltf', 'glb', 'zip', 'fbx', 'obj', 'mtl', '3dm', 'ply', 'stl', 'json', 'vjson']
        // if(!allowed.some(ext => url.endsWith(ext))) {
        //     throw new Error('Unsupported file extension')
        // }
        const url = await fileUrlPrompt()
        if(!url) return
        const fileName = url.split('/').pop() || 'file'
        let newName = fileName.split('.').slice(0, -1).join('.')
        let meta = await getMeta(newName)
        if(!!meta){
            // conflict
            newName = await resolveNameConflict(newName)
        }
        // await saveFile({name: newName, isNewName: true, saveTempOnly: false, closeProject: false})
        refreshProjectQueryState({project: newName, file: null, model: url}, true)
        // setWelcomeOpen(false)
    }, [saveFile, manager, fileUrlPrompt])

    return <>
        <Button
            // icon={<Icon color={Colors.GREEN4} icon={'add'}/>}
            icon={<Icon color={Colors.GREEN4} icon={'add'}/>}
                text={'New Project'}
                variant={props.minimal ? "minimal" : props.outlined ? "outlined" : "solid"} alignText={props.alignText}
                loading={loadingState['create-project']}
                onClick={() => updateLoading('create-project', createProjectFolder())}
                // onClick={() => setProject('Untitled')} // todo choose between this and saveFile
        />
        <Button icon={<Icon color={Colors.GREEN4} icon={'folder-open'}/>}
                text={'Open Project'}
                variant={props.minimal ? "minimal" : props.outlined ? "outlined" : "solid"}
                alignText={props.alignText}
                loading={loadingState['open-folder']}
                onClick={() => updateLoading('open-folder', openProjectFolder())}
        />
        <Button icon={<Icon color={Colors.GOLD3} icon={'cube-edit'}/>}
                text={'Open 3D File'}
                variant={props.minimal ? "minimal" : props.outlined ? "outlined" : "solid"}
                alignText={props.alignText}
                loading={loadingState['open-file']}
                onClick={() => updateLoading('open-file', openProject())}
        />
        <Button
            // icon={<Icon color={Colors.GREEN4} icon={'add'}/>}
            icon={<Icon color={Colors.GREEN4} icon={'cube-add'}/>}
            text={'Create New File'}
            variant={props.minimal ? "minimal" : props.outlined ? "outlined" : "solid"}
            alignText={props.alignText}
            loading={loadingState['create-new']}
            onClick={() => updateLoading('create-new', setWelcomeOpen(false ))}
            // onClick={() => setProject('Untitled')} // todo choose between this and saveFile
        />
        <Button icon={<Icon color={Colors.GOLD3} icon={'link'}/>}
                text={'Import from URL'}
                variant={props.minimal ? "minimal" : props.outlined ? "outlined" : "solid"}
                alignText={props.alignText}
                loading={loadingState['import-url']}
                onClick={() => updateLoading('import-url', importUrl())}
        />
        <Button icon={<Icon color={Colors.RED4} icon={'rocket-slant'}/>}
                text={'Browse Community Files'}
                variant={props.minimal ? "minimal" : props.outlined ? "outlined" : "solid"}
                alignText={props.alignText}
                endIcon={<Icon icon={'share'} size={14}/>}
                disabled
        />
    </>
}
