import React, {useCallback, useState} from "react";
import {hideContextMenu, Menu, MenuItem, showContextMenu} from "@blueprintjs/core";
import {MenuItem2} from "./ContextMenuUtils.tsx";

// todo rename to use custom context menu
export function useObjContextMenu(actions: Record<string, (data?: any) => void> = {}) {
    const [_isOpen, setIsOpen] = useState(false);

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
    const handleContextMenu1 = (event: React.MouseEvent<HTMLElement>, menuItems: MenuItem2[])=>{
        if(!menuItems || menuItems.length === 0) return
        const rc = menuItems.map((m, i)=><MenuItem {...m.props} key={m.key || i} onClick={(e)=>{
            const action = m.action as keyof typeof actions
            if(action && actions[action]){
                actions[action](m.data)
            }
            m.props?.onClick && m.props.onClick(e)
        }}/>)
        handleContextMenu(event, <Menu>{rc}</Menu>)
    }

    return {
        handleContextMenu: handleContextMenu1
    }
}
