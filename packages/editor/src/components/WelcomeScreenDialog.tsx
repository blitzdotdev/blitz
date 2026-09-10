import {useRef, useState} from 'react'
import {Button, Card, Classes, H3, Intent, Overlay2} from '@blueprintjs/core'
import {useManagerVersion} from '../utils/UseManager.ts'

export function WelcomeScreenDialog() {
    const manager = useManagerVersion()
    const input = useRef<HTMLInputElement>(null)
    const [dragging, setDragging] = useState(false)
    if (!manager.welcomeOpen) return null

    const importFiles = async (files: FileList | null) => {
        if (!files?.length) return
        await manager.importFiles(Array.from(files))
        manager.setWelcomeOpen(false)
    }

    const importUrl = async () => {
        const url = window.prompt('Enter a URL to a 3D file:')
        if (!url) return
        await manager.importUrl(url)
        manager.setWelcomeOpen(false)
    }

    return <Overlay2
        isOpen
        usePortal={false}
        className={Classes.OVERLAY_SCROLL_CONTAINER}
        onClose={() => manager.setWelcomeOpen(false)}
    >
        <Card
            id="welcome-dialog"
            elevation={4}
            className={dragging ? 'welcome-drop-active' : ''}
            onDragEnter={(event) => {
                event.preventDefault()
                setDragging(true)
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
                event.preventDefault()
                setDragging(false)
                void importFiles(event.dataTransfer.files).catch((error) => manager.reportError(error))
            }}
        >
            <div id="welcome-sidebar">
                <div id="welcome-sidebar-logo">
                    <img src="/logo.svg" width={60} height={60} alt="Blitz" className="welcome-screen-logo"/>
                    <div><H3>Blitz</H3><span>Editor</span></div>
                </div>
            </div>
            <div id="welcome-content" className="welcome-import-actions">
                <H3>Import into {manager.project?.name || 'this project'}</H3>
                <p>Drop a 3D file here, choose one from your computer, or import it from a URL.</p>
                <input
                    ref={input}
                    hidden
                    type="file"
                    accept=".gltf,.glb,.obj,.fbx,.ply,.stl,.3dm,.usdz,.zip"
                    multiple
                    onChange={(event) => void importFiles(event.target.files).catch((error) => manager.reportError(error))}
                />
                <Button
                    icon="cube"
                    intent={Intent.PRIMARY}
                    text="Open 3D File"
                    onClick={() => input.current?.click()}
                />
                <Button icon="cloud-download" text="Import from URL" onClick={() => void importUrl().catch((error) => manager.reportError(error))}/>
                <Button minimal text="Close" onClick={() => manager.setWelcomeOpen(false)}/>
            </div>
        </Card>
    </Overlay2>
}
