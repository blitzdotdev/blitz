import {useSafeContext} from "./useSafeContext.ts";
import {createContext, createElement, type ReactNode, useState} from "react";
import {SavedSceneFile} from "./project.ts";


function useSetupProject() {
    const [project, setProject] = useState<SavedSceneFile|null>(null)
    // const [file, setFile] = useState<SavedSceneFile|null>(null)
    // const [scene, setScene] = useState<null | string>(null)
    const [path, setPath] = useState<null | string>(null)
    const [welcomeOpen, setWelcomeOpen] = useState(true)

    // Custom setProject that also updates URL immediately
    // const setProject = useCallback((newProject: string) => {
    //     // if (newProject) {
    //     //     console.log('Project changed:', newProject)
    //     // }
    //     // const params = new URLSearchParams(location.search)
    //     // const current = params.get('project') || params.get('p') || ''
    //     // if(current !== newProject) {
    //     //     if (params.has('project')) params.delete('project')
    //     //     if (params.has('p')) params.delete('p')
    //     //     params.set('p', newProject)
    //     //     window.history.replaceState({}, '', '?' + params.toString())
    //     // }
    //     _setProject(newProject)
    // }, [_setProject])

    // log file whenever it changes
    // useEffect(() => {
    //     if (file) {
    //         console.log('File changed:', file.name)
    //     }
    // }, [file])
    // // log path whenever it changes
    // useEffect(() => {
    //     if (path) {
    //         console.log('Path changed:', path)
    //     }
    // }, [path])
    return {
        project, setProject,
        // projectFile: file, setPFile: setFile,
        path, setPath,
        // scene, setScene,
        welcomeOpen, setWelcomeOpen: (v: boolean)=>{
            // console.warn('welcome open', v)
            setWelcomeOpen(v)
        },
    }
}

export const ProjectContext = createContext<ReturnType<typeof useSetupProject>|undefined>(undefined)

export function ProjectProvider({children}: { children: ReactNode }) {
    const value = useSetupProject()
    return createElement(ProjectContext.Provider, {value}, children)
}

export const useProject = () => useSafeContext(ProjectContext)
