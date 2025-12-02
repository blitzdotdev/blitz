import React, {createContext, FC, useCallback, useState} from "react";
import {ContextMenuPopover, hideContextMenu, Menu, MenuDivider, MenuItem, showContextMenu} from "@blueprintjs/core";
import {MenuItem2, MenuItemAction} from "../utils/ContextMenuUtils.ts";
import {showSuccessErrorToast} from "../utils/Toaster.tsx";
import {AppToaster} from "uiconfig-blueprint/lib/esm/lib";
import {logAsset} from "../utils/ViewerInstanceManager.ts";
import {useSafeContext} from "../utils/useSafeContext.ts";
import {renderMenuItems} from "./ContextMenuProvider.tsx";

// todo rename to use custom context menu
export function useObjContextMenu(actions: Record<string, MenuItemAction> = {}, Items?: FC<{
    event: React.MouseEvent<HTMLElement>,
    object: any
}>) {
    const [isOpen, setIsOpen] = useState(false);

    const handleClose = useCallback(() => {
        setIsOpen(false);
        hideContextMenu();
    }, []);

    // const menu = useMemo(
    //     () => (
    //         <Menu>
    //             <MenuItem
    //                 icon="cross-circle"
    //                 intent="danger"
    //                 text="Click me to close"
    //                 onClick={handleClose}
    //             />
    //             <MenuItem icon="search-around" text="Search around..." />
    //             <MenuItem icon="search" text="Object viewer" />
    //             <MenuItem icon="graph-remove" text="Remove" />
    //             <MenuItem icon="group-objects" text="Group" />
    //             <MenuDivider />
    //             <MenuItem disabled={true} text="Clicked on node" />
    //         </Menu>
    //     ),
    //     [handleClose],
    // );

    const handleContextMenu = useCallback(
        (event: React.MouseEvent<HTMLElement>, menu: React.JSX.Element) => {
            // ensure `preventDefault` is called just before `showContextMenu` and in the same event handler to prevent the
            // default browser context menu from hiding your custom context menu
            event.preventDefault();
            showContextMenu({
                content: menu,
                onClose: handleClose,
                targetOffset: {
                    left: event.clientX,
                    top: event.clientY,
                },
            });
            setIsOpen(true);
        },
        [handleClose],
    );
    const handleContextMenu1 = (event: React.MouseEvent<HTMLElement>, menuItems: MenuItem2[], obj: any)=>{
        if(window.location.origin === 'http://localhost:5173' && menuItems && !menuItems.find(m=>m.key === 'logAsset')){
            menuItems.push({
                props: {
                    text: 'Log in Console',
                    icon: 'console',
                },
                key: 'logAsset',
                action: 'logAsset',
                data: {}
            })
        }

        if(!menuItems || menuItems.length === 0) return

        const rc = renderMenuItems(menuItems, actions, obj);

        handleContextMenu(event, <Menu>
            <MenuDivider title="Actions" className={"context-menu-divider"} />
            {rc}
            {Items ? <Items event={event} object={obj}/> : null}
        </Menu>)
    }

    return {
        handleContextMenu: handleContextMenu1
    }
}

// export function ContextMenuProvider(actions: Record<string, MenuItemAction> = {}) {
//     const [isOpen, setIsOpen] = useState(false);
//
//     const handleClose = useCallback(() => {
//         setIsOpen(false);
//         hideContextMenu();
//     }, []);
//
//     const handleContextMenu = useCallback(
//         (event: React.MouseEvent<HTMLElement>, menu: React.JSX.Element) => {
//             // ensure `preventDefault` is called just before `showContextMenu` and in the same event handler to prevent the
//             // default browser context menu from hiding your custom context menu
//             event.preventDefault();
//             showContextMenu({
//                 content: menu,
//                 onClose: handleClose,
//                 targetOffset: {
//                     left: event.clientX,
//                     top: event.clientY,
//                 },
//             });
//             setIsOpen(true);
//         },
//         [handleClose],
//     );
//     const handleContextMenu1 = (event: React.MouseEvent<HTMLElement>, menuItems: MenuItem2[], obj: any)=>{
//
//         if(window.location.origin === 'http://localhost:5173' && menuItems){
//             menuItems.push({
//                 props: {
//                     text: 'Log in Console',
//                 },
//                 key: 'logAsset',
//                 action: 'logAsset',
//                 data: {}
//             })
//         }
//
//         if(!menuItems || menuItems.length === 0) return
//
//         const defActions = {logAsset}
//         const rc = menuItems.map((m, i)=><MenuItem {...m.props} key={m.key || i} onClick={async (e)=>{
//             const action = m.action
//             const actionFunc = typeof action === 'string' ? actions[action as keyof typeof actions] || defActions[action as keyof typeof defActions] : action
//             if(actionFunc){
//                 let res
//                 try {
//                     res = actionFunc === m.action ? m.action(m.data, obj, e): actionFunc(m.data, obj, e)
//                     if(res && typeof res.then === 'function'){
//                         res = await res
//                     }
//                 }catch (e) {
//                     res = {error: (e as Error).message || e + ''}
//                     throw e
//                 }
//                 if(res && (res.error || res.warn)){
//                     AppToaster().show({
//                         message: res.error || res.warn,
//                         intent: res.error ? 'danger' : 'warning',
//                         icon: res.error ? 'error' : 'warning-sign',
//                         timeout: 2000,
//                         isCloseButtonShown: true,
//                     });
//                     console.error(res)
//                 }
//             }
//             m.props?.onClick && m.props.onClick(e)
//         }}/>)
//         handleContextMenu(event, <Menu>
//             <MenuDivider title="Actions" className={"context-menu-divider"} />
//             {rc}
//             {Items ? <Items event={event} object={obj}/> : null}
//         </Menu>)
//     }
//
//     // return {
//     //     handleContextMenu: handleContextMenu1
//     // }
//
//     return <ContextMenuPopover isOpen={isOpen} content={content} targetOffset={offset}/>
// }
