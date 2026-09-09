import React, {useState} from "react";
import {Button, Classes, IconName, MaybeElement, Menu, Popover} from "@blueprintjs/core";

export function PopupMenuButton({children, icon, text, style, className}: {
    icon?: IconName | MaybeElement,
    text?: string,
    children: React.ReactNode,
    style?: React.CSSProperties,
    className?: string
}) {
    const [settingsOpen, setSettingsOpen] = useState(false)
    return <Popover targetProps={{style: style, className: className}}
                    minimal
                    targetTagName={"div"}
                    isOpen={settingsOpen}
                    onInteraction={(o, e) => {
                        if ((e?.target as HTMLElement)?.classList.contains('bp5-slider')) return
                        if ((e?.target as HTMLElement)?.classList.contains('bp5-slider-handle')) return
                        setSettingsOpen(o)
                    }}
                    onClose={e => {
                        // setSettingsOpen(false)
                    }}
                    hoverOpenDelay={150}
                    hoverCloseDelay={300}
                    content={
                        <Menu className={Classes.ELEVATION_0}>
                            {children}
                        </Menu>
                    } placement="bottom">
        <Button icon={icon} size={"small"} variant={"minimal"} style={{margin: "3px"}} text={text}/>
    </Popover>
}
