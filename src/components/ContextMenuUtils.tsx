import {MenuItemProps} from "@blueprintjs/core";
import React from "react";

export type MenuItemAction = ((data?: any, obj?: any, e?: React.MouseEvent<HTMLElement, MouseEvent>, m?: MenuItem2) => any)
export interface MenuItem2{
    props: MenuItemProps
    action?: string | MenuItemAction
    data?: any
    key: string
    tags?: string[],
    children?: MenuItem2[]
}
export interface HandleContextMenuCallback<T = any>{
    handleContextMenu?: (e: React.MouseEvent<HTMLElement, MouseEvent>, menu: MenuItem2[], obj: T) => void
}
