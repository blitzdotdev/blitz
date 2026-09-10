import {useMemo, useState} from 'react'
import {BlueprintProvider} from '@blueprintjs/core'
import {
    AppToasterOverlay,
    DialogComponent,
    DialogProvider,
    VisualStyleProvider,
} from 'uiconfig-blueprint/lib/esm/lib'
import {ThreeEditorComponent} from './components/ThreeEditorComponent.tsx'
import {WelcomeScreenDialog} from './components/WelcomeScreenDialog.tsx'
import {DevServerSource} from './DevServerSource.ts'
import {PublishDialog} from './PublishDialog.tsx'
import {ManagerProvider, useManagerVersion} from './utils/UseManager.ts'

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
            No Blitz project is being served. Run <code>blitz init</code>, then <code>blitz dev</code>.
            {sourceResult.error && <span className="no-project-detail"> {sourceResult.error}</span>}
        </main>
    }

    const source = sourceResult.source
    return <BlueprintProvider>
        <VisualStyleProvider>
            <DialogProvider>
                <ManagerProvider source={source}>
                    <EditorApp source={source}/>
                </ManagerProvider>
            </DialogProvider>
        </VisualStyleProvider>
    </BlueprintProvider>
}

function EditorApp({source}: {source: DevServerSource}) {
    const manager = useManagerVersion()
    const [publishDialogOpen, setPublishDialogOpen] = useState(false)
    return <>
        <ThreeEditorComponent onOpenGame={() => setPublishDialogOpen(true)}/>
        <WelcomeScreenDialog/>
        <PublishDialog
            isOpen={publishDialogOpen}
            name={manager.project?.name || 'Blitz game'}
            source={source}
            onClose={() => setPublishDialogOpen(false)}
        />
        <DialogComponent/>
        <AppToasterOverlay/>
    </>
}
