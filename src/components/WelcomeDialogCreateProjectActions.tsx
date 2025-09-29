import {Alignment, Button, Colors, Icon} from '@blueprintjs/core'
import {useDialogPrompt, useLoadingState} from 'uiconfig-blueprint/lib/esm/lib'
import {resolveNameConflict, useProjectActions} from '../utils/projectActions.tsx'
import {useManager, useProject} from '../utils/ViewerInstanceManager.ts'
import {useCallback} from 'react'
import {useSaveFile} from "./UseSaveFile.tsx";

export function WelcomeDialogCreateProjectActions(props: {alignText?: Alignment, minimal?: boolean, outlined?: boolean}) {
    const {loadingState, updateLoading} = useLoadingState()
    const {saveFile} = useSaveFile()
    const {openProject, loadProject, openProjectFolder} = useProjectActions()
    const {setWelcomeOpen} = useProject()
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
        let meta = await manager.getMeta(newName)
        if(!!meta){
            // conflict
            newName = await resolveNameConflict(newName, manager)
        }
        // await saveFile({name: newName, isNewName: true, saveTempOnly: false, closeProject: false})
        await loadProject(newName)
        // setWelcomeOpen(false)
    }, [saveFile, manager, fileUrlPrompt])

    return <>
        {/*<Button*/}
        {/*    // icon={<Icon color={Colors.GREEN4} icon={'add'}/>}*/}
        {/*    icon={<Icon color={Colors.GREEN4} icon={'add'}/>}*/}
        {/*        text={'New Project'}*/}
        {/*        variant={props.minimal ? "minimal" : props.outlined ? "outlined" : "solid"} alignText={props.alignText}*/}
        {/*        loading={loadingState['create-project']}*/}
        {/*        onClick={() => updateLoading('create-project', openProjectFolder(true))}*/}
        {/*        // onClick={() => setProject('Untitled')} // todo choose between this and saveFile*/}
        {/*/>*/}
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
                rightIcon={<Icon icon={'share'} size={14}/>}
                disabled
        />
    </>
}
