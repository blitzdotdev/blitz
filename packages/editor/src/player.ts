import {
    buildProjectBundleCode,
    getMeta,
    initProjectHandles,
    LoadedProject, parseAssetsJSONManifest,
    parsePackageJsonSettings, resolveFile
} from "./utils/project.ts";
import {getUrlQueryParam} from "threepipe";
import {FileParsed, FsImporter} from "./utils/fsImporter.ts";
import {addImportMap} from "./utils/importMaps.ts";
import hostImportMap from 'virtual:importmap'

export async function main(){
    const project = getUrlQueryParam('project') || getUrlQueryParam('p')
    if(!project) return {error: 'No project specified'}
    const meta = await getMeta(project)
    if(!meta) return {error: 'Project not found'}
    const handles = await initProjectHandles(meta)
    if(!handles.package.file) return {error: 'Project has no package.json'}
    const loadedProject = await parsePackageJsonSettings(handles.package.file, meta)
    const assetsJsonText = handles.assetsJson.file ? await handles.assetsJson.file.text() : ''
    const json = parseAssetsJSONManifest(assetsJsonText)
    loadedProject.assetsManifest = json

    if(!loadedProject.settings) return

    const scripts = new Map<string, FileParsed>()

    const fsImporter = new FsImporter(async (path)=>{
        const virtualPath = path.replace(/^\.\//, '').split('?')[0]
        const generated = scripts.get(virtualPath)
        if (generated) return generated
        const r = await resolveFile(path, loadedProject.path, loadedProject.handle)
        // todo check if r is a file and not a json object
        return r as File
    })

    const mainJsCode = await handles.mainJs.file?.text()
    const code = buildProjectBundleCode(loadedProject.settings, mainJsCode || '', fsImporter.prefix)

    // Project modules are loaded by the file-system service worker rather than
    // Vite, so their bare imports need the same singleton mappings as Kite.
    // Host mappings win over package/CDN fallbacks generated for an export.
    addImportMap({
        imports: {
            ...code.importMap,
            ...hostImportMap.imports,
            three: hostImportMap.imports.threepipe,
        },
    })

    scripts.set('_setup.js', {
        str: code["_setup.js"],
        ct: 'application/javascript'
    })
    scripts.set('main.js', {
        str: code["main.js"],
        ct: 'application/javascript'
    })

    // const setupFile = new File([code["_setup.js"]], '_setup.js', {type: 'application/javascript'})
    // const mainFile = new File([code["main.js"]], 'main.js', {type: 'application/javascript'})
    // const setupFileUrl = URL.createObjectURL(setupFile)
    // const mainFileUrl = URL.createObjectURL(mainFile)
    const mainModule = await fsImporter.import("main.js", true)
    if (!mainModule.projectReady || typeof mainModule.projectReady.then !== 'function') {
        throw new Error('Generated player entry did not expose projectReady')
    }
    const {viewer} = await mainModule.projectReady
    ;(window as any).viewer = viewer
}

main().catch(error=>{
    console.error('[kite-player] Failed to start project', error)
    const message = error instanceof Error ? error.message : String(error)
    document.body.dataset.playerError = message
    const notice = document.createElement('p')
    notice.setAttribute('role', 'alert')
    notice.textContent = `Could not start this game: ${message}`
    document.getElementById('viewer-container')?.replaceChildren(notice)
})
