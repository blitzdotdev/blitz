import {Alignment, Button, Colors, Icon} from '@blueprintjs/core'
import {useLoadingState} from 'uiconfig-blueprint/lib/esm/lib'
import {useSaveFile} from './SaveFileButton.tsx'
import {useProjectActions} from '../utils/projectActions.tsx'
import {useProject} from '../utils/ViewerInstanceManager.ts'

export function WelcomeDialogCreateProjectActions(props: {alignText?: Alignment, minimal?: boolean, outlined?: boolean}) {
    const {loadingState, updateLoading} = useLoadingState()
    const {saveFile} = useSaveFile()
    const {openProject} = useProjectActions()
    // @ts-ignore
    const {setProject} = useProject()

    return <>
        <Button
            // icon={<Icon color={Colors.GREEN4} icon={'add'}/>}
            icon={<Icon color={Colors.GREEN4} icon={'add'}/>}
                text={'Create New File'}
                minimal={props.minimal} outlined={props.outlined} alignText={props.alignText}
                loading={loadingState['create-new']}
                onClick={() => updateLoading('create-new', saveFile({}))}
                // onClick={() => setProject('Untitled')} // todo choose between this and saveFile
        />
        <Button icon={<Icon color={Colors.GOLD3} icon={'folder-open'}/>}
                text={'Open Existing 3D File'}
                minimal={props.minimal} outlined={props.outlined} alignText={props.alignText}
                loading={loadingState['open-file']}
                onClick={() => updateLoading('open-file', openProject())}
        />
        <Button icon={<Icon color={Colors.RED4} icon={'rocket-slant'}/>}
                text={'Browse Community Files'}
                minimal={props.minimal} outlined={props.outlined} alignText={props.alignText}
                rightIcon={<Icon icon={'share'} size={14}/>}
                disabled
        />
    </>
}
