import {useCallback, useEffect, useState} from 'react'
import {
    Button,
    Classes,
    Menu,
    MenuItem,
    Popover,
} from '@blueprintjs/core'
import {ThemeSettingsMenuComponent} from 'uiconfig-blueprint/lib/esm/lib'
import {useManagerVersion} from '../utils/UseManager.ts'

export function Kite3dSaveSceneButton() {
    const manager = useManagerVersion()
    const [saving, setSaving] = useState(false)
    const save = useCallback(async () => {
        setSaving(true)
        try {
            await manager.saveScene()
        } finally {
            setSaving(false)
        }
    }, [manager])

    useEffect(() => {
        const keydown = (event: KeyboardEvent) => {
            if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return
            event.preventDefault()
            void save()
        }
        window.addEventListener('keydown', keydown)
        return () => window.removeEventListener('keydown', keydown)
    }, [save])

    // AGREED-4: reference Save Scene presentation, backed by DevServerSource.
    return <>
        <Button
            data-testid="save-scene"
            variant="minimal"
            size="small"
            icon="git-repo"
            text="Save Scene"
            loading={saving}
            disabled={!manager.loadedNeedsSave}
            onClick={() => void save()}/>
        <Popover targetProps={{style: {}}}
                 minimal
                 targetTagName="div"
                 content={
                     <Menu className={Classes.ELEVATION_0}>
                         <MenuItem
                             disabled={!manager.loadedNeedsSave || saving}
                             icon="git-repo"
                             label="⌘S"
                             text="Save Scene"
                             onClick={() => void save()}/>
                         <MenuItem text="Save and Close" onClick={() => void save()}/>
                         <MenuItem text="Close Project" onClick={() => undefined}/>
                     </Menu>
                 } placement="bottom">
            <Button icon="caret-down" disabled={saving}
                    variant="minimal" size="small" text=""/>
        </Popover>
    </>
}

export function Kite3dToolbarHooks() {
    const manager = useManagerVersion()
    return manager.error ? <div className="kite3d-project-error" role="alert">{manager.error}</div> : null
}

export function Kite3dThemeSettingsMenu() {
    return <ThemeSettingsMenuComponent/>
}
