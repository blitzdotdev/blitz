import type {IconName} from "@blueprintjs/icons";
import {MaybeElement} from "@blueprintjs/core/src/common/props.ts";
import {Icon} from "@blueprintjs/core";
import React from "react";

export function InsSectionTitle({title, hoverTitle, icon}: { title: string, hoverTitle?: string, icon?: IconName | MaybeElement }) {
    return <div className={"xPaddedContent folderContent folder-trigger-text"}
                title={hoverTitle || title}
                style={{
                    marginLeft: 0,
                    color: "var(--pt-text-color)",
                    flex: "1 1 auto",
                    minWidth: 0,
                    width: "100%",
                    textAlign: "left",
                    alignContent: "center",
                    gap: "4px",
                    display: "flex",
                    alignItems: "center",

                }}
    >
        {icon && (typeof icon === 'string' ? <Icon icon={icon} style={{}} size={12}/> : icon)}

        <span className={"inspector-section-title-text"}>{title}</span>
    </div>;
}
