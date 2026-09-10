import {Alignment, ButtonGroup, H4} from '@blueprintjs/core'
import {WelcomeDialogCreateProjectActions} from './WelcomeDialogCreateProjectActions.tsx'

export function WelcomeDialogProjectsTab() {
    return <div className="welcome-main-container">
        <H4>Import assets into the project served by Blitz</H4>
        <p>Drop 3D files anywhere in the viewport to import them.</p>
        <ButtonGroup className="welcome-main-create-actions">
            <WelcomeDialogCreateProjectActions alignText={Alignment.CENTER}/>
        </ButtonGroup>
    </div>
}
