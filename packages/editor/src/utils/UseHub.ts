import {createContext, createElement} from "react";
import {HubClient} from "../devserver/HubClient.ts";
import {useSafeContext} from "./useSafeContext.ts";

// The picker talks to the server that serves this page: the launcher on the hub page, the project's
// own server in an editor tab. Both serve the same hub routes.
export const HubContext = createContext<HubClient | undefined>(undefined)

export function HubProvider({hub, children}: { hub: HubClient, children: any }) {
    return createElement(HubContext.Provider, {value: hub}, children)
}

export const useHub = () => useSafeContext(HubContext)
