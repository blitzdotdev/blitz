import {ThreeEditorComponent} from './components/ThreeEditorComponent.tsx'
import {AppToasterOverlay, DialogComponent, DialogProvider, VisualStyleProvider} from 'uiconfig-blueprint/lib/esm/lib'
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
import {ViewerInstanceManager} from "./utils/ViewerInstanceManager.ts";
import {LoadedProject} from "./utils/project.ts";

// console.log(InspectorStackComponent, Split)

function App({manager, project}: { manager: ViewerInstanceManager, project: LoadedProject }) {
    return (
        <QueryClientProvider client={queryClient}>
        <BlueprintProvider>
        <VisualStyleProvider>
        <DialogProvider>
        <ProjectProvider project={project}>
        <ManagerProvider manager={manager}>
        <AssetsProvider>
        <ContextMenuProvider>
            <>
                <ThreeEditorComponent />
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
