import './renderer.scss'
import {createRoot} from 'react-dom/client'
import {FocusStyleManager} from '@blueprintjs/core'
import App from './App.tsx'

FocusStyleManager.onlyShowFocusOnTabs()

createRoot(document.getElementById('root')!).render(<App />)
