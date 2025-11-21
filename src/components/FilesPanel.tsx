import {isLoadableFile, thumbPath, useManager, useProject} from "../utils/ViewerInstanceManager.ts";
import type {BreadcrumbProps} from "@blueprintjs/core/src/components/breadcrumbs/breadcrumb.tsx";
import {
    Breadcrumbs,
    Button,
    ButtonGroup,
    ButtonProps,
    Icon,
    IconName,
    MaybeElement,
    MenuItem,
    Slider, Tab, Tabs
} from "@blueprintjs/core";
import React, {FC, useEffect, useRef, useState} from "react";
import {useProjectActions} from "../utils/projectActions.tsx";
import {useObjContextMenu} from "./UseObjContextMenu.tsx";
import {MenuItem2, MenuItemAction} from "./ContextMenuUtils.tsx";
import {FileManifestEntry, getFileByPath, manifestEntryToFile, useAssets} from "../utils/AssetsProvider.ts";
import {useSaveBeforeClose} from "./UseSaveFile.tsx";
import {useDialogPrompt, useLoadingState} from "uiconfig-blueprint/lib/esm/lib";
import {IObject3D, PhysicalMaterial, PickingPlugin, ThreeSerialization, TypeSystem, UnlitMaterial} from "threepipe";
import {ErrorRes, showSuccessErrorToast} from "../utils/Toaster.tsx";
import {fileToIcon} from "../utils/icons.tsx";
import {CanvasFileDropHandler} from "../utils/CanvasFileDropHandler.ts";
import {PopupMenuButton} from "./PopupMenuButton.tsx";
import {CannonMaterial2, CannonPhysicsPlugin} from "../plugins/cannon/CannonPhysicsPlugin.ts";
import {assetUrlPrefix} from "../utils/project.ts";
import {TypedClass} from "threepipe";

export function FilesPanelBreadCrumbs({}: {}){
    const {project} = useProject()
    const {currentPath, setCurrentPath} = useAssets()
    const items: BreadcrumbProps[] = []
    items.push({text: project?.path.replace(/\/$/, '') ?? 'No Project', current: currentPath === '/', icon: 'root-folder', onClick: (e)=>{
            e.preventDefault()
            setCurrentPath('/')
        }})
    if(currentPath !== '/') {
        const parts = currentPath.split('/').filter(p=>p.length)
        let path = ''
        parts.forEach((p, i)=>{
            const path1 = path + '/' + p
            path = path1
            items.push({text: p, current: i === parts.length - 1, icon: 'folder-close', onClick: (e)=>{
                e.preventDefault()
                setCurrentPath(path1)
            }})
        })
    }
    return <Breadcrumbs
        // items={[
        //     { text: "All files" },
        //     { text: "Users" },
        //     { text: "Janet" },
        //     { text: "Photos" },
        //     { text: "Wednesday" },
        //     { current: true, text: "image.jpg" },
        // ]}
        items={items}
        className={"files-panel-breadcrumbs"}
        minVisibleItems={1}
    />
}

const menuItemsEmpty: MenuItem2[] = [{
    action: 'createEmptyScene',
    key: 'createEmptyScene',
    tags: ['dirHandle'],
    props: {text: 'New Scene', icon: 'cube-add'},
},{
    action: 'createEmptyAssetGlb',
    key: 'createEmptyAssetGlb',
    tags: ['dirHandle'],
    props: {text: 'New Asset (GLB)', icon: 'package'},
},{
    action: 'createEmptyPMat',
    key: 'createEmptyPMat',
    tags: ['dirHandle'],
    props: {text: 'New Physical Material', icon: 'style'},
},{
    action: 'createEmptyBMat',
    key: 'createEmptyBMat',
    tags: ['dirHandle'],
    props: {text: 'New Unlit Material', icon: 'style'},
},{
    action: 'createPluginJs',
    key: 'createPluginJs',
    tags: ['dirHandle'],
    props: {text: 'New Plugin (JS)', icon: 'document-code'},
},{
    action: 'createScriptJs',
    key: 'createScriptJs',
    tags: ['dirHandle'],
    props: {text: 'New Script (JS)', icon: 'document-code'},
},{
    // action: 'createTypedObject',
    key: 'createTypedObject',
    tags: ['dirHandle'],
    props: {text: 'New JSON Object', icon: 'code-block'},
},{
    action: 'createEmptyFolder',
    key: 'createEmptyFolder',
    tags: ['dirHandle'],
    props: {text: 'New Folder', icon: 'folder-new'},
},{
    action: 'refreshFiles',
    key: 'refreshFiles',
    props: {text: 'Refresh', icon: 'refresh'},
}]
const menuItemsFiles: MenuItem2[] = [{
    action: 'importFileGlb',
    key: 'importFileGlb',
    tags: ['ext-.glb', '!ext-.scene.glb'/*, 'ext-.mat'*/], // todo incase of mat import and apply to a box
    props: {text: 'Import in Scene', icon: 'document-open'},
},/*,{
    action: 'revealInSystem',
    key: 'revealInSystem',
    props: {text: 'Reveal in System File Explorer', icon: 'folder-shared'},
}*/]

