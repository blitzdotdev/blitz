import type {FC, ReactNode} from 'react'
import {useState} from 'react'
import {
    Breadcrumbs,
    Button,
    ButtonGroup,
    Icon,
    Intent,
    MenuItem,
    Slider,
    type BreadcrumbProps,
    type ButtonProps,
    type IconName,
    type MaybeElement,
} from '@blueprintjs/core'
import {AppToaster, useDialogPrompt} from 'uiconfig-blueprint/lib/esm/lib'
import {useManagerVersion} from '../utils/UseManager.ts'
import {useAssets, type FileManifestEntry} from '../utils/AssetsProvider.ts'
import type {ProjectEntryKind} from '../utils/ViewerInstanceManager.ts'
import type {MenuItem2, MenuItemAction} from '../utils/ContextMenuUtils.ts'
import {thumbPath} from '../utils/projectUtils.ts'
import {PopupMenuButton} from './PopupMenuButton.tsx'
import {useObjContextMenu} from './UseObjContextMenu.tsx'

const emptyMenuItems: MenuItem2[] = [
    {action: 'scene', key: 'scene', props: {text: 'New Scene', icon: 'cube-add'}},
    {action: 'asset', key: 'asset', props: {text: 'New Asset (GLB)', icon: 'package'}},
    {action: 'physical-material', key: 'physical-material', props: {text: 'New Physical Material', icon: 'style'}},
    {action: 'unlit-material', key: 'unlit-material', props: {text: 'New Unlit Material', icon: 'style'}},
    {action: 'plugin', key: 'plugin', props: {text: 'New Plugin (JS)', icon: 'document-code'}},
    {action: 'script', key: 'script', props: {text: 'New Script (JS)', icon: 'document-code'}},
    {action: 'json', key: 'json', props: {text: 'New JSON Object', icon: 'code-block'}},
    {action: 'folder', key: 'folder', props: {text: 'New Folder', icon: 'folder-new'}},
    {action: 'refresh', key: 'refresh', props: {text: 'Refresh', icon: 'refresh'}},
]

