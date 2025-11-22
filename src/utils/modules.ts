import {SupPluginModule} from "./SandboxPlugin.ts";
import {ImportMapsManager} from "./importMaps.ts";
import {FsImporter} from "./fsImporter.ts";

export interface JsFileParsed {
    code: string,
    deps: string[],
    depsn: string[],
    depd: string[]
    _isParsedJs: true
    cacheKey: number
    needsUpdate: boolean
}
const files = new Map<string, JsFileParsed>()
const fsImporter = new FsImporter(async (p)=>{
    const ff = files.get(p)
    if(!ff){
        console.warn('[JS Import] - File not found: ', p)
    }
    return !ff ? undefined : {str: ff.code, ct: 'application/javascript'}
})

function urlToPath(url: URL){
    return url.pathname.replace(/^\/+/, "") + url.search
}

// get import dependencies and add cache search param in code
function patchDeps(code: string, currentPath: string){
    const importRegex = /import\s+(?:[\w*\s{},]*\s+from\s+)?["']([^"']+)["'];?/g
    const dynamicImportRegex = /import\(["']([^"']+)["']\)/g
    const requireRegex = /require\(["']([^"']+)["']\)/g
    const deps: string[] = []
    let match: RegExpExecArray | null

    // Parse current path to get base URL for resolving relative paths
    const currentPathURL = new URL(currentPath, 'http://example.com')

    const addDep = (dep: string)=>{
        // Resolve relative paths to absolute paths
        let resolvedDep = dep
        if(dep.startsWith('./') || dep.startsWith('../')){
            const url = new URL(dep, currentPathURL)
            resolvedDep = './' + urlToPath(url)
        }
        if(!deps.includes(resolvedDep)){
            deps.push(resolvedDep)
        }
    }

    while ((match = importRegex.exec(code)) !== null) {
        addDep(match[1])
    }
    while ((match = dynamicImportRegex.exec(code)) !== null) {
        addDep(match[1])
    }
    while ((match = requireRegex.exec(code)) !== null) {
        addDep(match[1])
    }

    const replacer = (m: string, p1: string)=>{
        if(p1.startsWith('./') || p1.startsWith('../')){
            // const url = new URL(p1, currentPathURL)
            const url = new URL(p1, 'http://example.com')
            const url2 = new URL(p1, currentPathURL)
            const fiPath = urlToPath(url2)
            const cacheKey = files.has(fiPath) ? files.get(fiPath)!.cacheKey || 1 : 1
            url2.searchParams.set('cache', ''+cacheKey)
            return m.replace(p1, fsImporter.prefix + urlToPath(url2))
        }
        return m
    }
    code = code.replace(importRegex, replacer)
    code = code.replace(dynamicImportRegex, replacer)
    code = code.replace(requireRegex, replacer)
    return {code, ds: deps}
}

