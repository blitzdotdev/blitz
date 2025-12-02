import {getOrCall, UiObjectConfig} from "threepipe";
import {UiConfigRendererBase} from "uiconfig.js";
import {MenuItem2} from "./ContextMenuUtils.tsx";

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
