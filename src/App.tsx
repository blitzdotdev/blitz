import {ThreeEditorComponent} from './components/ThreeEditorComponent.tsx'
import {ManagerProvider, ProjectProvider} from './utils/ViewerInstanceManager.ts'
import {DialogComponent, DialogProvider, VisualStyleProvider} from 'uiconfig-blueprint/lib/esm/lib'
import {WelcomeScreenDialog} from './components/WelcomeScreenDialog.tsx'
// import Split from "react-split";
// import {InspectorStackComponent} from 'uiconfig-blueprint/lib/esm/lib'


// console.log(InspectorStackComponent, Split)

function App() {
    return (
        <VisualStyleProvider>
        <DialogProvider>
        <ProjectProvider>
        <ManagerProvider>
            <>
                <ThreeEditorComponent />
                <WelcomeScreenDialog/>
                <DialogComponent/>
            </>
        </ManagerProvider>
        </ProjectProvider>
        </DialogProvider>
        </VisualStyleProvider>
    )
}

export default App