async function loadModules1(paths1: string[], readFile: (path: string)=>Promise<string>){
    const paths = [...paths1]
    const pf = async (path: string)=>{
        const lastFile = files.get(path)
        if(lastFile){
            if(!lastFile.needsUpdate) return lastFile
        }
        const str = await readFile(path)
        const {code, ds} = patchDeps(str, path)
        const ff = {
            code: code + '\n//# sourceURL=' + path.replace(/\s/g, '_') + '\n',
            deps: [],
            depsn: [], // nested
            depd: [], // dependants
            _isParsedJs: true,
            cacheKey: (lastFile?.cacheKey||0) + 1,
            needsUpdate: false
        } as JsFileParsed
        files.set(path, ff)
        for (const dep of ds) {
            // deps are already resolved to absolute paths from patchDeps
            if(dep.startsWith('./') || dep.startsWith('../')){
                if(ff.deps.includes(dep)) continue
                ff.deps.push(dep)
                ff.depsn.push(dep)
                // Convert dep to the same format as path for lookup
                const depURL = new URL(dep, 'http://example.com')
                const depPath = urlToPath(depURL)
                const fl = await pf(depPath)
                if(fl && fl.deps.length > 0){
                    for (const d of fl.deps) {
                        if(!ff.depsn.includes(d)){
                            ff.depsn.push(d)
                        }
                    }
                }
                if(fl){
                    fl.depd.push(dep)
                }
            }else {
                ff.deps.push(dep)
                ff.depsn.push(dep)
            }
        }

        console.log('Process script file:', path, ff);

        return ff
    }
    const modules = []
    const files2 = []
    for (const path of paths1) {
        let p1 = path
        let ff
        // let url = new URL(path, 'http://example.com')
        if(ImportMapsManager.addedImports[p1]){
            ff = {
                code: '',
                deps: [],
                depsn: [],
                depd: [],
            }
        }/*else {
            let p2 = resolvePath(path)
            if(p2 !== path){
                p1 = p2
            }
        }*/
        else if(p1.startsWith('./') || p1.startsWith('../')) {
            const pathURL = new URL(p1, 'http://example.com')
            ff = await pf(urlToPath(pathURL))
            pathURL.searchParams.set('cache', (ff.cacheKey || 0) + '')
            p1 = fsImporter.prefix + urlToPath(pathURL)
        }else { // external package
            ff = {
                code: '',
                deps: [],
                depsn: [],
                depd: [],
            }
        }

        const module = await fsImporter.import(p1, false).catch((err)=>{
            console.error('Error loading module:', path)
            console.error(err)
            // throw err
            return {__tpModuleError: err}
        })
        modules.push(module)
        files2.push(ff)
    }
    return {modules, files: files2}
}

const scriptModules = new Map<string, {deps: string[], module: any}>()

export async function loadModule(path: string, readFile: (path: string)=>Promise<string>){
    const {modules, files} = await loadModules1([path], readFile)
    scriptModules.set(path, {deps: files[0].depsn, module: modules[0]})
    // modules[0].__tpPluginPath = path // todo clone?
    return modules[0] as SupPluginModule
}

export async function loadModules(path: string[], readFile: (path: string)=>Promise<string>){
    const {modules, files} = await loadModules1(path, readFile)
    path.forEach((p, i)=>{
        scriptModules.set(p, {deps: files[i].depsn, module: modules[i]})
        // modules[i].__tpPluginPath = p // todo clone?
    })
    return modules as SupPluginModule[]
}

export function getFileChanged(path: string[]|Set<string>){
    const pathSet = Array.isArray(path) ? new Set(path) : path
    const ps: string[] = []
    pathSet.forEach(p=>{
        const pathURL = new URL(p, 'http://example.com')
        p = urlToPath(pathURL)
        if(files.has(p)){
            const f = files.get(p)!
            // f.cacheKey = (f.cacheKey || 0) + 1
            f.needsUpdate = true
        }
    })
    scriptModules.forEach((paths, key)=>{
        if(pathSet.has(key) || paths.deps.find(p=> pathSet.has(p))){
            ps.push(key)
            const pathURL = new URL(key, 'http://example.com')
            const fi = files.get(urlToPath(pathURL))
            if(fi){
                // fi.cacheKey = (fi.cacheKey || 0) + 1
                fi.needsUpdate = true
            }
        }
    })
    return ps
}


// const includePaths = ['src', 'lib']
// const modulesPath = 'node_modules'
//
// function resolvePath(path: string){
//     const isRel = path.startsWith('./') || path.startsWith('../')
//     const url = new URL(path, 'http://example.com')
//     for (const inc of includePaths) {
//         if(url.pathname.startsWith(`/${inc}/`)){
//             return url.pathname // already in include path
//         }
//     }
//     if(!isRel && !url.pathname.startsWith(`/${modulesPath}/`)){
//          todo we need to read the package.json imports and exports etc
//         return `/${modulesPath}/${path}` // add modules path
//     }
//     return path
// }
