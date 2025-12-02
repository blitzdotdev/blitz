import {useLoadingState} from 'uiconfig-blueprint/lib/esm/lib'
import {Button, Classes, Menu, MenuItem, Popover} from '@blueprintjs/core'
import {useCloseWithoutSave, useSaveFile} from "./UseSaveFile.tsx";
import {useProjectActions} from "../utils/projectActions.tsx";
import {useEffect, useState} from "react";
import {useProject} from "../utils/UseProject.ts";
import {useManager} from "../utils/UseManager.ts";

export function SaveFileButton() {
    const {loadingState, updateLoading} = useLoadingState()
    const {fileNamePrompt, saveFile} = useSaveFile()
    const {closeProject} = useCloseWithoutSave()

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 's') {
                event.preventDefault()
                updateLoading('save-file', saveFile({}))
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => {
            window.removeEventListener('keydown', handleKeyDown)
        }
    }, [saveFile, updateLoading])

    return <>
        <Button
                variant={"minimal"} size={"small"}
                icon="git-repo" text="Save"
                loading={loadingState['save-file']}
                onClick={() => updateLoading('save-file', saveFile({}))}/>
        <Popover targetProps={{style: {}}}
                 minimal
                 targetTagName={'div'}
                 content={
                     <Menu className={Classes.ELEVATION_0}>
                         <MenuItem
                             text={'Save As'}
                             // icon={'floppy-disk'}
                             onClick={() => updateLoading('save-file',
                                 fileNamePrompt().then((val) =>
                                     val ? saveFile({name: val, isNewName: true}) : undefined))}/>
                         <MenuItem // todo: show only if handle is not present.
                             text={'Save Temp'}
                             // icon={'floppy-disk'}
                             onClick={() => updateLoading('save-file', saveFile({saveTempOnly:true}))}/>
                         <MenuItem
                             text={'Save and Close'}
                             // icon={'floppy-disk'}
                             onClick={() => updateLoading('save-file', saveFile({closeProject: true}))}/>
                         <MenuItem
                             text={'Close File'}
                             // icon={'floppy-disk'}
                             onClick={() => updateLoading('save-file', closeProject())}/>
                     </Menu>
                 } placement="bottom">
            <Button icon="caret-down" disabled={loadingState['save-file']}
                    variant={"minimal"} size={"small"}
                    text=""/>
        </Popover>
    </>
}


export function useFileNeedsSave(){
    const manager = useManager()
    const [fileNeedsSave, setFileNeedsSave] = useState(manager.loadedNeedsSave)
    useEffect(()=>{
        const l = ()=>{
            // console.log(manager.loadedNeedsSave)
            setFileNeedsSave(manager.loadedNeedsSave)
        }
        manager.addEventListener('loadedNeedsSaveChange', l)
        return ()=>{
            manager.removeEventListener('loadedNeedsSaveChange', l)
        }
    }, [manager])
    return [fileNeedsSave, setFileNeedsSave]
}

export function SaveProjectButton() {
    const {loadingState, updateLoading} = useLoadingState()
    const {closeProject} = useCloseWithoutSave()
    const {project} = useProject()
    const {saveProjectFile, loadProject1} = useProjectActions()
    const manager = useManager()

    const [fileNeedsSave] = useFileNeedsSave()

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 's') {
                event.preventDefault()
                updateLoading('save-scene', saveProjectFile())
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => {
            window.removeEventListener('keydown', handleKeyDown)
        }
    }, [saveProjectFile, updateLoading])

    return !manager.loadedProjectFile || !project ? null : <>
        {manager.loadedScene &&
            <Button
                    variant={"minimal"} size={"small"}
                    icon="git-repo" text="Save Scene"
                    loading={loadingState['save-scene']}
                    disabled={!fileNeedsSave}
                    onClick={() => updateLoading('save-scene', saveProjectFile())}/>
        }
        {manager.loadedAssetObj &&
            <Button
                    variant={"minimal"} size={"small"}
                    icon="git-repo" text="Save File"
                    loading={loadingState['save-scene']}
                    disabled={!fileNeedsSave}
                    onClick={() => updateLoading('save-scene', saveProjectFile())}/>
        }
        <Popover targetProps={{style: {}}}
                 minimal
                 targetTagName={'div'}
                 content={
                     <Menu className={Classes.ELEVATION_0}>
                         <MenuItem
                             text={'Save and Close'}
                             // icon={'floppy-disk'}
                             onClick={() => updateLoading('save-file', saveProjectFile().then(()=>loadProject1(null)))}/>
                         <MenuItem
                             text={'Close Project'}
                             // icon={'floppy-disk'}
                             onClick={() => updateLoading('save-file', closeProject())}/>
                     </Menu>
                 } placement="bottom">
            <Button icon="caret-down" disabled={loadingState['save-file']}
                    variant={"minimal"} size={"small"}
                    text=""/>
        </Popover>
    </>
}
