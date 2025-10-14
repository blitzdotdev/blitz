import {AppToaster, useDialogPrompt} from "uiconfig-blueprint/lib/esm/lib";
import {useManager, useProject} from "../utils/ViewerInstanceManager.ts";
import {useProjectActions} from "../utils/projectActions.tsx";
import {useCallback} from "react";
import {Button, Intent} from "@blueprintjs/core";
import {getMeta, SavedSceneFile} from "../utils/project.ts";

export function useSaveFile() {
    const {prompt} = useDialogPrompt()
    const {project} = useProject()
    const {loadProject} = useProjectActions()
    const manager = useManager()
    const fileNamePrompt = useCallback(async () => await prompt({
        title: 'File name',
        message: 'Enter a new file name: ',
        placeholder: 'My File',
        closeButtonText: 'Cancel',
        submitButtonText: 'Save',
        value: project?.path || 'My File',
        // onClose: ()=>{console.log('close'); return true},
        onSubmit: async (value) => {
            const meta = await getMeta(value)
            console.log(value, meta)
            if (meta) return {error: 'Filename already exists'}
            return !meta;
        },
    }), [prompt, manager, project])
    const fileNameExistsPrompt = useCallback((name: string, ext: string) => prompt({
        title: 'File name already exists',
        message: 'A file with the name "' + name + '.' + ext + '" already exists in this folder. Do you want to overwrite it?',
        closeButtonText: 'No',
        submitButtonText: 'Yes',
        value: 'yes',
        showInput: false,
    }), [prompt, manager])
    const fileNameExistsPrompt2 = useCallback((name: string, ext: string) => prompt({
        title: 'File name already exists',
        message: 'A file with the name "' + name + '.' + ext + '" already exists. Please enter a different name.',
        closeButtonText: 'Cancel',
        submitButtonText: 'Save',
        value: name,
        // onClose: ()=>{console.log('close'); return true},
        onSubmit: async (value) => {
            const meta = await getMeta(value)
            return !meta;
        },
    }), [prompt, manager])
    const saveFile = useCallback(async ({name, isNewName, saveTempOnly, closeProject}: {
        name?: string,
        isNewName?: boolean,
        saveTempOnly?: boolean,
        closeProject?: boolean
    }) => {
        if (!name?.length && !project?.path.length) {
            name = await fileNamePrompt() || undefined
            isNewName = true
        }
        if (!name?.length) {
            name = project?.path
            isNewName = false
        }
        if (name && !isNewName && saveTempOnly) {
            const isTemp = manager.isTempFile(name)
            if (!isTemp) {
                name = await fileNamePrompt() || undefined
                isNewName = true
            }
        }
        if (!name) {
            console.error('cannot save without name')
            return
        }
        const res = await manager.saveSceneAdHoc(name, async (n: string, e: string) => {
            if (await fileNameExistsPrompt(n, e)) return n
            else return await fileNameExistsPrompt2(n, e)
        }, {isNewName, saveTempOnly}).catch(e=>{
            console.error('Error saving file', e)
            return {error: 'Error saving file: ' + (e.message || e), warn: undefined}
        })
        if((res as any).error){
            AppToaster().show({
                message: (res as any).error || ((res as any) as any).warn,
                intent: (res as any).error ? 'danger' : 'warning',
                icon: (res as any).error ? 'error' : 'warning-sign',
                timeout: 2000,
                isCloseButtonShown: true,
            });

        }else{
            const meta1 = res as SavedSceneFile
            // if (name !== project && setProject && !closeProject) setProject(name)

            AppToaster().show({
                message: 'Saved file "' + name + '"',
                intent: 'success',
                icon: 'tick',
                timeout: 2000,
                isCloseButtonShown: true,
            });

            await loadProject(closeProject ? null : meta1)
        }
    }, [project, loadProject, manager, fileNamePrompt])
    return {fileNamePrompt, saveFile}
}

export function useCloseWithoutSave() {
    const {prompt} = useDialogPrompt()
    const {loadProject} = useProjectActions()
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
            await loadProject(null)
        }
    }, [closeWithoutSave, loadProject])
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
