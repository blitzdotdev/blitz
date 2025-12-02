import {Button, ButtonProps, Tooltip} from "@blueprintjs/core";
import React from "react";

export function ButtonWithTooltip({tooltip, ...props}: ButtonProps & { tooltip: string }) {
    return <Tooltip
        content={tooltip}
        hoverOpenDelay={150}
        hoverCloseDelay={300}
    >
        <Button
            variant={"minimal"} size={"small"}
            title={tooltip}
            {...props}
        />
    </Tooltip>
}
