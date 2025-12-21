import type {IconName} from "@blueprintjs/icons";
import {MaybeElement} from "@blueprintjs/core/src/common/props.ts";
import React, {ReactElement} from "react";
import {ButtonGroup} from "@blueprintjs/core";

import {InsSectionTitle} from "./InsSectionTitle.tsx";

export function InsSectionHeader({
    children, title, icon, className, style,
}: {
    title: string,
    icon?: IconName | MaybeElement,
    className?: string,
    style?: React.CSSProperties,
    children?: ReactElement | ReactElement[]
}) {
    return <ButtonGroup className={className} style={{
        height: "30px",
        padding: "3px",
        width: "100%",
        ...style,
    }}>
        {/*<div>File</div>*/}
        <InsSectionTitle title={title || 'Selection'} icon={icon}/>
        {/*{selFile.uiConfig && (<ConfigObject {...props} config={selFile.uiConfig}/>)}*/}
        {children}
    </ButtonGroup>
}
