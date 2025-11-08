import {useManager} from "../utils/ViewerInstanceManager.ts";
import {useListenProperty} from "./UseListenProperty.tsx";
import {IObject3D} from "threepipe";
import {AppToaster} from "uiconfig-blueprint/lib/esm/lib";

export function useOnObjectCreate() {
    const manager = useManager()
    // this is needed to rerender react
    const loadedProjectFile = useListenProperty(manager, 'loadedProjectFile', 'loadedProjectFileChange')
    const onObjectCreate = ((manager.loadedAssetObj as IObject3D)?.isObject3D || manager.loadedScene || !loadedProjectFile) ? (obj: IObject3D, root?: IObject3D) => {
        const scene = manager.get().scene
        if (!scene || !obj) return undefined
        if (manager.loadedAssetObj) {
            if ((manager.loadedAssetObj as IObject3D)?.isObject3D) {
                if (root) {
                    let p = root
                    while (p && p !== scene.modelRoot && p !== manager.loadedAssetObj) {
                        p = p.parent as IObject3D
                    }
                    if (p !== manager.loadedAssetObj) {
                        AppToaster().show({
                            message: 'The selected root is not part of the loaded asset',
                            intent: 'warning',
                            icon: 'warning-sign',
                            timeout: 2000,
                            isCloseButtonShown: true,
                        });
                    } else {
                        root.add(obj)
                    }
                } else {
                    (manager.loadedAssetObj as IObject3D).add(obj)
                }
            } else {
                AppToaster().show({
                    message: 'Cannot create a new object in this file',
                    intent: 'warning',
                    icon: 'warning-sign',
                    timeout: 2000,
                    isCloseButtonShown: true,
                });
            }
        } else if (manager.loadedScene || !loadedProjectFile) {
            if (root && root !== scene.modelRoot)
                root.add(obj)
            else
                scene.addObject(obj)
        }

        obj?.parent && obj.dispatchEvent({type: 'select', value: obj, object: obj, ui: true})
        return obj?.parent
    } : null
    return onObjectCreate;
}
