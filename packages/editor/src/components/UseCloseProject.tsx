import {useDialogPrompt} from "uiconfig-blueprint/lib/esm/lib";
import {useProjectActions} from "../utils/projectActions.tsx";
import {useCallback} from "react";
import {Button, Intent} from "@blueprintjs/core";
import {useManager} from "../utils/UseManager.ts";

export function useCloseWithoutSave() {
    const {prompt} = useDialogPrompt()
    const {loadProject1} = useProjectActions()
    const manager = useManager()
    const closeWithoutSave = useCallback(async () => await prompt({
        title: 'Close without saving',
        message: 'Are you sure you want to close the project without saving?',
        closeButtonText: 'Cancel',
        submitButtonText: 'Close',
        value: 'yes',
        showInput: false,
    }), [prompt])
    const closeProject = useCallback(async () => {
        const res = await closeWithoutSave()
        if (res) {
            manager.loadedNeedsSave = false
            await loadProject1(null)
        }
    }, [closeWithoutSave, loadProject1])
    return {closeProject, closeWithoutSave}
}

export function useSaveBeforeClose() {
    // const {open, close} = useDialog()
    const {prompt, close} = useDialogPrompt()
    const saveBeforeClose = ()=>{
        return new Promise<boolean|null>((resolve)=>{
            const buttons = [{
                label: 'Cancel',
                value: null,
            },{
                label: 'No',
                value: false,
            },{
                label: 'Yes',
                value: true,
            },]
            let resolved = false
            prompt({
                canClose: false,
                title: 'Save File',
                message: 'You have unsaved changes, do you want to save before closing?',
                showInput: false,
                actions: (
                    buttons.map((b, i)=><Button
                        key={i}
                        intent={b.value ? Intent.SUCCESS : b.value === false ? Intent.DANGER : Intent.NONE}
                        onClick={() => {
                            resolved = true
                           close()
                           resolve(b.value)
                        }}>{b.label}</Button>)
                ),
            }).finally(()=>!resolved && resolve(null))
        })
    }
    return {saveBeforeClose}
}
