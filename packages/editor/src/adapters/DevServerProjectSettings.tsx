import {Button} from '@blueprintjs/core'
import {useAssets} from '../utils/AssetsProvider.ts'
import {useManagerVersion} from '../utils/UseManager.ts'
import type {ProjectLoadStatus} from '../utils/ViewerInstanceManager.ts'

export function ScriptsSectionComp() {
    const manager = useManagerVersion()
    const scripts = manager.project?.config.scripts || []
    return <ProjectSection label="Scripts" count={scripts.length} action={<OpenPackageJsonButton/>}>
        {scripts.length === 0 && <EmptyRow text="No scripts configured"/>}
        {scripts.map(({import: path, active}) => <ProjectRow
            detail={path}
            key={path}
            name={scriptName(path)}
            status={manager.scriptLoadStatuses.get(path) || (active === false
                ? {kind: 'disabled', text: 'Disabled'}
                : {kind: 'loaded', text: 'Loading'})}/>) }
    </ProjectSection>
}

export function PluginsSectionComp() {
    const manager = useManagerVersion()
    const plugins = manager.project?.config.plugins || []
    const dependencies = manager.project?.config.dependencies || []
    return <ProjectSection label="Plugins" count={plugins.length}>
        {plugins.length === 0 && <EmptyRow text="No plugins configured"/>}
        {plugins.map((plugin, index) => {
            const dependency = dependencies.find(({key}) => key === plugin.import)
            const detail = plugin.className
                ? plugin.import
                : dependency?.version || plugin.import
            const key = `${plugin.import}:${plugin.className || ''}:${index}`
            return <ProjectRow
                detail={detail}
                key={key}
                name={plugin.className || plugin.import}
                status={manager.pluginLoadStatuses.get(key) || (plugin.active === false
                    ? {kind: 'disabled', text: 'Disabled'}
                    : {kind: 'resolved', text: 'Loading'})}/>
        })}
    </ProjectSection>
}

export function DependenciesSectionComp() {
    const manager = useManagerVersion()
    const dependencies = manager.project?.config.dependencies || []
    const rawDevDependencies = manager.project?.packageJson.devDependencies
    const devDependencies = rawDevDependencies && typeof rawDevDependencies === 'object' && !Array.isArray(rawDevDependencies)
        ? Object.entries(rawDevDependencies).flatMap(([key, version]) => (
            typeof version === 'string' ? [{key, version}] : []
        ))
        : []
    const count = dependencies.length + devDependencies.length
    return <ProjectSection label="Dependencies" count={count}>
        {count === 0 && <EmptyRow text="No dependencies configured"/>}
        {dependencies.map((dependency) => <ProjectRow
            detail={dependency.url || dependency.version}
            key={dependency.key}
            name={dependency.key}
            status={{
                kind: exactVersion(dependency.version) ? 'loaded' : 'disabled',
                text: exactVersion(dependency.version) ? 'Pinned' : 'Range',
            }}/>) }
        {devDependencies.map((dependency) => <ProjectRow
            detail={dependency.version}
            key={`dev:${dependency.key}`}
            name={dependency.key}
            note="dev"
            status={{
                kind: exactVersion(dependency.version) ? 'loaded' : 'disabled',
                text: exactVersion(dependency.version) ? 'Pinned' : 'Range',
            }}/>) }
        <ul className="kite3d-semantic-hook" data-testid="component-types">
            {manager.componentTypes.map((type) => <li key={type}>{type}</li>)}
        </ul>
    </ProjectSection>
}

function ProjectSection({action, children, count, label}: {
    action?: React.ReactNode
    children: React.ReactNode
    count: number
    label: string
}) {
    return <section className="kite3d-panel-section kite3d-project-section">
        <header className="kite3d-section-header">
            <h3>{label} <span>{count}</span></h3>
            {action}
        </header>
        <div className="kite3d-project-list">{children}</div>
    </section>
}

function ProjectRow({detail, name, note, status}: {
    detail: string
    name: string
    note?: string
    status: ProjectLoadStatus
}) {
    const tone = status.kind === 'error'
        ? 'is-danger'
        : status.kind === 'loaded' || status.kind === 'resolved'
            ? 'is-success'
            : 'is-muted'
    return <div className="kite3d-project-row">
        <div>
            <span className="kite3d-project-name">
                <strong>{name}</strong>
                {note && <small>{note}</small>}
            </span>
            <code>{detail}</code>
        </div>
        <span className={`kite3d-status-chip ${tone}`} title={status.text}>{status.text}</span>
    </div>
}

function EmptyRow({text}: {text: string}) {
    return <div className="kite3d-project-empty">{text}</div>
}

function OpenPackageJsonButton() {
    const manager = useManagerVersion()
    const {fileManifest, setSelectedFiles} = useAssets()
    const packageFile = fileManifest.find(({path}) => path === 'package.json')
    if (!packageFile) return null
    return <Button minimal={true} onClick={() => {
        setSelectedFiles([packageFile])
        manager.selectFile(packageFile.path)
    }} text="Open package.json"/>
}

function scriptName(path: string) {
    const filename = path.split('/').pop() || path
    return filename.replace(/\.script\.[cm]?[jt]sx?$/i, '').replace(/\.[cm]?[jt]sx?$/i, '')
}

function exactVersion(version: string) {
    return /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version.trim())
}
