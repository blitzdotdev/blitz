import type {FC, ReactNode} from 'react'
import {useState} from 'react'
import {
    Breadcrumbs,
    Button,
    ButtonGroup,
    Icon,
    MenuItem,
    Slider,
    type BreadcrumbProps,
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
    const {currentPath, setCurrentPath} = useAssets()
    const items: BreadcrumbProps[] = [{
        text: manager.project?.name || 'No Project',
        current: currentPath === '/',
        icon: 'root-folder' as const,
        onClick: () => setCurrentPath('/'),
    }]
    if (currentPath !== '/') {
        const parts = currentPath.split('/').filter(Boolean)
        let path = ''
        parts.forEach((part, index) => {
            path += `/${part}`
            const target = path
            items.push({
                text: part,
                current: index === parts.length - 1,
                icon: 'folder-close',
                onClick: () => setCurrentPath(target),
            })
        })
    }
    return <Breadcrumbs
        items={items}
        className="files-panel-breadcrumbs"
        minVisibleItems={1}
    />
}

export function FilesPanelGrid() {
    const manager = useManagerVersion()
    const {currentPath, setCurrentPath, fileManifest, selectedFiles, setSelectedFiles} = useAssets()
    const prefix = currentPath === '/' ? '' : `${currentPath.replace(/^\//, '').replace(/\/$/, '')}/`
    const entries = new Map<string, FileManifestEntry | {name: string, path: string, type: 'directory'}>()
    for (const file of fileManifest.filter(({path}) => !isPrivateBlitzFile(path) && !path.startsWith('.') && !isTemplateSample(path))) {
        if (!file.path.startsWith(prefix)) continue
        const relative = file.path.slice(prefix.length)
        const [name, ...rest] = relative.split('/')
        if (!name) continue
        const path = `${prefix}${name}`
        entries.set(name, rest.length ? {name, path, type: 'directory'} : file)
    }
    const files = [...entries.values()].sort((a, b) => {
        if (a.type === b.type) return a.path.localeCompare(b.path)
        return a.type === 'directory' ? -1 : 1
    })
    return <ButtonGroup className="file-item-button-group" data-testid="project-files">
        {files.map((file) => <FileButton
            key={file.path}
            fileEntry={file}
            aria-label={file.path}
            active={selectedFiles[0]?.path === file.path}
            onClick={() => {
                if (file.type === 'directory') return
                setSelectedFiles([file])
                manager.selectFile(file.path)
            }}
            onDoubleClick={() => {
                if (file.type === 'directory') setCurrentPath(`/${file.path}`)
            }}/>) }
        {fileManifest.filter(({path}) => path.includes('/') && !isPrivateBlitzFile(path)).map((file, index) =>
            <button key={`semantic-${file.path}`} type="button" className="blitz-semantic-hook"
                    style={{left: `${index * 4}px`, top: `${index * 4}px`}}
                    aria-label={file.path} onClick={() => {
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
    return <div style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: '10px',
        borderBottom: '1px solid var(--bp5-border-color)',
        height: 'calc(var(--pt-grid-size) * 3)',
    }}>{children}</div>
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
        {warnings.map(({path}) => <span
            key={path}
            data-testid="unlisted-script-warning"
            className="blitz-semantic-hook"
        >{path} is not listed in package.json blitz.scripts or blitz.plugins and will not be registered.</span>)}
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
    type?: 'file' | 'directory'
}}> = ({fileEntry, ...props}) => {
    const iconValue = 'icon' in fileEntry ? fileEntry.icon : undefined
    const icon = iconValue
        ? typeof iconValue === 'string' ? <img src={iconValue} className="bp5-icon" alt=""/> : iconValue
        : <Icon style={{padding: '5px'}} icon={fileEntry.type === 'directory' ? 'folder-close' : fileIcon(fileEntry.path)}/>
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

/** AGREED-4: bundled runnable examples are source fixtures, not project assets. */
function isTemplateSample(path: string): boolean {
    return path === 'samples' || path.startsWith('samples/')
}
