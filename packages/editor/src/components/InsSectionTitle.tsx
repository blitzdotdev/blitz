import type {IconName} from "@blueprintjs/icons";
import {MaybeElement} from "@blueprintjs/core/src/common/props.ts";
import {Icon} from "@blueprintjs/core";
import React from "react";

export function InsSectionTitle({title, icon}: { title: string, icon?: IconName | MaybeElement }) {
    return <div className={"xPaddedContent folderContent folder-trigger-text"}
                style={{
                    marginLeft: 0,
                    color: "var(--pt-text-color)",
                    flex: "1 1 auto",
                    width: "100%",
                    textAlign: "left",
                    alignContent: "center",
                    gap: "var(--pt-grid-size)",
                    display: "flex",
                    alignItems: "center",

                }}
    >
        {icon && (typeof icon === 'string' ? <Icon icon={icon} style={{}} size={12}/> : icon)}

        {title}
    </div>;
}
