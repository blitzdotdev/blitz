import {Button, Colors, Icon} from '@blueprintjs/core'

export function WelcomeDialogCreateProjectActions({onNew, onOpen}: {onNew(): void, onOpen(): void}) {
    return <>
        <Button
            icon={<Icon color={Colors.GREEN4} icon="add"/>}
            text="New Project"
            variant="solid"
            onClick={onNew}/>
        <Button
            icon={<Icon color={Colors.GREEN4} icon="folder-open"/>}
            text="Open Project"
            variant="solid"
            onClick={onOpen}/>
    </>
}
