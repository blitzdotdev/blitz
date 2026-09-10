import {ThreeEditorComponent} from './components/ThreeEditorComponent.tsx'
import {AppToasterOverlay, DialogComponent, DialogProvider, VisualStyleProvider} from 'uiconfig-blueprint/lib/esm/lib'
import {WelcomeScreenDialog} from './components/WelcomeScreenDialog.tsx'
import {BlueprintProvider} from "@blueprintjs/core";
import {AssetsProvider} from "./utils/AssetsProvider.ts";
import {ContextMenuProvider} from "./components/ContextMenuProvider.tsx";
import {ProjectProvider} from "./utils/UseProject.ts";
import {ManagerProvider} from "./utils/UseManager.ts";
// import Split from "react-split";
// import {InspectorStackComponent} from 'uiconfig-blueprint/lib/esm/lib'
import {
    QueryClient,
    QueryClientProvider,
    useQuery,
} from '@tanstack/react-query'
import {queryClient} from "./tsdb/client.ts";

// console.log(InspectorStackComponent, Split)

function App() {
    return (
        <QueryClientProvider client={queryClient}>
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
        </QueryClientProvider>
    )
}

export default App
