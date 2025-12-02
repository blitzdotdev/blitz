import {useListenProperty} from "./UseListenProperty.tsx";
import {IObject3D, UndoManagerPlugin} from "threepipe";
import {AppToaster} from "uiconfig-blueprint/lib/esm/lib";
import {useManager} from "../utils/UseManager.ts";

export function useOnObjectCreate() {
    const manager = useManager()
    // this is needed to rerender react
    const loadedProjectFile = useListenProperty(manager, 'loadedProjectFile', 'loadedProjectFileChange')
    const onObjectCreate = ((manager.loadedAssetObj as IObject3D)?.isObject3D || manager.loadedScene || !loadedProjectFile) ? (obj: IObject3D, root?: IObject3D) => {
        const viewer = manager.get()
        const scene = viewer.scene
        if (!scene || !obj) return undefined

        let parent = null

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
                        parent = (obj)
                    }
                } else {
                    parent = (manager.loadedAssetObj as IObject3D)
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
                parent = root
            else
                parent = scene
        }

        const cmd = {
            redo: ()=>parent === scene ? scene.addObject(obj) : parent?.add(obj),
            undo: ()=>obj.dispose ? obj.dispose(true) : obj.removeFromParent(),
        }
        const undo = viewer.getPlugin(UndoManagerPlugin)?.undoManager
        undo?.record(cmd)
        cmd.redo()

        obj?.parent && obj.dispatchEvent({type: 'select', value: obj, object: obj, ui: true, trackUndo: false})
        return obj?.parent
    } : null
    return onObjectCreate;
}
