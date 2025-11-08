import {SupPluginModule} from "./SandboxPlugin.ts";
import {ImportMapsManager} from "./importMaps.ts";
import {FsImporter} from "./fsImporter.ts";

export interface JsFileParsed {
    code: string,
    deps: string[],
    depd: string[]
    _isParsedJs: true
}
const files = new Map<string, JsFileParsed>()
let moduleCacheKey = '1'
const fsImporter = new FsImporter(async (p)=>{
    const ff = files.get(p)
    if(!ff){
        console.warn('[JS Import] - File not found: ', p)
    }
    return !ff ? undefined : {str: ff.code, ct: 'application/javascript'}
})

// get import dependencies and add cache search param in code
function getLatestDeps(code: string, cacheKey: string){
    const importRegex = /import\s+(?:[\w*\s{},]*\s+from\s+)?["']([^"']+)["'];?/g
    const dynamicImportRegex = /import\(["']([^"']+)["']\)/g
    const requireRegex = /require\(["']([^"']+)["']\)/g
    const deps: string[] = []
    let match: RegExpExecArray | null
    const addDep = (dep: string)=>{
        if(!deps.includes(dep)){
            deps.push(dep)
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
    // add cache buster to relative paths
    code = code.replace(importRegex, (m, p1)=>{
        if(p1.startsWith('./') || p1.startsWith('../')){
            const url = new URL(p1, 'http://example.com')
            url.searchParams.set('cache', cacheKey)
            return m.replace(p1, url.pathname + url.search)
        }
        return m
    })
    code = code.replace(dynamicImportRegex, (m, p1)=>{
        if(p1.startsWith('./') || p1.startsWith('../')){
            const url = new URL(p1, 'http://example.com')
            url.searchParams.set('cache', cacheKey)
            return m.replace(p1, url.pathname + url.search)
        }
        return m
    })
    code = code.replace(requireRegex, (m, p1)=>{
        if(p1.startsWith('./') || p1.startsWith('../')){
            const url = new URL(p1, 'http://example.com')
            url.searchParams.set('cache', cacheKey)
            return m.replace(p1, url.pathname + url.search)
        }
        return m
    })
    return {code, ds: deps}
}

async function loadModules1(paths1: string[], readFile: (path: string)=>Promise<string>){
    const paths = [...paths1]
    const pf = async (path: string)=>{
        const pathURL = new URL(path, 'http://example.com')
        const path1 = pathURL.pathname.replace(/^\/+/, "") + pathURL.search
        const str = await readFile(path1)
        const {code, ds} = getLatestDeps(str, moduleCacheKey)
        const ff = {
            code: code + '\n//# sourceURL=' + path1.replace(/\s/g, '_') + '\n',
            deps: [] as string[],
            depsn: [] as string[], // nested
            depd: [] as string[], // dependants
            _isParsedJs: true as const,
        }
        files.set(path1, ff)
        for (const dep of ds) {
            if(dep.startsWith('./') || dep.startsWith('../')){
                const url2 = new URL(dep, pathURL)
                const path2 = url2.pathname.replace(/^\/+/, "") + url2.search
                if(ff.deps.includes(path2)) continue
                ff.deps.push(path2)
                ff.depsn.push(path2)
                if(!paths.includes(path2)){
                    paths.push(path2)
                    await pf(path2)
                }
                const fl = files.get(path2)
                if(fl && fl.deps.length > 0){
                    for (const d of fl.deps) {
                        if(!ff.depsn.includes(d)){
                            ff.depsn.push(d)
                        }
                    }
                }
                if(fl){
                    fl.depd.push(path2)
                }
            }else {
                ff.deps.push(dep)
                ff.depsn.push(dep)
            }
        }
        return ff
    }
    const modules = []
    const files2 = []
    for (const path of paths1) {
        let p1 = path
        let ff
        let url = new URL(path, 'http://example.com')
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
            ff = await pf(p1)
            url = new URL(p1, 'http://example.com')
            url.searchParams.set('cache', moduleCacheKey)
            p1 = fsImporter.prefix + url.pathname.replace(/^\/+/, "") + url.search
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
    return {paths, modules, files: files2}
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
    scriptModules.forEach((paths, key)=>{
        if(pathSet.has(key) || paths.deps.find(p=> pathSet.has(p))){
            ps.push(key)
        }
    })
    if(ps.length){
        moduleCacheKey = (parseInt(moduleCacheKey) + 1).toString()
    }
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
