import {Alignment, Button, Colors, Icon} from '@blueprintjs/core'
import {useDialogPrompt, useLoadingState} from 'uiconfig-blueprint/lib/esm/lib'
import {resolveNameConflict, useProjectActions} from '../utils/projectActions.tsx'
import {useManager, useProject} from '../utils/ViewerInstanceManager.ts'
import {useCallback} from 'react'
import {useSaveFile} from "./UseSaveFile.tsx";

export function WelcomeDialogCreateProjectActions(props: {alignText?: Alignment, minimal?: boolean, outlined?: boolean}) {
    const {loadingState, updateLoading} = useLoadingState()
    const {saveFile} = useSaveFile()
    const {openProject, loadProject} = useProjectActions()
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
        await loadProject(newName, false)
        // setWelcomeOpen(false)
    }, [saveFile, manager, fileUrlPrompt])

    return <>
        <Button
            // icon={<Icon color={Colors.GREEN4} icon={'add'}/>}
            icon={<Icon color={Colors.GREEN4} icon={'add'}/>}
                text={'Create New File'}
                minimal={props.minimal} outlined={props.outlined} alignText={props.alignText}
                loading={loadingState['create-new']}
                onClick={() => updateLoading('create-new', setWelcomeOpen(false ))}
                // onClick={() => setProject('Untitled')} // todo choose between this and saveFile
        />
        <Button icon={<Icon color={Colors.GOLD3} icon={'folder-open'}/>}
                text={'Open Existing 3D File'}
                minimal={props.minimal} outlined={props.outlined} alignText={props.alignText}
                loading={loadingState['open-file']}
                onClick={() => updateLoading('open-file', openProject())}
        />
        <Button icon={<Icon color={Colors.GOLD3} icon={'link'}/>}
                text={'Import from URL'}
                minimal={props.minimal} outlined={props.outlined} alignText={props.alignText}
                loading={loadingState['import-url']}
                onClick={() => updateLoading('import-url', importUrl())}
        />
        <Button icon={<Icon color={Colors.RED4} icon={'rocket-slant'}/>}
                text={'Browse Community Files'}
                minimal={props.minimal} outlined={props.outlined} alignText={props.alignText}
                rightIcon={<Icon icon={'share'} size={14}/>}
                disabled
        />
    </>
}
