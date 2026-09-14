import {useSafeContext} from "./useSafeContext.ts";
import {createContext, createElement} from "react";
import {LoadedProject} from "./project.ts";

// The dev server serves one project, opened in main.tsx before the first render.
export const ProjectContext = createContext<LoadedProject|undefined>(undefined)

export function ProjectProvider({project, children}: { project: LoadedProject, children: any }) {
    return createElement(ProjectContext.Provider, {value: project}, children)
}

export const useProject = () => ({project: useSafeContext(ProjectContext)})
