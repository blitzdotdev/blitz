import importMap from 'virtual:importmap'

export function addImportMap(importMap: {imports: Record<string, string>}) {
    const script = document.createElement("script");
    script.type = "importmap";
    script.textContent = JSON.stringify(importMap);
    // document.currentScript.after(script);
    document.head.append(script);
}
export function addImportMapEntry(specifier: string, url: string) {
    addImportMap({
        imports: {[specifier]: url}
    })
}

export interface PackageDependency {
    key: string
    version: string // or url
    url?: string // optional, if not provided, will use esm.sh
}

export class ImportMapsManager{
    static defaultImports = importMap.imports
    static addedImports: Record<string, PackageDependency&{url: string}> = {

    }

    static addDependency(...deps: PackageDependency[]) {
        const imports = {} as Record<string, string>
        for (const dep of deps) {
            if(this.addedImports[dep.key]) {
                console.error(`Import map for ${dep.key} already exists, skipping.`, dep, this.addedImports[dep.key])
                return
            }
            const externals = Object.keys(this.defaultImports)
            if(externals.includes(dep.key)) {
                console.warn(`Import map for ${dep.key} exists in default imports, skipping.`)
                return
            }
            externals.push(...Object.keys(this.addedImports))
            let url = dep.url || `https://esm.sh/${dep.key}@${dep.version}`
            if(externals.length) url += `?external=${externals.join(',')}`
            imports[dep.key] = url
            this.addedImports[dep.key] = {...dep, url}
        }
        addImportMap({imports})
    }

}
