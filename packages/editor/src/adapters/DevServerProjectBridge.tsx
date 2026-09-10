import {useEffect, type ReactNode} from 'react'
import {useManagerVersion} from '../utils/UseManager.ts'
import {useProject} from '../utils/UseProject.ts'
import type {SavedSceneFile} from '../utils/project.ts'

/** AGREED-4: expose the dev-server project through the reference project context. */
export function DevServerProjectBridge({children}: {children: ReactNode}) {
    const manager = useManagerVersion()
    const {project, setProject, setPath, setWelcomeOpen} = useProject()

    useEffect(() => {
        if (!manager.projectLoaded || !manager.loadedProject) return
        const displayPath = `${manager.loadedProject.name}/`
        if (project?.path !== displayPath) {
            setProject({...manager.loadedProject, path: displayPath} as unknown as SavedSceneFile)
        }
        setPath('/')
        setWelcomeOpen(false)
    }, [manager, manager.projectLoaded, manager.loadedProject, project, setProject, setPath, setWelcomeOpen])

    return children
}
