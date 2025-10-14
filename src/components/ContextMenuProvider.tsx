import React, {createContext, FC, useState} from "react";
import {MenuItem2, MenuItemAction} from "./ContextMenuUtils.tsx";
import {logAsset} from "../utils/ViewerInstanceManager.ts";
import {ContextMenuPopover, Menu, MenuDivider, MenuItem} from "@blueprintjs/core";
import {AppToaster} from "uiconfig-blueprint/lib/esm/lib";
import {useSafeContext} from "../utils/useSafeContext.ts";

export interface ContextMenuItemsProps<T = any>{
    event: React.MouseEvent<HTMLElement>,
    object: T
}
function useStore() {
    const [isOpen, setIsOpen] = useState(false);
    const [targetOffset, setTargetOffset] = useState<{left: number, top: number}>({left: 0, top: 0});
    const [content, setContent] = useState<React.JSX.Element | null>(null);

    const hideContextMenu = () => {
        setIsOpen(false);
        setContent(null)
    }

    const showContextMenu = (event: React.MouseEvent<HTMLElement>, menu: React.JSX.Element) => {
        event.preventDefault();
        setContent(menu)
        setTargetOffset({left: event.clientX, top: event.clientY})
        setIsOpen(true);
        return hideContextMenu
    }

    return {
        isOpen, setIsOpen,
        targetOffset, setTargetOffset,
        content, setContent, showContextMenu, hideContextMenu,
        handleContextMenu: <T=any>(props: {
            event: React.MouseEvent<HTMLElement, MouseEvent>,
            obj: T,
            actions: Record<string, MenuItemAction>,
            actionItems?: MenuItem2[],
            Items?: FC<ContextMenuItemsProps<T>>
        })=>{
            const {event, obj, actions, actionItems = [], Items} = props
            if(window.location.origin === 'http://localhost:5173' && actionItems){
                actionItems.push({
                    props: {
                        text: 'Log in Console',
                    },
                    key: 'logAsset',
                    action: 'logAsset',
                    data: {}
                })
            }

            if(!actionItems || actionItems.length === 0) return

            const defActions = {logAsset}
            const rc = actionItems.map((m, i)=><MenuItem {...m.props} key={m.key || i} onClick={async (e)=>{
                const action = m.action
                const actionFunc = typeof action === 'string' ? actions[action as keyof typeof actions] || defActions[action as keyof typeof defActions] : action
                if(actionFunc){
                    let res
                    try {
                        res = actionFunc === m.action ? m.action(m.data, obj, e): actionFunc(m.data, obj, e)
                        if(res && typeof res.then === 'function'){
                            res = await res
                        }
                    }catch (e) {
                        res = {error: (e as Error).message || e + ''}
                        throw e
                    }
                    if(res && (res.error || res.warn)){
                        AppToaster().show({
                            message: res.error || res.warn,
                            intent: res.error ? 'danger' : 'warning',
                            icon: res.error ? 'error' : 'warning-sign',
                            timeout: 2000,
                            isCloseButtonShown: true,
                        });
                        console.error(res)
                    }
                }
                m.props?.onClick && m.props.onClick(e)
            }}/>)
            return showContextMenu(event, <Menu>
                {rc.length ? <MenuDivider title="Actions" className={"context-menu-divider"} /> : null}
                {rc}
                {Items ? <Items event={event} object={obj}/> : null}
            </Menu>)
        }
    }
}

const StoreContext = createContext<ReturnType<typeof useStore>|undefined>(undefined)

export function ContextMenuProvider({children}: { children: any }) {
    const value = useStore()
    // return createElement(StoreContext.Provider, {value}, children)
    return <StoreContext.Provider value={value}>
        {children}
        {value.content && <ContextMenuPopover
            isOpen={value.isOpen}
            content={value.content}
            targetOffset={value.targetOffset}
            onClose={value.hideContextMenu}
        ></ContextMenuPopover>}
    </StoreContext.Provider>
}
export const useContextMenu = () => useSafeContext(StoreContext)