export function FilesPanelGrid({}: {
}){
    const {selectedFiles, setSelectedFiles, currentPath, setCurrentPath, fileManifest, refreshManifest }= useAssets()

    const {project} = useProject()
    const {saveProjectFile} = useProjectActions()
    const manager = useManager()

    const {saveBeforeClose} = useSaveBeforeClose()

    const {loadingState, updateLoading} = useLoadingState()

    const loadFile = async (f: FileManifestEntry | string)=>{
        if(!manager.loadedProjectFile) return // todo loading another file
        if(project !== manager.loadedProject || !project) return // another or no project loaded. todo error?
        const g = async (force = false)=>{
            const fi = typeof f !== 'string' ? await manifestEntryToFile(f) : null
            const r = await manager.getLoadedFile(project, typeof f === 'string' ? f : f.path, fi || undefined)
            if(r){
                const res = await manager.loadProjectFile(r, force).catch(e=>{
                    return {error: e?.message ?? 'Unknown error'}
                })
                const r2 = showSuccessErrorToast(res ? `Loaded ${project.path}${r.path} successfully` : 'Unknown Error', 'Unable to load file', res as ErrorRes)
            }else {
                // directory or something
            }
        }
        if(manager.loadedNeedsSave) {
            // const v = manager.get()
            // const yes= await v.dialog.confirm('You have unsaved changes. Are you sure you want to open a new file and lose those changes?')
            const res = await saveBeforeClose()
            if(res) {
                // save and load
                const saved = await saveProjectFile()
                if(!saved){
                    // save failed or cancelled
                    return
                }
                await g()
            }else if(res === false) {
                // don't save, just load, which will unload current file
                await g(true)
            }else {
                // cancelled
                return
            }
        }else{
            await g()
        }
    }

    let items = fileManifest
    const path = currentPath.replace(/^\//, '')
    let dirHandle = !path ? project?.handle : undefined
    if(path){
        const parts = path.split('/')
        for(const part of parts){
            const next = items.find(f=>f.path.endsWith(part) && f.type === 'directory')
            dirHandle = next?.handle as FileSystemDirectoryHandle | undefined
            if(!next) break
            items = next.children || []
        }
    }
    items = items?.filter(f=>
        !f.handle.name.startsWith('.')
    ) || []
    items = items.sort((a, b)=>{
        if(a.type === b.type) return a.path.localeCompare(b.path)
        if(a.type === 'directory') return -1
        return 1
    })

    const {prompt, close, open} = useDialogPrompt()

    const whileExistsPrompt = async ({callback, isDir, suffix, ...props}: {
        title: string,
        message: string,
        submitButtonText?: string,
        closeButtonText?: string,
        helperText?: string,
        placeholder?: string,
        value?: string,
        isDir: boolean,
        callback: (r: string)=>Promise<void>
        suffix?: string,
    })=>{
        if(!dirHandle || !project?.handle) return
        while(true) {
            let res = await prompt({
                ...props
            })
            if (!res) return
            res = res + (suffix||'')
            // check if file exists
            const exists = await dirHandle.getFileHandle(res, {create: false}).catch(e => {
                if(e.name === "NotFoundError") return null
                if(e.name === "TypeMismatchError") return true
                throw e
            })
            if (exists) {
                await prompt({
                    title: 'Error',
                    message: 'A file with that name already exists',
                    showInput: false,
                    submitButtonText: 'OK',
                    canClose: false,
                })
                continue
            }else{
                return callback(res)
                // create file
                // const content = new ArrayBuffer(0) // empty file. todo default content based on file type
                // await manager.writeFile(project.handle, currentPath + '/' + res, new File([content], res), project.path).catch(e=>{
                //     console.error('Error creating file:', e)
                // })
            }
        }

    }
    const createFile = async (name: string, content?: string | ArrayBuffer)=>{
        if(!dirHandle || !project?.handle) return
        // create file
        const path = currentPath === '/' ? name : (currentPath + '/' + name)
        content = content ?? new ArrayBuffer(0) // empty file. todo default content based on file type

        await manager.writeFile(project.handle, path, new File([content], name), project.path).catch(e=>{
            console.error('Error creating file:', e)
        })
        refreshManifest(true).then(r=>{
            const f = getFileByPath(path, r||[])
            f && setSelectedFiles([f])
        })
    }
    const createFolder = async (name: string)=>{
        if(!dirHandle || !project?.handle) return
        const path = currentPath === '/' ? name : (currentPath + '/' + name)
        // create folder
        await dirHandle.getDirectoryHandle(name, {create: true}).catch(e=>{
            console.error('Error creating folder:', e)
        })
        refreshManifest(true).then(r=>{
            const f = getFileByPath(path, r||[])
            f && setSelectedFiles([f])
        })
    }
    const actions: Record<string, MenuItemAction> = {
        createEmptyScene: async ()=>{
            if(!dirHandle || !project?.handle) return
            await whileExistsPrompt({
                title: 'Create New Scene',
                message: 'Enter the name of the new scene',
                placeholder: 'MyScene',
                value: 'NewScene',
                helperText: 'The .scene.glb extension will be added automatically',
                submitButtonText: 'Create',
                closeButtonText: 'Cancel',
                isDir: false,
                suffix: '.scene.glb',
                callback: createFile,
            })
        },
        createEmptyAssetGlb: async ()=>{
            if(!dirHandle || !project?.handle) return
            await whileExistsPrompt({
                title: 'Create New Asset',
                message: 'Enter the name of the new 3D Model asset',
                placeholder: 'MyAsset',
                value: 'NewAsset',
                helperText: 'The .asset.glb extension will be added automatically',
                submitButtonText: 'Create',
                closeButtonText: 'Cancel',
                isDir: false,
                suffix: '.asset.glb',
                callback: createFile,
            })
        },
        createEmptyAssetPMat: async ()=>{
            if(!dirHandle || !project?.handle) return
            await whileExistsPrompt({
                title: 'Create New Physical Material',
                message: 'Enter the name of the new material',
                placeholder: 'MyMaterial',
                value: 'MyMaterial',
                helperText: 'The .asset.mat extension will be added automatically',
                submitButtonText: 'Create',
                closeButtonText: 'Cancel',
                isDir: false,
                suffix: '.asset.mat',
                callback: (n)=>{
                    const mat = new PhysicalMaterial()
                    mat.name = n.replace('.asset.mat', '')
                    return createFile(n, JSON.stringify(mat.toJSON(), null, 2))
                },
            })
        },
        createEmptyAssetBMat: async ()=>{
            if(!dirHandle || !project?.handle) return
            await whileExistsPrompt({
                title: 'Create New Unlit Material',
                message: 'Enter the name of the new material',
                placeholder: 'MyMaterial',
                value: 'MyMaterial',
                helperText: 'The .asset.mat extension will be added automatically',
                submitButtonText: 'Create',
                closeButtonText: 'Cancel',
                isDir: false,
                suffix: '.asset.mat',
                callback: (n)=>{
                    const mat = new UnlitMaterial()
                    mat.name = n.replace('.asset.mat', '')
                    return createFile(n, JSON.stringify(mat.toJSON(), null, 2))
                },
            })
        },
        createPluginJs: async ()=>{
            if(!dirHandle || !project?.handle) return
            await whileExistsPrompt({
                title: 'Create New Plugin',
                message: 'Enter the name of the new file',
                placeholder: 'MyPlugin',
                value: 'NewPlugin',
                helperText: 'The .plugin.js extension will be added automatically',
                submitButtonText: 'Create',
                closeButtonText: 'Cancel',
                isDir: false,
                suffix: '.plugin.js',
                callback: (n)=>{
                    const def = `` // todo sample plugin
                    return createFile(n, def.trim())
                },
            })
        },
        createScriptJs: async ()=>{
            if(!dirHandle || !project?.handle) return
            await whileExistsPrompt({
                title: 'Create New Script',
                message: 'Enter the name of the new file',
                placeholder: 'MyScript',
                value: 'NewScript',
                helperText: 'The .script.js extension will be added automatically',
                submitButtonText: 'Create',
                closeButtonText: 'Cancel',
                isDir: false,
                suffix: '.script.js',
                callback: (n)=>{
                    const def = `
import {Object3DComponent} from 'threepipe'
/**
 * Sample component that simulates a basic rigid body with forces, impulses, and velocity
 */
export class MyComponent extends Object3DComponent {
    static StateProperties = ['running', 'radius', 'timeScale']
    static ComponentType = 'MyComponent'

    running = true

    radius = 2

    timeScale = 1


    update({time}) {
        if (!this.running) return
        if (!this.object) return
        this.object.position.x = Math.cos(time * this.timeScale / 1000) * this.radius
        this.object.position.z = Math.sin(time * this.timeScale / 1000) * this.radius
        return true // to set viewer dirty
    }
    
    // @uiButton() // only in ts
    ToggleRunning = () => {
        this.running = !this.running
    }
    
    uiConfig = {
        type: 'folder',
        label: 'MyComponent',
        children: [{
            type: 'button',
            label: 'Toggle Running',
            onClick: this.ToggleRunning,
        }],
    }
}
                    ` // todo sample script
                    return createFile(n, def.trim())
                }
            })
        },
        createTypedObject: async (def: TypedClass)=>{
            if(!dirHandle || !project?.handle) return
            console.log(def)
            await whileExistsPrompt({
                title: 'Create New File',
                message: 'Enter the name of the new file',
                placeholder: 'MyFile',
                value: 'MyFile',
                helperText: 'The .json extension will be added automatically',
                submitButtonText: 'Create',
                closeButtonText: 'Cancel',
                isDir: false,
                suffix: '.json',
                callback: (n)=>{
                    const object = new def.ctor()
                    if(def.setName) def.setName(object, n.replace('.json', ''))
                    const json = ThreeSerialization.Serialize(object)
                    return createFile(n, JSON.stringify(json, null, 2))
                }
            })
        },
        createEmptyFolder: ()=>{
            if(!dirHandle || !project?.handle) return
            return whileExistsPrompt({
                title: 'Create New Folder',
                message: 'Enter the name of the new folder',
                placeholder: 'MyFolder',
                value: 'NewFolder',
                helperText: '',
                submitButtonText: 'Create',
                closeButtonText: 'Cancel',
                isDir: true,
                callback: createFolder,
            })
        },
        refreshFiles: ()=>{
            refreshManifest()
        },
        importFileGlb: async (data: { file: FileManifestEntry })=>{
            if(!project) return {error: 'No project loaded'}
            if(!manager.loadedScene && !(manager.loadedAssetObj as IObject3D)?.isObject3D){
                return { error: 'No scene/asset loaded to import the model into'}
            }
            const obj = await manager.loadAssetObjectClone(data.file, project)
            if(!obj?.isObject3D){
                return { error: 'Failed to load asset, invalid file or not an object'}
            }

            // todo show popup for add options and use the settings
            const addObjectOptions = {
                autoScale: true,
                autoScaleRadius: 2,
                autoCenter: true,
                // indexInParent
            }
            if(manager.loadedAssetObj){
                const root = manager.loadedAssetObj as IObject3D
                root.add(obj)
            }else {
                manager.get().scene.addObject(obj)
            }
        },
    }
    const {handleContextMenu} = useObjContextMenu(actions)

    let menuItemsEmpty1 = menuItemsEmpty
    let menuItemsFiles1 = menuItemsFiles
    if(!dirHandle) {
        menuItemsEmpty1 = menuItemsEmpty1.filter(f => !f.tags || !f.tags.includes('dirHandle'))
        menuItemsFiles1 = menuItemsFiles1.filter(f => !f.tags || !f.tags.includes('dirHandle'))
    }

    const dragger = manager.get().getPlugin(CanvasFileDropHandler)

    // clear dragged on unmount
    useEffect(() => {
        return () => {
            dragger?.handleDragEnd()
        };
    }, [dragger]);

    const selectedFilesRef = useRef<FileManifestEntry[]>([])
    useEffect(() => {
        selectedFilesRef.current = selectedFiles
    }, [selectedFiles])
    const openFile = (f: FileManifestEntry, newTab: boolean) => {
        if (f.type === 'directory') {
            setCurrentPath(f.path)
            setSelectedFiles([])
        } else {
            const allowedTypes = ['.scene.glb', '.glb', '.mat', /*'.glb', '.mat.json', '.js', '.ts'*/]
            if (allowedTypes.some(ext => f.path.endsWith(ext))) {
                // todo check type of file and open it if possible
                // check for needssave
                if (newTab) {
                    // todo
                    // window.open(window.location.pathname + '?project=' + encodeURIComponent(f.path) + (project?.path ? '&base=' + encodeURIComponent(project.path) : ''), '_blank')
                    return
                }
                updateLoading(f.path, loadFile(f))
            }
        }
    }
    const selectFiles = async (files: FileManifestEntry[], e: React.MouseEvent|React.KeyboardEvent)=>{
        selectedFilesRef.current = files
        setSelectedFiles(files)
        if(files.length === 1){
            const f = files[0]
            if(f.path === 'package.json') return
            if(f.path === 'kite.json') return
            if(f.path === (project?.assets ?? 'assets.json')) return
            if(!isLoadableFile(f.path)) return
            let cancelled = false
            const picking  = manager.get().getPlugin(PickingPlugin)
            const cancel = ()=>{ // cancel selection if something else is selected/unselected
                cancelled = true
                picking?.removeEventListener('selectedObjectChanged', cancel)
            }
            picking?.addEventListener('selectedObjectChanged', cancel)
            const fileAsset = await manager.getAssetFromEntry(f)
            // console.log(fileAsset)
            if(fileAsset && !cancelled && picking &&
                selectedFilesRef.current.length === 1 && selectedFilesRef.current[0] === f &&
                picking.getSelectedObject() !== fileAsset
            ){
                picking.setSelectedObject(fileAsset)
            }
            cancel()
        }
    }

    return <ButtonGroup
        className="file-item-button-group"
        onContextMenu={e=>{
            e.preventDefault()
            e.stopPropagation()

            const c = menuItemsEmpty1.find(mi=>mi.key === 'createTypedObject')
            if(c) c.children = [...TypeSystem.Classes.values()].map(def=>{
                return {
                    action: 'createTypedObject',
                    key: def.key,
                    data: def,
                    props: {text: def.getLabel?.()||def.ctor.name, icon: def.getIcon?.()||'code-block'},
                }
            })

            handleContextMenu(e, menuItemsEmpty1, null)
        }}
        onClick={e=>{
            e.preventDefault()
            e.stopPropagation()
            console.log('click out')
            setSelectedFiles([])
        }}
        onKeyDown={(e)=>{
            if(e.key === 'Escape'){
                setSelectedFiles([])
            }
            if(e.key === 'Enter' && selectedFiles.length === 1) {
                e.preventDefault()
                e.stopPropagation()
                const f = selectedFiles[0]
                const newTab = e.metaKey || e.ctrlKey
                openFile(f, newTab);
            }
            if(e.key === 'ArrowRight' || e.key === 'ArrowLeft'){
                e.preventDefault()
                e.stopPropagation()
                const f = selectedFiles[0]
                const idx = f ? items.indexOf(f) : -1
                if(idx < 0) return
                let idx2 = idx + (e.key === 'ArrowRight' ? 1 : -1)
                if(idx2 < 0) idx2 = 0
                if(idx2 >= items.length) idx2 = items.length - 1
                const f2 = items[idx2]
                selectFiles([f2], e)
            }
            // todo arrow keys to traverse up down
        }}
    >
        {items.map(f=>{
            const selected = selectedFiles.includes(f)
            return <FileButton
                fileEntry={f}
                key={f.path}
                active={selected}
                draggable={dragger?.canDragFile(f)}
                onDragStart={(e) => dragger?.handleDragStart(e, f)}
                onDragEnd={dragger?.handleDragEnd}
                loading={loadingState[f.path]}
                onContextMenu={(e)=>{
                    e.preventDefault()
                    e.stopPropagation()
                    let menuItemsFiles2 = menuItemsFiles1.filter(mi=>!mi.tags ||
                        mi.tags.some(t=>{
                            if(t.startsWith('ext-')) {
                                const ext1 = t.replace('ext-', '')
                                return f.path.endsWith(ext1)
                            }
                            return false
                        }) &&
                        !mi.tags.some(t=>{
                            if(t.startsWith('!ext-')) {
                                const ext1 = t.replace('!ext-', '')
                                return f.path.endsWith(ext1)
                            }
                            return false
                        }))

                    handleContextMenu(e, menuItemsFiles2.map(i=>({...i, data: {file: f}})), f)
                }}
                onDoubleClick={(e)=>{
                    e.preventDefault()
                    e.stopPropagation()
                    const newTab = e.metaKey || e.ctrlKey
                    openFile(f, newTab);
                }}
                onClick={(e)=>{
                    // if(f.type === 'directory') setCurrentPath(f.path)
                    e.preventDefault()
                    e.stopPropagation()
                    selectFiles([f], e)
                }}
                // loading={loadingState[project.path]}
                // onClick={() => updateLoading(project.path, loadProject(project))}
                // onClick={() => updateLoading('create-new', actions.createFile())}
            />
        })}
    </ButtonGroup>
}

export function SliderMenuItem({thumbSize, setThumbSize, icon = "rect-width"}: {
    thumbSize: number,
    icon?: IconName | MaybeElement,
    setThumbSize: (size: number)=>void,
}){
    return <MenuItem
        icon={icon}
        text={<div style={{
            width: '50px',
        }}>
            <Slider
                value={thumbSize}
                stepSize={1}
                min={16}
                max={256}
                onChange={setThumbSize}
                labelRenderer={false}
            />
        </div>}
        // intent={intent}
        // labelElement={"⌘,"}
        roleStructure="menuitem"
    />
}

export function PanelHeader({children}: {
    children: React.ReactNode
}){
    return <div style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: '10px',
        // justifyContent: 'space-between',
        borderBottom: '1px solid var(--bp5-border-color)',
        height: 'calc(var(--pt-grid-size) * 3)',
        // position: "absolute",
        // top: "-10px",
        // zIndex: 100,
        // right: 0,
    }}>
        {children}
    </div>
}

