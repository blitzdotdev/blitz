import {NonIdealState} from '@blueprintjs/core'

export function WelcomeDialogEmptyProjectState() {
    return <NonIdealState
        icon={<img src="/logo.svg" height={100} alt="Kite3D"/>}
        title="No projects yet"
        description="Create a project or add an existing Kite3D project."/>
}
