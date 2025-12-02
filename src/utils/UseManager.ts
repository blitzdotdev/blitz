import {useSafeContext} from "./useSafeContext.ts";
import {ViewerInstanceManager} from "./ViewerInstanceManager.ts";
import {createContext, createElement, useState} from "react";

export const ManagerContext = createContext<ViewerInstanceManager | undefined>(undefined)

export function ManagerProvider({children}: { children: any }) {
    const [value] = useState(new ViewerInstanceManager())
    return createElement(ManagerContext.Provider, {value}, children)
}

export const useManager = () => useSafeContext(ManagerContext)
