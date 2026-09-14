import {FC, useState} from "react";
import {Icon, IconName} from "@blueprintjs/core";

export const VisibilityIcon: FC<{ obj: { visible: boolean, setDirty?: () => void } }> = ({obj}) => {
    const [icon, setIcon] = useState<IconName>('eye-open')
    return (<Icon onClick={() => {
        obj.visible = !obj.visible
        obj.setDirty?.()
        setIcon(icon === 'eye-open' ? 'eye-off' : 'eye-open')
    }} style={{cursor: 'pointer'}} icon={icon}/>)
}

