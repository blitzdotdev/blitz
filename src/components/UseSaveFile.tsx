import {useDialogPrompt} from "../../../uiconfig-blueprint/lib/esm/components/DialogContext";
import {useManager, useProject} from "../utils/ViewerInstanceManager.ts";
import {useProjectActions} from "../utils/projectActions.tsx";
import {useCallback} from "react";
import {AppToaster} from "../../../uiconfig-blueprint/lib/esm/components/AppToaster";

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
        value: project || 'My File',
        // onClose: ()=>{console.log('close'); return true},
        onSubmit: async (value) => {
            const meta = await manager.getMeta(value)
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
            const meta = await manager.getMeta(value)
            return !meta;
        },
    }), [prompt, manager])
    const saveFile = useCallback(async ({name, isNewName, saveTempOnly, closeProject}: {
        name?: string,
        isNewName?: boolean,
        saveTempOnly?: boolean,
        closeProject?: boolean
    }) => {
        if (!name?.length && !project?.length) {
            name = await fileNamePrompt() || undefined
            isNewName = true
        }
        if (!name?.length) {
            name = project
            isNewName = false
        }
        if (!isNewName && saveTempOnly) {
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
        const res = await manager.saveScene(name, async (n: string, e: string) => {
            if (await fileNameExistsPrompt(n, e)) return n
            else return await fileNameExistsPrompt2(n, e)
        }, {isNewName, saveTempOnly}).catch(e=>{
            console.error('Error saving file', e)
            return {error: 'Error saving file: ' + (e.message || e), warn: undefined}
        })
        if (typeof res === 'string') {
            name = res
            // if (name !== project && setProject && !closeProject) setProject(name)

            AppToaster().show({
                message: 'Saved file "' + name + '"',
                intent: 'success',
                icon: 'tick',
                timeout: 2000,
                isCloseButtonShown: true,
            });

            await loadProject(closeProject ? null : name, closeProject)
        } else {
            AppToaster().show({
                message: res.error || res.warn,
                intent: res.error ? 'danger' : 'warning',
                icon: res.error ? 'error' : 'warning-sign',
                timeout: 2000,
                isCloseButtonShown: true,
            });
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
            await loadProject(null, true)
        }
    }, [closeWithoutSave, loadProject])
    return {closeProject, closeWithoutSave}
}
