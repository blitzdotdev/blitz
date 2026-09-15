import {AppToaster} from "uiconfig-blueprint/lib/esm/lib";

/** The editor's one error toast. The error goes to the console too, because a toast has no stack. */
export function showErrorToast(message: string, error: unknown) {
    console.error(message, error)
    AppToaster().show({
        message,
        intent: 'danger',
        icon: 'error',
        timeout: 5000,
        isCloseButtonShown: true,
    });
}

export interface ErrorRes{error?: string | null, warn?: string | null}
export function showSuccessErrorToast(message: string, errMessage: string, res?: ErrorRes) {
    if (res?.error || res?.warn) {
        AppToaster().show({
            message: res.error || res.warn || errMessage,
            intent: res.error ? 'danger' : 'warning',
            icon: res.error ? 'error' : 'warning-sign',
            timeout: 2000,
            isCloseButtonShown: true,
        });
        errMessage && console.error(errMessage)
        res && console.error(res)
        return false
    } else {
        res && console.warn(res)
        AppToaster().show({
            message,
            intent: 'success',
            icon: 'tick',
            timeout: 2000,
            isCloseButtonShown: true,
        })
        return true
    }
}
