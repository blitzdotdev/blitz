import React from "react";
import type {IconName} from "@blueprintjs/icons";
import {MaybeElement} from "@blueprintjs/core/src/common/props.ts";
import {Button, Icon, Intent} from "@blueprintjs/core";
import {iconForSelectionObject} from "../utils/icons.tsx";

export function UnkObjComponent({obj, ...props}: {
    obj: any,
    onClick?: (event: React.MouseEvent) => void,
    open?: boolean,
    label?: string,
    minimal?: boolean,
    level?: number,
    disabled?: boolean,
    icon?: IconName | MaybeElement
}) {
    return <Button
        className={"folder-trigger-button folder-trigger-text " + (props.open ? "folder-trigger-button-expanded" : "")}
        // fill={!props.minimal}
        fill={true}
        onClick={props.onClick}
        variant={"minimal"}
        disabled={props.disabled}
        size={props.minimal ? 'small' : "medium"}
        style={props.level ? {marginLeft: "6px"} : {fontSize: "0.95rem", paddingTop: "8px", paddingBottom: "8px"}}
        // intent={props.open ? Intent.PRIMARY : Intent.NONE}
        intent={Intent.NONE}
        // icon={props.enabled !== undefined  && <span style={{minWidth: '20px'}}></span>} // adding a span here will center the text in the button
        icon={props.icon ?? iconForSelectionObject(obj) ?? (
            <Icon icon="caret-right" style={{
                rotate: props.open ? "90deg" : "0deg",
                transition: "rotate 0.25s ease-in-out"
            }}/>
        )}
    >{(props.label ?? obj?.name) || "Unnamed Object"}
    </Button>
}