export function FilesPanel({}: {
}){
    // const {project} = useProject()
    const manager = useManager()
    const {refreshManifest} = useAssets()

    // console.log(fileManifest)
    useEffect(()=>{
        refreshManifest()
    }, [refreshManifest]) // refreshManifest changes on project change

    // todo use FileSystemObserver also?
    useEffect(() => {
        const onChange = () => {
            if (document.visibilityState === "visible") {
                refreshManifest().catch((e)=>{
                    console.error('Error refreshing file manifest:', e)
                });
            }
        };

        // document.addEventListener("visibilitychange", onChange);
        window.addEventListener("focus", onChange);
        return () => {
            // document.removeEventListener("visibilitychange", onChange);
            window.removeEventListener("focus", onChange);
        };
    }, [refreshManifest]);

    const [thumbSize, setThumbSize] = useState(32);

    return !manager.loadedProject ? null : <div style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        // @ts-ignore
        '--file-item-button-size': `${thumbSize}px`,
    }}>
        <PanelHeader>
            <FilesPanelBreadCrumbs/>
            <div style={{flexGrow: 1}}></div>
            <PopupMenuButton icon={"cog"} text={""}>
                <SliderMenuItem setThumbSize={setThumbSize} thumbSize={thumbSize}/>
            </PopupMenuButton>
        </PanelHeader>
        <div className={"files-panel-grid"}>
            <FilesPanelGrid/>
        </div>
        </div>
}

