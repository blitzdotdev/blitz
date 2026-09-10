import type {FC, ReactNode} from 'react'
import {useState} from 'react'
import {
    Breadcrumbs,
    Button,
    ButtonGroup,
    Callout,
    Icon,
    Intent,
    MenuItem,
    Slider,
    type ButtonProps,
    type IconName,
    type MaybeElement,
} from '@blueprintjs/core'
import {useManagerVersion} from '../utils/UseManager.ts'
import {useAssets, type FileManifestEntry} from '../utils/AssetsProvider.ts'
import {PopupMenuButton} from './PopupMenuButton.tsx'

/** AGREED-4: the reference file grid reads the flat DevServerSource manifest. */
export function FilesPanelBreadCrumbs() {
    const manager = useManagerVersion()
    return <Breadcrumbs
        items={[{text: manager.project?.name || 'No Project', current: true, icon: 'root-folder'}]}
        className="files-panel-breadcrumbs"
        minVisibleItems={1}
    />
}

export function FilesPanelGrid() {
    const manager = useManagerVersion()
    const {fileManifest, selectedFiles, setSelectedFiles} = useAssets()
    const files = fileManifest.filter(({path}) => !isPrivateBlitzFile(path))
    return <ButtonGroup className="file-item-button-group" data-testid="project-files">
        {files.map((file) => <FileButton
            key={file.path}
            fileEntry={file}
            aria-label={file.path}
            active={selectedFiles[0]?.path === file.path}
            onClick={() => {
                setSelectedFiles([file])
                manager.selectFile(file.path)
            }}/>) }
    </ButtonGroup>
}

export function SliderMenuItem({thumbSize, setThumbSize, icon = 'rect-width'}: {
    thumbSize: number
    icon?: IconName | MaybeElement
    setThumbSize(size: number): void
}) {
    return <MenuItem
        icon={icon}
        text={<div style={{width: '50px'}}><Slider
            value={thumbSize}
            stepSize={1}
            min={16}
            max={256}
            onChange={setThumbSize}
            labelRenderer={false}
        /></div>}
        roleStructure="menuitem"
    />
}

export function PanelHeader({children}: {children: ReactNode}) {
    return <div className="files-panel-header">{children}</div>
}

export function FilesPanel() {
    const manager = useManagerVersion()
    const warnings = manager.unlistedScripts()
    const [thumbSize, setThumbSize] = useState(32)
    if (!manager.loadedProject) return null
    return <div style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        // @ts-ignore custom property used by the reference stylesheet
        '--file-item-button-size': `${thumbSize}px`,
    }}>
        {warnings.map(({path}) => <Callout
            key={path}
            data-testid="unlisted-script-warning"
            intent={Intent.WARNING}
            icon="warning-sign"
            compact
        >{path} is not listed in package.json blitz.scripts or blitz.plugins and will not be registered.</Callout>)}
        <PanelHeader>
            <FilesPanelBreadCrumbs/>
            <div style={{flexGrow: 1}}/>
            <PopupMenuButton icon="cog" text="">
                <SliderMenuItem setThumbSize={setThumbSize} thumbSize={thumbSize}/>
            </PopupMenuButton>
        </PanelHeader>
        <div className="files-panel-grid">
            <FilesPanelGrid/>
        </div>
    </div>
}

export const FileButton: FC<ButtonProps & {fileEntry: FileManifestEntry | {
    icon?: string | IconName | MaybeElement
    path: string
    name?: string
}}> = ({fileEntry, ...props}) => {
    const iconValue = 'icon' in fileEntry ? fileEntry.icon : undefined
    const icon = iconValue
        ? typeof iconValue === 'string' ? <img src={iconValue} className="bp5-icon" alt=""/> : iconValue
        : <Icon style={{padding: '5px'}} icon={fileIcon(fileEntry.path)}/>
    return <Button
        className="file-item-button"
        icon={icon}
        text={<span className="file-item-button-text">
            {'name' in fileEntry && fileEntry.name
                ? fileEntry.name
                : fileEntry.path.replace(/\/$/, '').split('/').pop()}
        </span>}
        title={fileEntry.path}
        variant="minimal"
        alignText="center"
        {...props}
    />
}

function fileIcon(path: string): IconName {
    const name = path.split('/').pop() || path
    if (name === 'package.json') return 'box'
    if (name.endsWith('.scene.gltf') || name.endsWith('.scene.glb')) return 'cubes'
    if (/\.(png|jpe?g|webp|gif|exr|hdr|ktx2?)$/i.test(name)) return 'media'
    if (/\.(glb|gltf|fbx|obj|stl|3dm)$/i.test(name)) return 'cube'
    if (/\.(js|mjs|cjs|ts|tsx|jsx)$/i.test(name)) return 'code'
    if (/\.jsonc?$/i.test(name)) return 'document-code'
    return 'document'
}

function isPrivateBlitzFile(path: string): boolean {
    return path === '.blitz/deploys.json' || path === '.blitz/dev.json'
}
