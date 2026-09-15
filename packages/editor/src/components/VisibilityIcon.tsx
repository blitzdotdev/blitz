import {FC, useReducer} from "react";
import {Icon} from "@blueprintjs/core";

export const VisibilityIcon: FC<{ obj: { visible: boolean, setDirty?: () => void } }> = ({obj}) => {
    // The icon reads the object, so a hidden object loaded from disk shows as hidden. Its own state
    // only ever agreed with the object until something else changed the object.
    const [, rerender] = useReducer((version: number) => version + 1, 0)
    return (<Icon onClick={() => {
        obj.visible = !obj.visible
        obj.setDirty?.()
        rerender()
    }} style={{cursor: 'pointer'}} icon={obj.visible ? 'eye-open' : 'eye-off'}/>)
}
