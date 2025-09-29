import {useManager, useProject} from "../utils/ViewerInstanceManager.ts";
import type {BreadcrumbProps} from "@blueprintjs/core/src/components/breadcrumbs/breadcrumb.tsx";
import {Breadcrumbs, Button, ButtonGroup, Icon} from "@blueprintjs/core";
import {useEffect, useMemo, useState} from "react";
import {isPackageProject, useProjectActions} from "../utils/projectActions.tsx";
import {useObjContextMenu} from "./UseObjContextMenu.tsx";
import {MenuItem2} from "./ContextMenuUtils.tsx";
import {directoryToManifest, FileManifestEntry, manifestEntryToFile, useAssets} from "../utils/AssetsProvider.ts";
import {useSaveBeforeClose} from "./UseSaveFile.tsx";
import {useLoadingState} from "uiconfig-blueprint/lib/esm/lib";

export function FilesPanelBreadCrumbs({currentPath, setCurrentPath}: {currentPath: string, setCurrentPath: (v: string)=>void}){
    const {project} = useProject()
    const items: BreadcrumbProps[] = []
    items.push({text: project?.path ?? 'No Project', current: currentPath === '/', icon: 'root-folder', onClick: (e)=>{
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
        minVisibleItems={3}
    />
}

export function FilesPanelGrid({currentPath, setCurrentPath}: {
    currentPath: string, setCurrentPath: (v: string)=>void,
}){
    const {fileManifest} = useAssets()
    let items = fileManifest
    const path = currentPath.replace(/^\//, '')
    if(path){
        const parts = path.split('/')
        for(const part of parts){
            const next = items.find(f=>f.path.endsWith(part) && f.type === 'directory')
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

    const actions = {
        createEmptyScene: ()=>{
            console.error('not implemented')
        },
        createEmptyFolder: ()=>{
            console.error('not implemented')
        },
        refreshFiles: ()=>{
            console.error('not implemented')
        },
    }
    const {handleContextMenu} = useObjContextMenu(actions)
    const menuItemsEmpty: MenuItem2[] = [{
        action: 'createEmptyScene',
        key: 'createEmptyScene',
        props: {text: 'New Scene', icon: 'cube-add'},
    },{
        action: 'createEmptyFolder',
        key: 'createEmptyFolder',
        props: {text: 'New Folder', icon: 'folder-new'},
    },{
        action: 'refreshFiles',
        key: 'refreshFiles',
        props: {text: 'Refresh', icon: 'refresh'},
    }]
    const menuItemsFiles: MenuItem2[] = []
    const {selectedFiles, setSelectedFiles }= useAssets()

    const {projectFile, project} = useProject()
    const {saveProjectFile, setProjectFile} = useProjectActions()
    const manager = useManager()

    const {saveBeforeClose} = useSaveBeforeClose()

    const {loadingState, updateLoading} = useLoadingState()

    const loadFile = async (f: FileManifestEntry | string)=>{
        if(projectFile && !manager.loadedProjectFile) return // todo loading another file
        if(project !== manager.loadedProject || !project) return // another or no project loaded. todo error?
        const g = async ()=>{
            const fi = typeof f !== 'string' ? await manifestEntryToFile(f) : null
            const r = await manager.getLoadedFile(project, typeof f === 'string' ? f : f.path, fi || undefined)
            if(r){
                setProjectFile(r)
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
                manager.loadedNeedsSave = false
                // don't save, just load, which will unload current file
                await g()
            }else {
                // cancelled
                return
            }
        }else{
            await g()
        }
    }

    return <ButtonGroup className="" style={{
        height: '100%',
        width: '100%',
        flex: "1 1",
        display: "flex",
        flexWrap: "wrap",
        alignContent: "flex-start",
        overflowY: 'auto',
        paddingTop: '10px',
        paddingBottom: '10px',
        boxSizing: 'border-box',
        gap: '1px',
    }} onContextMenu={e=>{
        e.preventDefault()
        e.stopPropagation()
        handleContextMenu(e, menuItemsEmpty)
    }} onClick={e=>{
        e.preventDefault()
        e.stopPropagation()
        setSelectedFiles([])
    }}
    onKeyDown={(e)=>{
        if(e.key === 'Escape'){
            setSelectedFiles([])
        }
    }}
    >
        {items.map(f=>{
            const selected = selectedFiles.includes(f)
            const icon = f.type === 'directory' ? 'folder-close' :
                f.path.endsWith('.scene.glb') ? 'cubes' :
                f.path.endsWith('.asset.glb') ? 'package' :
                f.path.endsWith('.glb') ? 'cube' :
                f.path.endsWith('.mat') || f.path.endsWith('.mat.json') ? 'style' :
                f.path.endsWith('.js') || f.path.endsWith('.ts') ? 'code' :
                f.path.endsWith('.png') ||
                    f.path.endsWith('.jpg') ||
                    f.path.endsWith('.webp') ||
                    f.path.endsWith('.gif') ||
                    f.path.endsWith('.mp4') ||
                    f.path.endsWith('.webm') ||
                    f.path.endsWith('.exr') ||
                    f.path.endsWith('.hdr') ||
                    f.path.endsWith('.ktx2') ||
                    f.path.endsWith('.jpeg') ? 'media' :
                f.path === ('package.json') ? 'box' :
                f.path.endsWith('.json') ? 'document-code' :
                'document'
            return <Button
                className={"file-item-button"}
                key={f.path}
                // icon={<img src={typeof f.preview=== 'string' ? project.preview : URL.createObjectURL(f.preview as File)}/>}
                icon={<Icon style={{padding: "5px"}} icon={icon} size={32}/>}
                text={f.path.replace(/\/$/, '').split('/').pop()}
                title={f.path}
                variant={"minimal"}
                alignText={'center'}
                active={selected}
                loading={loadingState[f.path]}
                onContextMenu={(e)=>{
                    e.preventDefault()
                    e.stopPropagation()
                    handleContextMenu(e, menuItemsFiles.map(i=>({...i, data: {file: f}})))
                }}
                onDoubleClick={(e)=>{
                    e.preventDefault()
                    e.stopPropagation()
                    if(f.type === 'directory') {
                        setCurrentPath(f.path)
                        setSelectedFiles([])
                    }else {
                        const newTab = e.metaKey || e.ctrlKey
                        const allowedTypes = ['.scene.glb', '.asset.glb', '.mat', /*'.glb', '.mat.json', '.js', '.ts'*/]
                        if(allowedTypes.some(ext=>f.path.endsWith(ext))) {
                            // todo check type of file and open it if possible
                            // check for needssave
                            if(newTab){
                                // todo
                                // window.open(window.location.pathname + '?project=' + encodeURIComponent(f.path) + (project?.path ? '&base=' + encodeURIComponent(project.path) : ''), '_blank')
                                return
                            }
                            updateLoading(f.path, loadFile(f))
                        }
                    }
                }}
                onClick={(e)=>{
                    // if(f.type === 'directory') setCurrentPath(f.path)
                    e.preventDefault()
                    e.stopPropagation()
                    // todo multiple files
                    setSelectedFiles([f])
                }}
                // loading={loadingState[project.path]}
                // onClick={() => updateLoading(project.path, loadProject(project))}
                // onClick={() => updateLoading('create-new', actions.createFile())}
            />
        })}
    </ButtonGroup>
}

export function FilesPanel({}: {
}){
    const {project} = useProject()
    // const manager = useManager()
    const {setFileManifest} = useAssets()
    const [currentPath, setCurrentPath] = useState<string>('/')
    useEffect(()=>{
        if(!project || !isPackageProject(project)) return
        if(project.handle?.kind === 'directory') {
            directoryToManifest(project.handle).then(setFileManifest)
        }
    }, [project])

    const refreshManifest = useMemo(() => {
        let lastCall = 0;
        return async () => {
            const now = Date.now();
            if (project?.handle?.kind === "directory" && now - lastCall >= 3000) {
                lastCall = now;
                return directoryToManifest(project.handle).then(setFileManifest)
            }
        };
    }, [project]);

    // console.log(fileManifest)

    // todo use FileSystemObserver also
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

    return !isPackageProject(project) ? null : <>
            <FilesPanelBreadCrumbs currentPath={currentPath} setCurrentPath={setCurrentPath}/>
            <FilesPanelGrid currentPath={currentPath} setCurrentPath={setCurrentPath}/>
        </>
}
