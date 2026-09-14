import {useEffect, useMemo, useState} from 'react'
import {BlueprintProvider, Button, Navbar} from '@blueprintjs/core'
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
import {WelcomeProvider} from './utils/UseWelcome.ts'
import {ContextMenuProvider} from './components/ContextMenuProvider.tsx'
import {QueryClientProvider} from '@tanstack/react-query'
import {queryClient} from './tsdb/client.ts'
import {LibraryDropDialog} from './components/LibraryDropDialog.tsx'
import {HubClientProvider} from './hubClient.tsx'
import {WelcomeScreenDialog} from './components/WelcomeScreenDialog.tsx'

export default function App() {
    const sourceResult = useMemo(() => {
        try {
            return {source: new DevServerSource()}
        } catch (error) {
            return {error: error instanceof Error ? error.message : String(error)}
        }
    }, [])
    const [serverMode, setServerMode] = useState<'loading' | 'hub' | 'project' | 'error'>('loading')

    useEffect(() => {
        if (!sourceResult.source) return
        void sourceResult.source.state().then((state) => {
            setServerMode(state.hub === true ? 'hub' : 'project')
        }).catch(() => setServerMode('error'))
    }, [sourceResult])

    if (!sourceResult.source) {
        return <main className="no-project" role="alert">
            No Kite3D project is being served. Run <code>kite3d init</code>, then <code>kite3d dev</code>.
            {sourceResult.error && <span className="no-project-detail"> {sourceResult.error}</span>}
        </main>
    }

    if (serverMode === 'loading') return null
    if (serverMode === 'error') return <main className="no-project" role="alert">
        This Kite3D editor link is no longer authorized. Run <code>kite3d open</code> again.
    </main>

    const source = sourceResult.source
    if (serverMode === 'hub') return <QueryClientProvider client={queryClient}>
        <BlueprintProvider>
        <VisualStyleProvider>
            <DialogProvider>
                <WelcomeProvider>
                    <HubClientProvider>
                        <HubEditorApp/>
                    </HubClientProvider>
                </WelcomeProvider>
                <DialogComponent/>
                <AppToasterOverlay/>
            </DialogProvider>
        </VisualStyleProvider>
        </BlueprintProvider>
    </QueryClientProvider>

    return <QueryClientProvider client={queryClient}>
        <BlueprintProvider>
        <VisualStyleProvider>
            <DialogProvider>
                <ManagerProvider source={source}>
                    <WelcomeProvider>
                        <HubClientProvider>
                            <AssetsProvider>
                                <ContextMenuProvider>
                                    <EditorApp source={source}/>
                                </ContextMenuProvider>
                            </AssetsProvider>
                        </HubClientProvider>
                    </WelcomeProvider>
                </ManagerProvider>
            </DialogProvider>
        </VisualStyleProvider>
        </BlueprintProvider>
    </QueryClientProvider>
}

function HubEditorApp() {
    return <>
        <Navbar>
            <Navbar.Group>
                <img className="main-nav-logo" src="/logo.svg" alt=""/>
                <Navbar.Heading>Kite 3D</Navbar.Heading>
            </Navbar.Group>
            <Navbar.Group align="right">
                <Button aria-label="Settings" icon="cog" size="small" variant="minimal"/>
            </Navbar.Group>
        </Navbar>
        <WelcomeScreenDialog hubMode={true}/>
    </>
}

function EditorApp({source}: {source: DevServerSource}) {
    const manager = useManagerVersion()
    const [publishDialogOpen, setPublishDialogOpen] = useState(false)
    return <>
        <ThreeEditorComponent onOpenGame={() => setPublishDialogOpen(true)}/>
        <WelcomeScreenDialog hubMode={false}/>
        <PublishDialog
            isOpen={publishDialogOpen}
            name={manager.loadedProject?.name || 'Kite3D game'}
            source={source}
            beforePublish={() => manager.beforePublish()}
            onClose={() => setPublishDialogOpen(false)}
        />
        <DialogComponent/>
        <LibraryDropDialog/>
        <AppToasterOverlay/>
    </>
}
