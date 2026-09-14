import {createContext, createElement, type ReactNode, useState} from 'react'
import {useSafeContext} from './useSafeContext.ts'

function useSetupWelcome() {
    const [welcomeVisible, setWelcomeVisible] = useState(false)
    const [welcomeView, setWelcomeView] = useState<'projects' | 'open' | 'new'>('projects')
    return {welcomeVisible, setWelcomeVisible, welcomeView, setWelcomeView}
}

const WelcomeContext = createContext<ReturnType<typeof useSetupWelcome> | undefined>(undefined)

export function WelcomeProvider({children}: {children: ReactNode}) {
    const value = useSetupWelcome()
    return createElement(WelcomeContext.Provider, {value}, children)
}

export const useWelcome = () => useSafeContext(WelcomeContext)
