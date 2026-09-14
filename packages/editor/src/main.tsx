import './renderer.scss'
import {FocusStyleManager} from "@blueprintjs/core";
import App from './App.tsx'
import {createRoot} from 'react-dom/client'
// import {StrictMode} from 'react'
import importMap from 'virtual:importmap'
import {DevServerSource} from './devserver/DevServerSource.ts'
import {DevServerDirectoryHandle, ProjectManifest} from './devserver/handles.ts'
import {ViewerInstanceManager} from './utils/ViewerInstanceManager.ts'

declare global {
    interface Window {
        // kite3d screenshot and the cookie isolation test wait for this
        kite3dProjectLoaded?: boolean
    }
}

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

async function openServedProject() {
    const source = new DevServerSource()
    const state = await source.state()
    // A server without a project answers {hub: true}; the project picker pass renders that page.
    if (state.hub) return

    const manifest = new ProjectManifest(source)
    await manifest.refresh()
    const root = new DevServerDirectoryHandle('', source, manifest)

    const manager = new ViewerInstanceManager()
    const project = await manager.initReadWriteProject({
        path: state.name || '',
        file: 'package.json',
        assets: 'assets/',
        lastModified: Date.now(),
        handle: root,
    })
    await manager.loadProject(project, {})
    const mainScene = project.settings?.mainScene
    await manager.loadProjectFile(mainScene ? await manager.getLoadedFile(project, mainScene) : null)

    createRoot(document.getElementById('root')!).render(
        // <StrictMode>
            <App manager={manager} project={project}/>
        // </StrictMode>,
    )
    window.kite3dProjectLoaded = true
}

void openServedProject()
