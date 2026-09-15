import {useEffect} from "react";
import {Button, Intent} from "@blueprintjs/core";
import {useDialog} from "uiconfig-blueprint/lib/esm/lib";

export interface AskChoice<T> {
    label: string
    value: T
    intent?: Intent
}

// The manager is not a React component, so it reaches the dialog through this ref, the way it
// reaches the toaster through AppToaster.
const asker = {
    ask: null as null | (<T>(title: string, message: string, choices: AskChoice<T>[]) => Promise<T>),
}

/** Mount once inside the DialogProvider. */
export function AskDialogBridge() {
    const {open, close} = useDialog()
    useEffect(() => {
        asker.ask = (title, message, choices) => new Promise((resolve) => open({
            canClose: false,
            title,
            content: message,
            actions: choices.map((choice, i) => <Button
                key={i}
                intent={choice.intent}
                text={choice.label}
                onClick={() => {
                    close()
                    resolve(choice.value)
                }}/>),
        }))
        return () => {
            asker.ask = null
        }
    }, [open, close])
    return null
}

/**
 * Asks one question with fixed answers. Before the editor has rendered nobody can answer, so the
 * first choice stands in: it is the one that changes nothing.
 */
export function ask<T>(title: string, message: string, choices: AskChoice<T>[]): Promise<T> {
    return asker.ask ? asker.ask(title, message, choices) : Promise.resolve(choices[0].value)
}
