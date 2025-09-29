import {useLoadingState} from 'uiconfig-blueprint/lib/esm/lib'
import {Button, Classes, Menu, MenuItem, Popover} from '@blueprintjs/core'
import {useCloseWithoutSave, useSaveFile} from "./UseSaveFile.tsx";
import {useManager, useProject} from "../utils/ViewerInstanceManager.ts";
import {useProjectActions} from "../utils/projectActions.tsx";

export function SaveFileButton() {
    const {loadingState, updateLoading} = useLoadingState()
    const {fileNamePrompt, saveFile} = useSaveFile()
    const {closeProject} = useCloseWithoutSave()

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
                             text={'Close'}
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


export function SaveProjectButton() {
    const {loadingState, updateLoading} = useLoadingState()
    const {closeProject} = useCloseWithoutSave()
    const {projectFile, project, fileNeedsSave} = useProject()
    const {saveProjectFile, loadProject} = useProjectActions()
    const manager = useManager()

    return !projectFile || !project || projectFile !== manager.loadedProjectFile ? null : <>
        {manager.loadedScene &&
            <Button
                    variant={"minimal"} size={"small"}
                    icon="git-repo" text="Save Scene"
                    loading={loadingState['save-scene']}
                    disabled={!fileNeedsSave}
                    onClick={() => updateLoading('save-scene', saveProjectFile())}/>
        }
        {manager.loadedAssetId &&
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
                             onClick={() => updateLoading('save-file', saveProjectFile().then(()=>loadProject(null)))}/>
                         <MenuItem
                             text={'Close'}
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
