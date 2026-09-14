import {useEffect, useMemo, useState} from 'react'
import {createPortal} from 'react-dom'
import {ConfigObject} from 'uiconfig-blueprint/lib/esm/lib'
import {getOrCall, type ThreeViewer, type UiObjectConfig} from 'threepipe'
import {editorModesInspectorConfig} from './EditorModes.tsx'
import {SceneOverrideMaterialMenu} from './SceneOverrideMaterialMenu.tsx'
import type {OverrideLightingType, OverrideMaterialType} from '../utils/three/LightMaterialOverrider.ts'
import {Button} from '@blueprintjs/core'
import {clearLibraryDropChoices} from '../utils/libraryDropChoices.ts'
import {Kite3dThemeSettingsMenu} from '../adapters/Kite3dToolbarControls.tsx'
import {useManagerVersion} from '../utils/UseManager.ts'

export function EditorSettingsPopover({viewer}: {viewer: ThreeViewer}) {
    const manager = useManagerVersion()
    const fullscreenRoot = viewer.container.parentElement
    const [previewMaterial, setPreviewMaterial] = useState<OverrideMaterialType | null>(null)
    const [previewLighting, setPreviewLighting] = useState<OverrideLightingType | null>(null)
    const [fullscreen, setFullscreen] = useState(document.fullscreenElement === fullscreenRoot)
    const viewerSections = useMemo(() => (viewer.uiConfig.children || []).flatMap((child) => {
        const config = getOrCall(child) as UiObjectConfig | undefined
        return config && (config.label === 'Rendering' || config.label === 'Timeline')
            ? [{...config, expanded: true}]
            : []
    }), [viewer])
    const importConfig = useMemo(() => editorModesInspectorConfig.import(viewer), [viewer])
    const exportConfig = useMemo(() => editorModesInspectorConfig.export(viewer), [viewer])
    const extrasConfig = useMemo(() => editorModesInspectorConfig.extras(viewer), [viewer])
    const buffersConfig = useMemo(() => editorModesInspectorConfig.buffers(viewer), [viewer])
    const panelActions = {
        openPanel: () => undefined,
        closePanel: () => undefined,
    }

    useEffect(() => {
        const onFullscreenChange = () => setFullscreen(document.fullscreenElement === fullscreenRoot)
        document.addEventListener('fullscreenchange', onFullscreenChange)
        return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
    }, [fullscreenRoot])

    const toggleFullscreen = async () => {
        if (document.fullscreenElement) await document.exitFullscreen()
        else await fullscreenRoot?.requestFullscreen()
    }

    const toolbar = <div className={`kite3d-settings-toolbar${fullscreen ? ' kite3d-settings-toolbar-fullscreen' : ''}`}>
        <Button
            data-testid="fullscreen"
            icon={fullscreen ? 'minimize' : 'maximize'}
            onClick={() => void toggleFullscreen()}
            text={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        />
        <Kite3dThemeSettingsMenu/>
    </div>

    return <><div className="kite3d-editor-settings" data-testid="editor-settings-popover">
        <h2>Editor settings</h2>
        <div className="kite3d-editor-settings-scroll" data-testid="editor-settings-scroll">
            {!fullscreen && toolbar}
            {viewerSections.map((config, index) => <ConfigObject
                {...panelActions}
                config={config}
                key={config.uuid || `${config.label}-${index}`}/>) }
            <section className="kite3d-settings-modes">
                <h3>Modes</h3>
                <div className="kite3d-settings-mode">
                    <h4>Import</h4>
                    <ConfigObject {...panelActions} config={importConfig} isPanel={true}/>
                </div>
                <div className="kite3d-settings-mode">
                    <h4>Preview</h4>
                    <SceneOverrideMaterialMenu
                        currentLighting={previewLighting}
                        currentMaterial={previewMaterial}
                        setCurrentLighting={setPreviewLighting}
                        setCurrentMaterial={setPreviewMaterial}/>
                </div>
                <div className="kite3d-settings-mode kite3d-drop-prompt-settings">
                    <h4>Library drops</h4>
                    <Button
                        data-testid="reset-drop-prompts"
                        icon="reset"
                        onClick={clearLibraryDropChoices}
                        text="Reset drop prompts"
                    />
                </div>
                <details className="kite3d-settings-mode" open>
                    <summary><h4>Export</h4></summary>
                    <div className="kite3d-export-actions">
                        <Button
                            data-testid="download-scene"
                            icon="download"
                            onClick={() => void manager.exportGltf()}
                            text="Download scene"
                        />
                        <Button
                            data-testid="snapshot"
                            icon="camera"
                            onClick={() => void manager.snapshot()}
                            text="Snapshot"
                        />
                    </div>
                    <ConfigObject {...panelActions} config={exportConfig} isPanel={true}/>
                </details>
                <details className="kite3d-settings-mode">
                    <summary><h4>Extras</h4></summary>
                    <ConfigObject {...panelActions} config={extrasConfig} isPanel={true}/>
                </details>
                <details className="kite3d-settings-mode">
                    <summary><h4>Buffers</h4></summary>
                    <ConfigObject {...panelActions} config={buffersConfig} isPanel={true}/>
                </details>
            </section>
        </div>
    </div>{fullscreen && fullscreenRoot && createPortal(toolbar, fullscreenRoot)}</>
}
