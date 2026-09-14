import {useLoadingState} from 'uiconfig-blueprint/lib/esm/lib'
import {Button} from '@blueprintjs/core'
import {useCallback, useEffect, useState} from "react";
import {useProject} from "../utils/UseProject.ts";
import {useManager} from "../utils/UseManager.ts";
import {showSuccessErrorToast} from "../utils/Toaster.tsx";

export function useSaveProjectFile() {
    const manager = useManager()
    const saveProjectFile = useCallback(async ()=>{
        if(!manager.loadedProjectFile || !manager.loadedProject) return
        const res = await manager.saveProjectSceneOrAsset(manager.loadedProject, manager.loadedProjectFile).catch(e=>{
            console.error(e)
            return {error: 'Unable to save file: ' + (e.message || e.toString())}
        })
        return showSuccessErrorToast(`Saved ${manager.loadedProject.path}${manager.loadedProjectFile.path} successfully.`, 'Unable to save file.', res as any)
    }, [manager])
    return {saveProjectFile}
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
    const {project} = useProject()
    const {saveProjectFile} = useSaveProjectFile()
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
    </>
}
