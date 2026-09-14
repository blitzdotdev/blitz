import type {IconName} from "@blueprintjs/icons";
import {MaybeElement} from "@blueprintjs/core/src/common/props.ts";
import {ButtonProps, Icon, Tooltip} from "@blueprintjs/core";
import {ButtonWithTooltip} from "./ButtonWithTooltip.tsx";
import React from "react";

export function InsSectionItem(props: {
    text: string,
    icon?: IconName | MaybeElement,
    info?: { text: string, icon: IconName | MaybeElement }
    buttons?: ({ key: string, text: string, showText?: boolean } & ButtonProps)[]
}) {
    return <div
        className={"xPaddedContent folderContent folder-trigger-text"}
        style={{
            marginLeft: 0, height: "30px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "10px"
        }}
    >
        {props.icon && (typeof props.icon === 'string' ?
            <Icon icon={props.icon} style={{marginRight: "0"}} size={12}/> : props.icon)}
        <div style={{
            maxWidth: "100%",
            overflow: "scroll",
            flexGrow: "1",
            scrollbarWidth: "none",
        }}>
            {props.text}
        </div>
        {props.info && <Tooltip
            content={props.info.text}
            // position={"top"}
            hoverOpenDelay={150}
            hoverCloseDelay={300}
        >
            {typeof props.info.icon === 'string' ?
                <Icon icon={props.info.icon} style={{marginLeft: "6px"}} size={12}/> : props.info.icon}
        </Tooltip>}
        {props.buttons?.map(({key, text, showText, ...b}) => <ButtonWithTooltip
            key={key}
            tooltip={text}
            // icon="trash"
            title={text}
            {...b}
            text={showText ? text : undefined}
        />)}
    </div>
}