export type TExternalFile = Omit<FileManifestEntry, 'handle'|'isFSEntry'|'children'>&{children: TExternalFile[]}
const externalFiles: TExternalFile[] = [{
    name: '3D Models',
    path: 'models-3d/',
    type: 'directory',
    children: [{
        name: 'Iridescent Dish With Olives',
        path: 'https://threejs.org/examples/models/gltf/IridescentDishWithOlives.glb',
        type: 'file',
        children: [],
    }],
}, {
    name: 'Materials',
    path: 'materials/',
    type: 'directory',
    children: [],
}, {
    name: 'Environment Maps',
    path: 'env-maps/',
    type: 'directory',
    children: [],
}, {
    name: 'Textures',
    path: 'textures/',
    type: 'directory',
    children: [],
},
]

export function ExternalFilesGrid({group}: {
    group: TExternalFile
}){
    const manager = useManager()
    const dragger = manager.get().getPlugin(CanvasFileDropHandler)

    // clear dragged on unmount
    useEffect(() => {
        return () => {
            dragger?.handleDragEnd()
        };
    }, [dragger]);

    const items = group.children || []
    const onClick = (f: TExternalFile, e: React.MouseEvent)=>{

    }


    return <div className={"files-panel-grid"}>
        <ButtonGroup
            className="file-item-button-group"
        >
            {items.map(f=>{
                return <FileButton
                    fileEntry={f}
                    key={f.path}
                    disabled={f.type === 'directory'}
                    onClick={(e)=>onClick(f, e)}
                    draggable={dragger?.canDragFile(f)}
                    onDragStart={(e) => dragger?.handleDragStart(e, {path: f.path, isFSEntry: false})}
                    onDragEnd={dragger?.handleDragEnd}
                />
            })}
        </ButtonGroup>
    </div>
}

