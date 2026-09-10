// @ts-nocheck -- reference UI is backed by the DevServerSource compatibility facade.
import {ViewerInstanceManager} from "../utils/ViewerInstanceManager.ts";
import {showSuccessErrorToast} from "../utils/Toaster.tsx";

export const addProjectScript = async (path: string, manager: ViewerInstanceManager) => {
    if (!manager.loadedProject) return false
    const res = await manager.settingsManager.addProjectScript({import: './' + path}, true).then(() => ({error: null})).catch(e => {
        return {error: e?.message ?? 'Unknown error'}
    })
    const r = showSuccessErrorToast(res ? `Loaded ${manager.loadedProject.path}${path} successfully` : 'Unknown Error', 'Unable to load plugin', res)
    const mod = manager.scriptUtil.scriptModules.get('./' + path)
    if (!mod) {
        return false
    }
    // todo mod.module.__tpModuleError show in toast
    if ((mod.module as any)?.__tpModuleError)
        console.error((mod.module as any).__tpModuleError)
    return mod.components
}
