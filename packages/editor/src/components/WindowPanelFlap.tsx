import {Button} from "@blueprintjs/core";

export interface WindowPanelFlapProps {
    isCollapsed: boolean;
    onClick: () => void;
    position: 'left' | 'right' | 'bottom';
}

export function WindowPanelFlap({isCollapsed, onClick, position}: WindowPanelFlapProps) {
    const iconMap = {
        left: isCollapsed ? "chevron-right" : "chevron-left",
        right: isCollapsed ? "chevron-left" : "chevron-right",
        bottom: isCollapsed ? "chevron-up" : "chevron-down",
    } as const;

    const title = isCollapsed
        ? `Expand ${position} panel`
        : `Collapse ${position} panel`;

    return (
        <Button
            variant={"minimal"}
            size={"small"}
            icon={iconMap[position]}
            onClick={onClick}
            title={title}
            intent={"primary"}
            className={`panel-toggle-button panel-toggle-${position}`}
            onContextMenu={e => e.preventDefault()}
            // to prevent focus away from canvas on click
            onMouseDown={(e) => e.preventDefault()}
        />
    );
}
