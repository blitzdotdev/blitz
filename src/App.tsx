import {ThreeEditorComponent} from './components/ThreeEditorComponent.tsx'
import {ManagerProvider, ProjectProvider} from './utils/ViewerInstanceManager.ts'
import {DialogComponent, DialogProvider, VisualStyleProvider} from 'uiconfig-blueprint/lib/esm/lib'
import {useState} from 'react'
import {WelcomeScreenDialog} from './components/WelcomeScreenDialog.tsx'
// import Split from "react-split";
// import {InspectorStackComponent} from 'uiconfig-blueprint/lib/esm/lib'


// console.log(InspectorStackComponent, Split)

function App() {
    const [welcomeOpen, setWelcomeOpen] = useState(true)
    return (
        <VisualStyleProvider>
        <DialogProvider>
        <ProjectProvider>
        <ManagerProvider>
            <>
                <ThreeEditorComponent />
                <WelcomeScreenDialog
                    isOpen={welcomeOpen}
                    onClose={()=>{
                        console.log('closed')
                        setWelcomeOpen(false)
                    }}/>
                <DialogComponent/>
            </>
        </ManagerProvider>
        </ProjectProvider>
        </DialogProvider>
        </VisualStyleProvider>
    )
}

export default App
