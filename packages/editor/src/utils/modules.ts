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
    const exportRegex = /export\s+(?:\*\s*(?:as\s+\w+\s*)?|\{[^}]*\})\s*from\s*["']([^"']+)["'];?/g
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
    while ((match = exportRegex.exec(code)) !== null) {
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
    code = code.replace(exportRegex, replacer)
    code = code.replace(dynamicImportRegex, replacer)
    code = code.replace(requireRegex, replacer)
    return {code, ds: deps}
}

async function loadModules1(paths1: string[], readFile: (path: string)=>Promise<string>){
    // Reserve versions for the whole affected graph before emitting import URLs.
    // In particular, parent modules must never point at a child's old URL.
    const sources = new Map<string, string>()
    const previous = new Map<string, JsFileParsed | undefined>()
    const pf = async (path: string): Promise<JsFileParsed>=>{
        const lastFile = files.get(path)
        if (lastFile && !lastFile.needsUpdate) return lastFile
        const source = await readFile(path)
        const {ds} = patchDeps(source, path)
        const file: JsFileParsed = {
            code: '', deps: ds, depsn: [], depd: [], _isParsedJs: true,
            cacheKey: (lastFile?.cacheKey || 0) + 1,
            needsUpdate: false,
        }
        previous.set(path, lastFile)
        sources.set(path, source)
        // Install before descending so cycles terminate and share one version.
        files.set(path, file)
        for (const dep of ds) {
            if (dep.startsWith('./') || dep.startsWith('../')) {
                await pf(urlToPath(new URL(dep, 'http://example.com')))
            }
        }
        return file
    }
    try {
        for (const path of paths1) {
            if (path.startsWith('./') || path.startsWith('../')) {
                await pf(urlToPath(new URL(path, 'http://example.com')))
            }
        }
        for (const [path, source] of sources) {
            const file = files.get(path)!
            file.code = patchDeps(source, path).code + '\n//# sourceURL=' + path.replace(/\s/g, '_') + '\n'
            const nested = new Set<string>()
            const visit = (deps: string[])=>{
                for (const dep of deps) {
                    if (nested.has(dep)) continue
                    nested.add(dep)
                    if (dep.startsWith('./') || dep.startsWith('../')) {
                        visit(files.get(urlToPath(new URL(dep, 'http://example.com')))?.deps || [])
                    }
                }
            }
            visit(file.deps)
            file.depsn = [...nested]
        }
    } catch (error) {
        for (const [path, file] of previous) {
            if (file) files.set(path, file)
            else files.delete(path)
        }
        throw error
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
    return {
        module: modules[0] as SupPluginModule,
        deps: files[0].depsn
    }
}

export async function loadModules(path: string[], readFile: (path: string)=>Promise<string>){
    const {modules, files} = await loadModules1(path, readFile)
    path.forEach((p, i)=>{
        scriptModules.set(p, {deps: files[i].depsn, module: modules[i]})
        // modules[i].__tpPluginPath = p // todo clone?
    })
    return {
        modules: modules as SupPluginModule[],
        deps: files.map(f=>f.depsn)
    }
}

export function getFileChanged(path: string[]|Set<string>){
    const normalize = (path: string)=>urlToPath(new URL(path, 'http://example.com'))
    const changed = new Set([...path].map(normalize))
    // Invalidate every intermediate importer, not only registered entry modules.
    let expanded = true
    while (expanded) {
        expanded = false
        for (const [key, file] of files) {
            if (!changed.has(key) && file.deps.some(dep=>changed.has(normalize(dep)))) {
                changed.add(key)
                expanded = true
            }
        }
    }
    for (const key of changed) {
        const file = files.get(key)
        if (file) file.needsUpdate = true
    }
    return [...scriptModules.keys()].filter(key=>changed.has(normalize(key)))
}
