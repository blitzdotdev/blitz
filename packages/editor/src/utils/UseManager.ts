import {createContext, createElement, useContext, useEffect, useMemo, useState, type ReactNode} from 'react'
import {DevServerSource} from '../DevServerSource.ts'
import {ViewerInstanceManager} from './ViewerInstanceManager.ts'

export const ManagerContext = createContext<ViewerInstanceManager | undefined>(undefined)

export function ManagerProvider({children, source}: {children: ReactNode, source: DevServerSource}) {
    const value = useMemo(() => new ViewerInstanceManager(source), [source])

    useEffect(() => {
        void value.initialize().catch(() => undefined)
        return () => value.dispose()
    }, [value])

    return createElement(ManagerContext.Provider, {value}, children)
}

export function useManager() {
    const manager = useContext(ManagerContext)
    if (!manager) throw new Error('ViewerInstanceManager context is missing')
    return manager
}

export function useManagerVersion() {
    const manager = useManager()
    const [, setVersion] = useState(0)
    useEffect(() => {
        const changed = () => setVersion((version) => version + 1)
        manager.addEventListener('stateChange', changed)
        return () => manager.removeEventListener('stateChange', changed)
    }, [manager])
    return manager
}
