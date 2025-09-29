import {MenuItemProps} from "@blueprintjs/core";
import React from "react";

export interface MenuItem2{
    props: MenuItemProps
    action: string
    data?: any
    key: string
}
export interface HandleContextMenuCallback{
    handleContextMenu?: (e: React.MouseEvent<HTMLElement, MouseEvent>, menu: MenuItem2[]) => void
}