export function ExternalFilesPanel({}: {
}){
    // const {project} = useProject()
    const manager = useManager()

    const files = externalFiles
    // const {refreshManifest} = useExternalAssets()
    //
    // // console.log(fileManifest)
    // useEffect(()=>{
    //     refreshManifest()
    // }, [refreshManifest]) // refreshManifest changes on project change

    const [thumbSize, setThumbSize] = useState(32);

    return !manager.loadedProject ? null : <div style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        // @ts-ignore
        '--file-item-button-size': `${thumbSize}px`,
    }}>
        {/*<PanelHeader>*/}
        {/*    /!*<FilesPanelBreadCrumbs/>*!/*/}
        {/*    <div style={{flexGrow: 1}}></div>*/}
        {/*</PanelHeader>*/}
        <PopupMenuButton icon={"cog"} text={""} style={{
            position: 'absolute',
            right: 0, top: 0,
            zIndex: 1,
        }}>
            <SliderMenuItem setThumbSize={setThumbSize} thumbSize={thumbSize}/>
        </PopupMenuButton>
        <Tabs
            animate={false}
            renderActiveTabPanelOnly={true}
            size={"medium"}
            vertical={false}
            defaultSelectedTabId={"a"}
            // style={{zIndex: 0}}
        >
            {files.map((f, i)=><Tab key={f.path} id={f.path} title={f.name} panel={<ExternalFilesGrid group={f}/>}/>)}
        </Tabs>

        <div className={"files-panel-grid"}>
        </div>
    </div>
}

