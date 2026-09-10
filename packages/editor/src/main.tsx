import '@blueprintjs/core/lib/css/blueprint.css'
import './renderer.scss'
import {createRoot} from 'react-dom/client'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(<App />)
