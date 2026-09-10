import {useState} from 'react'
import {Button, Icon, InputGroup} from '@blueprintjs/core'
import {FolderHeadCard} from 'uiconfig-blueprint/lib/esm/lib'
import {InsSectionItem} from '../components/InsSectionItem.tsx'
import {RefSelectionObjectComponent} from '../components/RefSelectionObjectComponent.tsx'
import type {SelectFileRef} from '../utils/projectUtils.ts'
import {useManagerVersion} from '../utils/UseManager.ts'

function AddSourceControl({label, type}: {label: 'Add Script' | 'Add Plugin', type: 'script' | 'plugin'}) {
    const [selected, setSelected] = useState<SelectFileRef | null>(null)
    return <RefSelectionObjectComponent
        label={label}
        objectType={type}
        object={selected}
        disabled={false}
        allowNone={true}
        onChange={(value) => setSelected(value as SelectFileRef | null)}
    >
        <Button variant="minimal" title={label} icon={<Icon size={12} icon="plus"/>} disabled={!selected}/>
    </RefSelectionObjectComponent>
}

export function ScriptsSectionComp() {
    const manager = useManagerVersion()
    const configured = manager.project?.config.scripts.map(({import: path}) => path) || []
    // AGREED-4: the vendored editor runtime replaces the reference package import,
    // but it occupies the same project-settings row.
    const scripts = ['threepipe', ...configured.filter((path) => path !== 'threepipe')]
    return <FolderHeadCard open label="Scripts" minimal level={0} onClick={() => undefined} icon="stacked-chart">
        {scripts.map((path) => <InsSectionItem
            key={path}
            icon="package"
            text={path}
            buttons={[{key: 'remove', text: 'Remove Script', icon: 'trash', intent: 'warning'}]}/>) }
        <AddSourceControl label="Add Script" type="script"/>
    </FolderHeadCard>
}

export function PluginsSectionComp() {
    const manager = useManagerVersion()
    return <FolderHeadCard open label="Plugins" minimal level={0} onClick={() => undefined} icon="stacked-chart">
        {(manager.project?.config.plugins || []).map((plugin, index) => <InsSectionItem
            key={`${plugin.import}:${plugin.className || ''}:${index}`}
            text={plugin.className || plugin.import}
            info={plugin.className ? {text: plugin.import, icon: 'package'} : undefined}
            buttons={[{key: 'remove', text: 'Remove Plugin', icon: 'trash', intent: 'warning'}]}/>) }
        <AddSourceControl label="Add Plugin" type="plugin"/>
    </FolderHeadCard>
}

export function DependenciesSectionComp() {
    const manager = useManagerVersion()
    const configured = manager.project?.config.dependencies || []
    const dependencies = [
        {key: 'threepipe', version: '0.5.1'},
        ...configured.filter(({key}) => key !== 'threepipe' && key !== '@kite3d/mcp-bridge'),
    ]
    return <FolderHeadCard open label="Dependencies" minimal level={0} onClick={() => undefined} icon="cube">
        {dependencies.map((dependency) => <InsSectionItem
            key={dependency.key}
            icon="package"
            text={`${dependency.key}@${dependency.version}`}
            info={dependency.url ? {text: dependency.url, icon: 'link'} : undefined}
            buttons={[{key: 'remove', text: 'Remove Dependency', icon: 'trash', intent: 'warning'}]}/>) }
        <div style={{padding: '4px 8px', display: 'flex', flexDirection: 'column', gap: '4px'}}>
            <InputGroup placeholder="Package (e.g., three)"/>
            <InputGroup placeholder="Version (optional, e.g., 0.150.0)"/>
            <InputGroup placeholder="URL (optional, uses esm.sh by default)"/>
            <Button variant="outlined" disabled text="Add Dependency" icon={<Icon size={12} icon="plus"/>}/>
        </div>
        <ul className="blitz-semantic-hook" data-testid="component-types">
            {manager.componentTypes.map((type) => <li key={type}>{type}</li>)}
        </ul>
    </FolderHeadCard>
}
