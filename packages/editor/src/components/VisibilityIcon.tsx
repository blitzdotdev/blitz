import {FC, useReducer} from "react";
import {Icon} from "@blueprintjs/core";

export const VisibilityIcon: FC<{ obj: { visible: boolean, setDirty?: () => void } }> = ({obj}) => {
    const [, forceRender] = useReducer((version) => version + 1, 0)
    return (<Icon onClick={() => {
        obj.visible = !obj.visible
        obj.setDirty?.()
        forceRender()
    }} style={{cursor: 'pointer'}} icon={obj.visible ? 'eye-open' : 'eye-off'}/>)
}
