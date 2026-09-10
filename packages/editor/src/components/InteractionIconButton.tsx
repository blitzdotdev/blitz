import {Button, ButtonProps} from "@blueprintjs/core";

export const InteractionIconButton = (props1: ButtonProps) => {
    const {className, ...props} = props1
    return <Button
        className={`bpIconButton icon-only-tab-button ${className ?? ''}`}
        size={'medium'} variant={"minimal"}
        {...props}
    />
}
