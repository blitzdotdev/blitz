import {useSafeContext} from "./useSafeContext.ts";
import {ViewerInstanceManager} from "./ViewerInstanceManager.ts";
import {createContext, createElement} from "react";

export const ManagerContext = createContext<ViewerInstanceManager | undefined>(undefined)

export function ManagerProvider({manager, children}: { manager: ViewerInstanceManager, children: any }) {
    return createElement(ManagerContext.Provider, {value: manager}, children)
}

export const useManager = () => useSafeContext(ManagerContext)
