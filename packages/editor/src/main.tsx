import './renderer.scss'
import {FocusStyleManager} from "@blueprintjs/core";
import App from './App.tsx'
import {createRoot} from 'react-dom/client'
// import {StrictMode} from 'react'
import importMap from 'virtual:importmap'

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
