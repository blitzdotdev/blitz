import {
    buildProjectBundleCode,
    getMeta,
    initProjectHandles,
    LoadedProject,
    parsePackageJsonSettings, resolveFile
} from "./utils/project.ts";
import {getUrlQueryParam} from "threepipe";
import {FileParsed, FsImporter} from "./utils/fsImporter.ts";

export async function main(){
    const project = getUrlQueryParam('project') || getUrlQueryParam('p')
    const projectFile = getUrlQueryParam('file') || getUrlQueryParam('f')
    if(!project) return {error: 'No project specified'}
    const meta = await getMeta(project)
    if(!meta) return {error: 'Project not found'}
    const handles = await initProjectHandles(meta)
    if(!handles.package.file) return {error: 'Project has no package.json'}
    const loadedProject = await parsePackageJsonSettings(handles.package.file, meta)

    if(!loadedProject.settings) return

    const scripts = new Map<string, FileParsed>()

    const fsImporter = new FsImporter(async (path)=>{
        const r = await resolveFile(path, loadedProject.path, loadedProject.handle)
        // todo check if r is a file and not a json object
        return r as File
    })

    const mainJsCode = await handles.mainJs.file?.text()
    const code = buildProjectBundleCode(loadedProject.settings, mainJsCode || '', fsImporter.prefix)

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
    const setupModule = await fsImporter.import("_setup.js", true)
    const mainModule = await fsImporter.import("main.js", true)
    const { viewer } = setupModule.setupProject(projectFile)
        .catch(mainModule.onError ? mainModule.onError : ()=>{})
        .then(async (data: any)=>{
            try{
                if(mainModule.main) await mainModule.main(data)
            }catch(e){
                console.error('Uncaught error during main script execution', e)
            }
            return data
        })
    ;(window as any).viewer = viewer
}
