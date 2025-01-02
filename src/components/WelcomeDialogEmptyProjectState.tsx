import {Alignment, NonIdealState} from '@blueprintjs/core'
import {WelcomeDialogCreateProjectActions} from './WelcomeDialogCreateProjectActions'

export function WelcomeDialogEmptyProjectState() {
    return <NonIdealState
        // icon={'projects'}
        icon={<img src={'/logo.svg'} height={100}/>}
        title={'Threepipe Editor'}
        description={(
            <p style={{textAlign: 'justify'}}>
                <br/>
                View, Edit, Render, Export and Embed 3D files.
                <br/>
                <br/>
                Drag and Drop any 3D file and start editing.
            </p>)}
        // action={<Button icon={"add"} text={"New Project"} outlined />}
        children={(
            <div className="welcome-dialog-empty-actions">
                <WelcomeDialogCreateProjectActions alignText={Alignment.LEFT} minimal={true} outlined={false} />
            </div>
        )}
    />
}
