import './renderer.scss'
import reportWebVitals from './reportWebVitals';
import {FocusStyleManager} from "@blueprintjs/core";
import App from './App.tsx'
import {createRoot} from 'react-dom/client'
import {StrictMode} from 'react'


FocusStyleManager.onlyShowFocusOnTabs();

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <App />
    </StrictMode>,
)



// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
