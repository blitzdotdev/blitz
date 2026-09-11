import {MenuItemProps} from "@blueprintjs/core";
import React from "react";
import {getOrCall, UiConfigRendererBase, UiObjectConfig} from "threepipe";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- UI config actions use heterogeneous payloads and results.
export type MenuItemAction = ((data?: any, obj?: any, e?: React.MouseEvent<HTMLElement, MouseEvent>, m?: MenuItem2) => any)
export interface MenuItem2{
    props: MenuItemProps
    action?: string | MenuItemAction
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- UI config supplies heterogeneous action data.
    data?: any
    key: string
    tags?: string[],
    children?: MenuItem2[],
    hidden?: boolean,
}
export interface HandleContextMenuCallback<T = unknown>{
    handleContextMenu?: (e: React.MouseEvent<HTMLElement, MouseEvent>, menu: MenuItem2[], obj: T) => void
}

export function uiConfigToMenuItem(btn: UiObjectConfig, context: UiConfigRendererBase) {
    if (!btn || typeof btn !== 'object') return;
    const label = context.methods.getLabel(btn)
    const getProps = () => { // todo use UiConfigMethods.getBaseProps
        const hidden = getOrCall(btn.hidden) ?? false
        const disabled = getOrCall(btn.disabled) ?? false
        const readOnly = getOrCall(btn.readOnly) ?? false
        return {hidden, disabled, readOnly}
    }
    const props = getProps()
    return {
        props: {
            text: context.methods.getLabel(btn),
            disabled: props.disabled || props.readOnly,
            hidden: props.hidden,
            // icon: context.methods.getIcon(btn),
        },
        key: btn.key || label,
        action: (data, obj, e) => {
            const {hidden, disabled, readOnly} = getProps()
            if (hidden || disabled || readOnly) return
            context.methods.clickButton(btn, {args: [e]})
        },
        data: {}
    } as MenuItem2
}
