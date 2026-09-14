// @ts-nocheck -- reference asset action is retained behind manager compatibility methods.
import {useManager} from "./UseManager.ts";
import {useState} from "react";
import {IMaterial, IObject3D} from "threepipe";
import {showSuccessErrorToast} from "./Toaster.tsx";

export function useMakeAsset() {
    const manager = useManager()
    const [isMaking, setIsMaking] = useState(false)

    const makeAsset = async (data: { obj: IObject3D | IMaterial }) => {
        if (!manager.loadedProject || !manager.loadedFilePath) return false
        if (isMaking) return
        setIsMaking(true)

        try {
            const res = await manager.saveNewProjectAsset(data.obj)
            showSuccessErrorToast(res.path ? `Created ${manager.loadedProject.path}${res.path} successfully` : 'Unknown Error', 'Unable to create asset', res)
            return res.result ?? null
        } finally {
            setIsMaking(false)
        }

    }
    return {makeAsset}
}
