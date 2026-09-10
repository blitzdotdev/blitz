import './renderer.scss'
import reportWebVitals from './reportWebVitals';
import {FocusStyleManager} from "@blueprintjs/core";
import App from './App.tsx'
import {createRoot} from 'react-dom/client'
// import {StrictMode} from 'react'
import importMap from 'virtual:importmap'

function acceptCompanionLaunchCapability() {
    const fragment = new URLSearchParams(globalThis.location.hash.replace(/^#/, ''))
    const token = fragment.get('kiteCompanionToken')
    const workspaceToken = fragment.get('kiteWorkspaceToken')
    if (token) globalThis.sessionStorage.setItem('kite-companion-token', token)
    if (workspaceToken) globalThis.sessionStorage.setItem('kite-workspace-token', workspaceToken)
    if (!token && !workspaceToken) return
    fragment.delete('kiteCompanionToken')
    fragment.delete('kiteWorkspaceToken')
    const suffix = fragment.toString()
    globalThis.history.replaceState(null, '', `${globalThis.location.pathname}${globalThis.location.search}${suffix ? `#${suffix}` : ''}`)
}

acceptCompanionLaunchCapability()

// todo wont work in firefox? https://github.com/remorses/importmap-vite-plugin/issues/1
function setupImportMap() {
    const mapScript = document.createElement('script')
    importMap.imports.three = importMap.imports.threepipe
        mapScript.type = 'importmap'
    mapScript.textContent = JSON.stringify(importMap, null, 2)
    console.log(mapScript.textContent)
    document.head.append(mapScript)
}
setupImportMap()


FocusStyleManager.onlyShowFocusOnTabs();

createRoot(document.getElementById('root')!).render(
    // <StrictMode>
        <App />
    // </StrictMode>,
)



// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
