import {ThreeEditorComponent} from './components/ThreeEditorComponent.tsx'
import {ManagerProvider, ProjectProvider} from './utils/ViewerInstanceManager.ts'
import {AppToasterOverlay, DialogComponent, DialogProvider, VisualStyleProvider} from 'uiconfig-blueprint/lib/esm/lib'
import {WelcomeScreenDialog} from './components/WelcomeScreenDialog.tsx'
import {BlueprintProvider} from "@blueprintjs/core";
import {AssetsProvider} from "./utils/AssetsProvider.ts";
import {ContextMenuProvider} from "./components/ContextMenuProvider.tsx";
// import Split from "react-split";
// import {InspectorStackComponent} from 'uiconfig-blueprint/lib/esm/lib'


// console.log(InspectorStackComponent, Split)

function App() {
    return (
        <BlueprintProvider>
        <VisualStyleProvider>
        <DialogProvider>
        <ProjectProvider>
        <ManagerProvider>
        <AssetsProvider>
        <ContextMenuProvider>
            <>
                <ThreeEditorComponent />
                <WelcomeScreenDialog/>
                <DialogComponent/>
                <AppToasterOverlay/>
            </>
        </ContextMenuProvider>
        </AssetsProvider>
        </ManagerProvider>
        </ProjectProvider>
        </DialogProvider>
        </VisualStyleProvider>
        </BlueprintProvider>
    )
}

export default App
