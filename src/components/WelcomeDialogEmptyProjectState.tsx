import {Alignment, NonIdealState} from '@blueprintjs/core'
import {WelcomeDialogCreateProjectActions} from './WelcomeDialogCreateProjectActions'

export function WelcomeDialogEmptyProjectState() {
    return <NonIdealState
        icon={'projects'}
        title={'Threepipe Editor'}
        description={(
            <p style={{textAlign: 'justify'}}>
                ThreePipe is a 3D framework built on top of three.js with a focus on rendering quality, modularity, and extensibility.
                <br/>
                Threepipe Editor is a visual editor for creating and editing 3D scenes in glb format.
            </p>)}
        // action={<Button icon={"add"} text={"New Project"} outlined />}
        children={(
            <div className="welcome-dialog-empty-actions">
                <WelcomeDialogCreateProjectActions alignText={Alignment.LEFT} minimal={true} outlined={false} />
            </div>
        )}
    />
}
