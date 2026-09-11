import {useMemo, useState} from 'react'
import {BlueprintProvider} from '@blueprintjs/core'
import {
    AppToasterOverlay,
    DialogComponent,
    DialogProvider,
    VisualStyleProvider,
} from 'uiconfig-blueprint/lib/esm/lib'
import {ThreeEditorComponent} from './components/ThreeEditorComponent.tsx'
import {DevServerSource} from './DevServerSource.ts'
import {PublishDialog} from './PublishDialog.tsx'
import {ManagerProvider, useManagerVersion} from './utils/UseManager.ts'
import {AssetsProvider} from './utils/AssetsProvider.ts'
import {ProjectProvider} from './utils/UseProject.ts'
import {ContextMenuProvider} from './components/ContextMenuProvider.tsx'
import {DevServerProjectBridge} from './adapters/DevServerProjectBridge.tsx'
import {QueryClientProvider} from '@tanstack/react-query'
import {queryClient} from './tsdb/client.ts'

export default function App() {
    const sourceResult = useMemo(() => {
        try {
            return {source: new DevServerSource()}
        } catch (error) {
            return {error: error instanceof Error ? error.message : String(error)}
        }
    }, [])

    if (!sourceResult.source) {
        return <main className="no-project" role="alert">
            No Kite3D project is being served. Run <code>kite3d init</code>, then <code>kite3d dev</code>.
            {sourceResult.error && <span className="no-project-detail"> {sourceResult.error}</span>}
        </main>
    }

    const source = sourceResult.source
    return <QueryClientProvider client={queryClient}>
        <BlueprintProvider>
        <VisualStyleProvider>
            <DialogProvider>
                <ManagerProvider source={source}>
                    <ProjectProvider>
                        <DevServerProjectBridge>
                            <AssetsProvider>
                                <ContextMenuProvider>
                                    <EditorApp source={source}/>
                                </ContextMenuProvider>
                            </AssetsProvider>
                        </DevServerProjectBridge>
                    </ProjectProvider>
                </ManagerProvider>
            </DialogProvider>
        </VisualStyleProvider>
        </BlueprintProvider>
    </QueryClientProvider>
}

function EditorApp({source}: {source: DevServerSource}) {
    const manager = useManagerVersion()
    const [publishDialogOpen, setPublishDialogOpen] = useState(false)
    return <>
        <ThreeEditorComponent onOpenGame={() => setPublishDialogOpen(true)}/>
        <PublishDialog
            isOpen={publishDialogOpen}
            name={manager.project?.name || 'Kite3D game'}
            source={source}
            beforePublish={() => manager.beforePublish()}
            onClose={() => setPublishDialogOpen(false)}
        />
        <DialogComponent/>
        <AppToasterOverlay/>
    </>
}
