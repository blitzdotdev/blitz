import {AppToaster} from "uiconfig-blueprint/lib/esm/lib";

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
        console.error(errMessage)
        console.error(res)
        return false
    } else {
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
