import {useProject} from "./UseProject.ts";
import {useManager} from "./UseManager.ts";
import {useState} from "react";
import {IMaterial, IObject3D} from "threepipe";
import {showSuccessErrorToast} from "./Toaster.tsx";

export function useMakeAsset() {
    const {project} = useProject()
    const manager = useManager()
    const [isMaking, setIsMaking] = useState(false)

    const makeAsset = async (data: { obj: IObject3D | IMaterial }) => {
        if (!project || !manager.loadedProjectFile) return false
        if (isMaking) return
        setIsMaking(true)

        const res = await manager.saveNewProjectAsset(project, manager.loadedProjectFile, data.obj)
        setIsMaking(false)
        // @ts-ignore
        const r = showSuccessErrorToast(res.path ? `Created ${project.path}${res.path} successfully` : 'Unknown Error', 'Unable to create asset', res)
        return (res as any).result ?? null

    }
    return {makeAsset}
}
