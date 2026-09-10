import {Button, Icon, InputGroup} from '@blueprintjs/core'
import {FolderHeadCard} from 'uiconfig-blueprint/lib/esm/lib'
import {InsSectionItem} from '../components/InsSectionItem.tsx'
import {useManagerVersion} from '../utils/UseManager.ts'

export function ScriptsSectionComp() {
    const manager = useManagerVersion()
    return <FolderHeadCard open label="Scripts" minimal level={0} onClick={() => undefined} icon="stacked-chart">
        {(manager.project?.config.scripts || []).map((script, index) => <InsSectionItem
            key={`${script.import}:${index}`}
            icon="package"
            text={script.import}
            buttons={[{key: 'remove', text: 'Remove Script', icon: 'trash', intent: 'warning'}]}/>) }
        <div className="blitz-reference-add-row">
            <span><Icon size={12} icon="code"/> Add Script</span>
            <Button variant="minimal" disabled title="Add Script" icon={<Icon size={12} icon="plus"/>}/>
        </div>
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
        <div className="blitz-reference-add-row">
            <span><Icon size={12} icon="document-code"/> Add Plugin</span>
            <Button variant="minimal" disabled title="Add Plugin" icon={<Icon size={12} icon="plus"/>}/>
        </div>
    </FolderHeadCard>
}

export function DependenciesSectionComp() {
    const manager = useManagerVersion()
    const dependencies = Object.entries(manager.project?.packageJson.dependencies || {})
    return <FolderHeadCard open label="Dependencies" minimal level={0} onClick={() => undefined} icon="cube">
        {dependencies.map(([name, version]) => <InsSectionItem
            key={name}
            icon="package"
            text={`${name}@${version}`}
            buttons={[{key: 'remove', text: 'Remove Dependency', icon: 'trash', intent: 'warning'}]}/>) }
        <div className="blitz-reference-dependency-fields">
            <InputGroup placeholder="Package (e.g., three)"/>
            <InputGroup placeholder="Version (optional, e.g., 0.150.0)"/>
            <InputGroup placeholder="URL (optional, uses esm.sh by default)"/>
            <Button disabled fill icon="plus" text="Add Dependency"/>
        </div>
        <ul className="blitz-semantic-hook" data-testid="component-types">
            {manager.componentTypes.map((type) => <li key={type}>{type}</li>)}
        </ul>
    </FolderHeadCard>
}
