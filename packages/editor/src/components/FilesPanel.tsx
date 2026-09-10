import type {FC, ReactNode} from 'react'
import {
    Button,
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
import type {FileManifestEntry} from '../utils/AssetsProvider.ts'

/** The dev-server manifest replaces the upstream directory-handle browser. */
export function FilesPanel({onSelectFile}: {onSelectFile?(): void}) {
    const manager = useManagerVersion()
    const warnings = manager.unlistedScripts()
    return <div className="files-panel editor-panel-body">
        {warnings.map(({path}) => <Callout
            key={path}
            data-testid="unlisted-script-warning"
            intent={Intent.WARNING}
            icon="warning-sign"
            compact
        >{path} is not listed in package.json blitz.scripts or blitz.plugins and will not be registered.</Callout>)}
        <ul data-testid="project-files" className="file-list">
            {manager.manifest.filter(({path}) => !isPrivateBlitzFile(path)).map(({path}) => <li key={path}>
                <Button
                    alignText="left"
                    fill
                    minimal
                    small
                    active={manager.selectedFilePath === path}
                    icon="document"
                    text={path}
                    onClick={() => {
                        manager.selectFile(path)
                        onSelectFile?.()
                    }}
                />
            </li>)}
        </ul>
    </div>
}

function isPrivateBlitzFile(path: string): boolean {
    return path === '.blitz/deploys.json' || path === '.blitz/dev.json'
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

export const FileButton: FC<ButtonProps & {fileEntry: FileManifestEntry | {
    icon?: string | IconName | MaybeElement
    path: string
}}> = ({fileEntry, ...props}) => {
    const icon = 'icon' in fileEntry ? fileEntry.icon : undefined
    return <Button
        className="file-item-button"
        icon={typeof icon === 'string' ? <img src={icon} alt=""/> : icon || <Icon icon="document"/>}
        text={<span className="file-item-button-text">{fileEntry.path.replace(/\/$/, '').split('/').pop()}</span>}
        title={fileEntry.path}
        variant="minimal"
        alignText="center"
        {...props}
    />
}
