import {EventDispatcher} from "threepipe";
import {SetStateAction, useEffect, useState} from "react";

export function useListenProperty<TTarget extends EventDispatcher = EventDispatcher, TP extends keyof TTarget = keyof TTarget>(target: TTarget, property: TP, event: string, setter: (v: TTarget[TP]) => SetStateAction<TTarget[TP]> = ((v) => v), eventTarget?: any) {
    const [extScripts, setExtScripts] = useState<TTarget[TP]>(target[property])
    eventTarget = eventTarget ?? target
    useEffect(() => {
        const l = () => {
            setExtScripts(setter(target[property]))
        }
        eventTarget.addEventListener(event, l)
        return () => {
            eventTarget.removeEventListener(event, l)
        }
    }, [eventTarget, event, setter])
    useEffect(()=>{
        setExtScripts(setter(target[property]))
    }, [target, property])
    return extScripts
}
