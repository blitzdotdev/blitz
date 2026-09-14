import {useDialogPrompt} from "uiconfig-blueprint/lib/esm/lib";
import {Button, Intent} from "@blueprintjs/core";

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
