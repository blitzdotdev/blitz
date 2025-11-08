import './renderer.scss'
import reportWebVitals from './reportWebVitals';
import {FocusStyleManager} from "@blueprintjs/core";
import App from './App.tsx'
import {createRoot} from 'react-dom/client'
// import {StrictMode} from 'react'
import importMap from 'virtual:importmap'

// todo wont work in firefox? https://github.com/remorses/importmap-vite-plugin/issues/1
function setupImportMap() {
    const mapScript = document.createElement('script')
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