export const FileButton: FC<ButtonProps & {fileEntry: {
    path: string,
}}> = ({fileEntry, ...props}) => {
    // const {loadingState, updateLoading} = useLoadingState()

    const {fileManifest} = useAssets()
    const iconFile = getFileByPath(thumbPath(fileEntry.path), fileManifest)
    // const iconFileBlob = useMemo(()=>{
    //     if(!iconFile || (iconFile.handle as FileSystemFileHandle).kind !== 'file') return null
    //     return (iconFile.handle as FileSystemFileHandle).getFile().catch(e=>{
    //         console.error('Error loading icon file:', e)
    //         return null
    //     })
    // }, [iconFile])
    const [iconUrl, setIconUrl] = useState<string>()
    useEffect(()=>{
        if(!iconFile || (iconFile.handle as FileSystemFileHandle).kind !== 'file') {
            setIconUrl(undefined)
            return
        }
        let cancelled = false
        let url: string | undefined
        ;(iconFile.handle as FileSystemFileHandle).getFile().then(f=>{
            if(cancelled) return
            url = URL.createObjectURL(f)
            setIconUrl(url)
        }).catch(e=>{
            console.error('Error loading icon file:', e)
        })
        return ()=>{
            cancelled = true
            if(url) URL.revokeObjectURL(url)
        } // revoke on change or unmount
    }, [iconFile])

    const icon = fileToIcon(fileEntry);

    return <Button
        className={"file-item-button"}
        key={fileEntry.path}
        // icon={<img src={typeof f.preview=== 'string' ? project.preview : URL.createObjectURL(f.preview as File)}/>}
        icon={iconUrl ? <img src={iconUrl} className={"bp5-icon"}/> : <Icon style={{padding: "5px"}} icon={icon}/>}
        text={<span className={"file-item-button-text"}>
            {fileEntry.path.replace(/\/$/, '').split('/').pop()}
        </span>}
        title={fileEntry.path}
        variant={"minimal"}
        alignText={'center'}
        // loading={loadingState[f.path]}
        {...props}
    />
}
