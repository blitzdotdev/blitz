import {Alignment, Button, ButtonGroup, H4} from '@blueprintjs/core'
import {WelcomeDialogCreateProjectActions} from './WelcomeDialogCreateProjectActions'
import {WelcomeDialogEmptyProjectState} from './WelcomeDialogEmptyProjectState'
import {useLoadingState} from 'uiconfig-blueprint/lib/esm/lib'
import {useEffect, useState} from 'react'
import {useProjectActions} from '../utils/projectActions.tsx'
import {SavedSceneFileMeta} from "../utils/project.ts";
import {useManager} from "../utils/UseManager.ts";
import {refreshProjectQueryState} from "../utils/refreshProjectQueryState.ts";
import {WelcomeDialogGameActions} from './WelcomeDialogGameActions.tsx'
import {isWorkspaceLaunch} from '../utils/ai/workspaceLaunch.ts'

export function WelcomeDialogProjectsTab() {
    return isWorkspaceLaunch() ? <WelcomeDialogGameActions/> : <SavedProjectsTab/>
}

function SavedProjectsTab() {
    const [projects, setProjects] = useState<SavedSceneFileMeta[]>([])
    const {loadingState, updateLoading} = useLoadingState()
    const manager = useManager()
    useEffect(() => {
        manager.listFilesMeta('', true).then(setProjects)
    }, [manager, setProjects]);
    // useEffect(() => {
    //     console.log(projects)
    // }, [projects]);
    // const {loadProject} = useProjectActions()

    return projects.length > 0 ? (
            <div className="welcome-main-container">
                <H4>
                    Drop 3D files anywhere to open them
                </H4>
                <ButtonGroup className="welcome-main-create-actions">
                    <WelcomeDialogCreateProjectActions alignText={Alignment.CENTER} minimal={false} outlined={false}/>
                </ButtonGroup>
                <ButtonGroup className="welcome-project-list">
                    {projects.map((project) => (
                        <Button
                                key={project.path}
                                className={"file-item-button"}
                                icon={<img className={"bp5-icon"} src={typeof project.preview=== 'string' ? project.preview : URL.createObjectURL(project.preview as File)}/>}
                                text={project.path.replace(/\/$/, '').split('/').pop()}
                                variant={"minimal"}
                                alignText={'center'}
                                loading={loadingState[project.path]}
                                onClick={() => updateLoading(project.path, refreshProjectQueryState({project: project.path, file: null}, true))}
                            // onClick={() => updateLoading('create-new', actions.createFile())}
                        />
                    ))}
                </ButtonGroup>
            </div>
        ) : (<WelcomeDialogEmptyProjectState/>)
}