const createOptions: Record<ProjectEntryKind, {
    title: string
    message: string
    value: string
    suffix: string
}> = {
    scene: {title: 'Create New Scene', message: 'Enter the name of the new scene', value: 'NewScene', suffix: '.scene.gltf'},
    asset: {title: 'Create New Asset', message: 'Enter the name of the new 3D model asset', value: 'NewAsset', suffix: '.asset.glb'},
    'physical-material': {title: 'Create New Physical Material', message: 'Enter the name of the new material', value: 'PhysicalMaterial', suffix: '.asset.mat'},
    'unlit-material': {title: 'Create New Unlit Material', message: 'Enter the name of the new material', value: 'UnlitMaterial', suffix: '.asset.mat'},
    plugin: {title: 'Create New Plugin', message: 'Enter the name of the new plugin', value: 'NewPlugin', suffix: '.plugin.js'},
    script: {title: 'Create New Script', message: 'Enter the name of the new script', value: 'NewScript', suffix: '.script.js'},
    json: {title: 'Create New JSON Object', message: 'Enter the name of the new JSON object', value: 'NewObject', suffix: '.json'},
    folder: {title: 'Create New Folder', message: 'Enter the name of the new folder', value: 'NewFolder', suffix: ''},
}

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
    for (const file of fileManifest.filter(({path}) => !isPrivateKite3dFile(path) && !path.startsWith('.') && !isTemplateSample(path))) {
        if (!file.path.startsWith(prefix)) continue
        const relative = file.path.slice(prefix.length)
        const [name, ...rest] = relative.split('/')
        if (!name) continue
        const path = `${prefix}${name}`
        entries.set(name, rest.length ? {name, path, type: 'directory'} : file)
    }
    for (const directory of manager.directoryManifest) {
        if (!directory.startsWith(prefix) || directory.startsWith('.') || isTemplateSample(directory)) continue
        const relative = directory.slice(prefix.length)
        const name = relative.split('/')[0]
        if (name) entries.set(name, {name, path: `${prefix}${name}`, type: 'directory'})
    }
    const files = [...entries.values()].sort((a, b) => {
        if (a.type === b.type) return a.path.localeCompare(b.path)
        return a.type === 'directory' ? -1 : 1
    })
    const [gridSelectionPath, setGridSelectionPath] = useState<string | null>(selectedFiles[0]?.path || null)
    const {prompt, close} = useDialogPrompt()
    const saveBeforeClose = () => new Promise<boolean | null>((resolve) => {
        let resolved = false
        const choose = (value: boolean | null) => {
            resolved = true
            close()
            resolve(value)
        }
        void prompt({
            canClose: false,
            title: 'Save File',
            message: 'You have unsaved changes. Do you want to save before opening another file?',
            showInput: false,
            actions: <>
                <Button onClick={() => choose(null)}>Cancel</Button>
                <Button intent={Intent.DANGER} onClick={() => choose(false)}>Discard</Button>
                <Button intent={Intent.SUCCESS} onClick={() => choose(true)}>Save</Button>
            </>,
        }).finally(() => {
            if (!resolved) resolve(null)
        })
    })
    const prepareToOpen = async () => {
        if (!manager.loadedNeedsSave) return true
        const choice = await saveBeforeClose()
        if (choice === null) return false
        if (choice && !await manager.saveScene()) return false
        return true
    }
    const openFile = async (file: FileManifestEntry) => {
        if (!await prepareToOpen()) return
        try {
            await manager.openProjectFile(file.path)
        } catch (error) {
            AppToaster().show({message: errorMessage(error), intent: 'danger', icon: 'error', timeout: 4000, isCloseButtonShown: true})
        }
    }
    const create = async (kind: ProjectEntryKind) => {
        const option = createOptions[kind]
        const value = await prompt({
            title: option.title,
            message: option.message,
            placeholder: option.value,
            value: option.value,
            helperText: option.suffix ? `The ${option.suffix} extension will be added automatically` : undefined,
            submitButtonText: 'Create',
            closeButtonText: 'Cancel',
            onSubmit: async (input) => validateEntryName(input, option.suffix, prefix, manager),
        })
        if (!value) return
        const path = `${prefix}${value.trim()}${option.suffix}`
        try {
            await manager.createProjectEntry(path, kind)
            const entry = manager.manifest.find((file) => file.path === path)
            if (entry) {
                const selected = {...entry, name: entry.path.split('/').pop() || entry.path, type: 'file' as const, isFSEntry: true as const}
                setSelectedFiles([selected])
                manager.selectFile(path)
            }
            AppToaster().show({message: `Created ${path}.`, intent: 'success', icon: 'tick', timeout: 2500})
        } catch (error) {
            AppToaster().show({message: errorMessage(error), intent: 'danger', icon: 'error', timeout: 4000, isCloseButtonShown: true})
        }
    }
    const actions: Record<string, MenuItemAction> = Object.fromEntries([
        ...Object.keys(createOptions).map((kind) => [kind, () => create(kind as ProjectEntryKind)]),
        ['refresh', async () => {
            await manager.refreshProjectFiles()
            AppToaster().show({message: 'Files refreshed.', intent: 'success', icon: 'refresh', timeout: 2500})
        }],
        ['open', async (data: {file: FileManifestEntry}) => openFile(data.file)],
        ['import', async (data: {file: FileManifestEntry}) => {
            try {
                await manager.importProjectAsset(data.file.path)
            } catch (error) {
                return {error: errorMessage(error)}
            }
        }],
        ['set-main', async (data: {file: FileManifestEntry}) => {
            const current = manager.project?.mainScene || manager.scenePath
            const confirmed = await prompt({
                title: 'Set main scene',
                message: current === data.file.path
                    ? `${data.file.path} is already the main scene. Load it again?`
                    : `Change the main scene from ${current} to ${data.file.path} and load it?`,
                showInput: false,
                value: 'yes',
                submitButtonText: current === data.file.path ? 'Load scene' : 'Set main scene',
                closeButtonText: 'Cancel',
            })
            if (!confirmed || !await prepareToOpen()) return
            try {
                await manager.setMainScene(data.file.path)
            } catch (error) {
                return {error: errorMessage(error)}
            }
        }],
    ])
    const {handleContextMenu} = useObjContextMenu(actions)
    const selectGridEntry = (file: typeof files[number]) => {
        setGridSelectionPath(file.path)
        if (file.type === 'directory') {
            setSelectedFiles([])
            return
        }
        setSelectedFiles([file])
        manager.selectFile(file.path)
    }
    const showEmptyMenu = (event: React.MouseEvent<HTMLElement>) => {
        event.preventDefault()
        event.stopPropagation()
        handleContextMenu(event, emptyMenuItems, null)
    }
    return <div
        className="file-item-context-area"
        style={{width: '100%', height: '100%'}}
        onContextMenu={showEmptyMenu}
        onClick={(event) => {
            if ((event.target as HTMLElement).closest('.file-item-button')) return
            setGridSelectionPath(null)
            setSelectedFiles([])
        }}
    ><ButtonGroup
        className="file-item-button-group"
        data-testid="project-files"
        tabIndex={0}
        onKeyDown={(event) => {
            if (event.key === 'Escape') {
                event.preventDefault()
                setGridSelectionPath(null)
                setSelectedFiles([])
                return
            }
            const selectedIndex = files.findIndex((file) => file.path === gridSelectionPath)
            if (event.key === 'Enter' && selectedIndex >= 0) {
                event.preventDefault()
                event.stopPropagation()
                const selected = files[selectedIndex]
                if (selected.type === 'directory') {
                    setCurrentPath(`/${selected.path}`)
                    setGridSelectionPath(null)
                    setSelectedFiles([])
                } else if (isOpenableFile(selected.path)) {
                    void openFile(selected)
                }
                return
            }
            if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && selectedIndex >= 0) {
                event.preventDefault()
                event.stopPropagation()
                const offset = event.key === 'ArrowRight' ? 1 : -1
                const nextIndex = Math.max(0, Math.min(files.length - 1, selectedIndex + offset))
                selectGridEntry(files[nextIndex])
            }
        }}
    >
        {files.map((file) => {
            const thumbnail = file.type === 'file'
                ? fileManifest.find((entry) => entry.path === thumbPath(file.path))
                : undefined
            const fileEntry = thumbnail
                ? {...file, icon: manager.source.fileUrl(thumbnail.path, thumbnail.sha256)}
                : file
            return <FileButton
            key={file.path}
            fileEntry={fileEntry}
            aria-label={file.path}
            active={gridSelectionPath === file.path}
            onContextMenu={(event) => {
                if (file.type === 'directory') return
                event.preventDefault()
                event.stopPropagation()
                const items: MenuItem2[] = []
                if (isOpenableFile(file.path)) items.push({action: 'open', key: 'open', data: {file}, props: {text: 'Open', icon: 'folder-open'}})
                if (/\.(?:glb|gltf)$/i.test(file.path) && !/\.scene\.gltf$/i.test(file.path)) {
                    items.push({action: 'import', key: 'import', data: {file}, props: {text: 'Import in Scene', icon: 'document-open'}})
                }
                if (/\.scene\.gltf$/i.test(file.path)) {
                    items.push({action: 'set-main', key: 'set-main', data: {file}, props: {text: 'Set as main scene', icon: 'home'}})
                }
                handleContextMenu(event, items, file)
            }}
            onClick={() => {
                selectGridEntry(file)
            }}
            onDoubleClick={() => {
                if (file.type === 'directory') {
                    setCurrentPath(`/${file.path}`)
                    setGridSelectionPath(null)
                    setSelectedFiles([])
                } else if (isOpenableFile(file.path)) {
                    void openFile(file)
                }
            }}/>
        })}
        {fileManifest.filter(({path}) => path.includes('/') && !isPrivateKite3dFile(path)).map((file, index) =>
            <button key={`semantic-${file.path}`} type="button" className="kite3d-semantic-hook"
                    style={{left: `${index * 4}px`, top: `${index * 4}px`}}
                    aria-label={file.path} onClick={() => {
                        setSelectedFiles([file])
                        manager.selectFile(file.path)
                    }}/>) }
    </ButtonGroup></div>
}

function validateEntryName(
    input: string,
    suffix: string,
    prefix: string,
    manager: ReturnType<typeof useManagerVersion>,
): true | {error: string} {
    const name = input.trim()
    if (!name) return {error: 'Enter a name.'}
    if (name === '.' || name === '..' || /[\\/]/.test(name)) {
        return {error: 'Names cannot contain path separators.'}
    }
    const path = `${prefix}${name}${suffix}`
    if (manager.manifest.some((entry) => entry.path === path) || manager.directoryManifest.includes(path)) {
        return {error: 'A file or folder with that name already exists.'}
    }
    return true
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function isOpenableFile(path: string): boolean {
    return /(?:\.scene\.gltf|\.asset\.glb|\.glb|\.gltf|\.asset\.mat|\.mat)$/i.test(path)
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
            className="kite3d-semantic-hook"
        >{path} is not listed in package.json kite3d.scripts or kite3d.plugins and will not be registered.</span>)}
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

function isPrivateKite3dFile(path: string): boolean {
    return path === '.kite3d/deploys.json' || path === '.kite3d/dev.json'
}

/** AGREED-4: bundled runnable examples are source fixtures, not project assets. */
function isTemplateSample(path: string): boolean {
    return path === 'samples' || path.startsWith('samples/')
}
