import {useMemo, useState} from 'react'
import {ConfigObject} from 'uiconfig-blueprint/lib/esm/lib'
import {getOrCall, type ThreeViewer, type UiObjectConfig} from 'threepipe'
import {editorModesInspectorConfig} from './EditorModes.tsx'
import {SceneOverrideMaterialMenu} from './SceneOverrideMaterialMenu.tsx'
import type {OverrideLightingType, OverrideMaterialType} from '../utils/three/LightMaterialOverrider.ts'
import {Button} from '@blueprintjs/core'
import {clearLibraryDropChoices} from '../utils/libraryDropChoices.ts'

export function EditorSettingsPopover({viewer}: {viewer: ThreeViewer}) {
    const [previewMaterial, setPreviewMaterial] = useState<OverrideMaterialType | null>(null)
    const [previewLighting, setPreviewLighting] = useState<OverrideLightingType | null>(null)
    const viewerSections = useMemo(() => (viewer.uiConfig.children || []).flatMap((child) => {
        const config = getOrCall(child) as UiObjectConfig | undefined
        return config && (config.label === 'Rendering' || config.label === 'Timeline')
            ? [{...config, expanded: true}]
            : []
    }), [viewer])
    const importConfig = useMemo(() => editorModesInspectorConfig.import(viewer), [viewer])
    const panelActions = {
        openPanel: () => undefined,
        closePanel: () => undefined,
    }

    return <div className="kite3d-editor-settings" data-testid="editor-settings-popover">
        <h2>Editor settings</h2>
        <div className="kite3d-editor-settings-scroll" data-testid="editor-settings-scroll">
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
            </section>
        </div>
    </div>
}
