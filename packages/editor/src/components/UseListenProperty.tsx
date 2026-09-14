import {EventDispatcher} from "threepipe";
import {SetStateAction, useEffect, useState} from "react";

export function useListenProperty<TTarget extends EventDispatcher = EventDispatcher, TP extends keyof TTarget = keyof TTarget>(target: TTarget, property: TP, event: string, setter: (v: TTarget[TP]) => SetStateAction<TTarget[TP]> = ((v) => v), eventTarget?: any) {
    const [state, setState] = useState<TTarget[TP]>(target[property])
    eventTarget = eventTarget ?? target
    useEffect(() => {
        const l = () => {
            setState(setter(target[property]))
        }
        eventTarget.addEventListener(event, l)
        return () => {
            eventTarget.removeEventListener(event, l)
        }
    }, [eventTarget, event, setter])
    useEffect(()=>{
        setState(setter(target[property]))
    }, [target, property])
    return state
}

// export function useListenProperty<TTarget extends EventDispatcher = EventDispatcher, TP extends keyof TTarget = keyof TTarget>(target: TTarget, property: TP, event: string, setter: (v: TTarget[TP]) => SetStateAction<TTarget[TP]> = ((v) => v), eventTarget?: any) {
//     const getter = useCallback(() => {
//         return target[property]
//     }, [target, property])
//     eventTarget = eventTarget ?? target
//     return useListenProperty2(eventTarget, getter, event, setter)
// }
//
// export function useListenProperty2<TTarget extends EventDispatcher = EventDispatcher, TP extends keyof TTarget = keyof TTarget>(eventTarget: any, getter: ()=>TTarget[TP], event: string, setter: (v: TTarget[TP]) => SetStateAction<TTarget[TP]> = ((v) => v)) {
//     const [state, setState] = useState<TTarget[TP]>(getter())
//     useEffect(() => {
//         const l = () => {
//             setState(setter(getter()))
//         }
//         eventTarget.addEventListener(event, l)
//         return () => {
//             eventTarget.removeEventListener(event, l)
//         }
//     }, [eventTarget, event, setter, getter])
//     useEffect(()=>{
//         setState(setter(getter()))
//     }, [getter])
//     return state
// }
