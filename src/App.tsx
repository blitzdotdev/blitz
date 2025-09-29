import {ThreeEditorComponent} from './components/ThreeEditorComponent.tsx'
import {ManagerProvider, ProjectProvider} from './utils/ViewerInstanceManager.ts'
import {DialogComponent, DialogProvider, VisualStyleProvider} from 'uiconfig-blueprint/lib/esm/lib'
import {WelcomeScreenDialog} from './components/WelcomeScreenDialog.tsx'
import {BlueprintProvider} from "@blueprintjs/core";
import {AssetsProvider} from "./utils/AssetsProvider.ts";
// import Split from "react-split";
// import {InspectorStackComponent} from 'uiconfig-blueprint/lib/esm/lib'


// console.log(InspectorStackComponent, Split)

function App() {
    return (
        <BlueprintProvider>
        <VisualStyleProvider>
        <DialogProvider>
        <ProjectProvider>
        <AssetsProvider>
        <ManagerProvider>
            <>
                <ThreeEditorComponent />
                <WelcomeScreenDialog/>
                <DialogComponent/>
            </>
        </ManagerProvider>
        </AssetsProvider>
        </ProjectProvider>
        </DialogProvider>
        </VisualStyleProvider>
        </BlueprintProvider>
    )
}

export default App
