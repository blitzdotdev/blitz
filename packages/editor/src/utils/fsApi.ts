import {ProjectDirectoryHandle, ProjectFileHandle} from "../devserver/handles.ts";

export async function getDirHandle(base: ProjectDirectoryHandle, parts: string[]|string, create = true) {
    if(typeof parts === 'string') parts = parts.split('/').filter(Boolean)
    let dirHandle = base
    const handles = [dirHandle]
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i]
        if(!part || part === '.') continue
        if(part === '..') {
            handles.pop()
            if(!handles.length) dirHandle = base
            else dirHandle = handles[handles.length - 1]
            continue
        }
        dirHandle = await dirHandle.getDirectoryHandle(part, {create})
        handles.push(dirHandle)
    }
    return dirHandle
}

// path should not start with / here and should be clean
export async function getFileHandle(base: ProjectDirectoryHandle, path: string, create = true, warn404 = true) {
    const parts = decodeURIComponent(path).split('/')
    const dirHandle = await getDirHandle(base, parts.slice(0, -1), create).catch(e=>{
        // (e) => {
        // todo handle if there is dir with same name
        if(e.name === "NotFoundError") {
            if(!warn404) return undefined
        }
        // if(e.name === "TypeMismatchError") return true
        // return undefined
        // }
        console.error(e)
        console.error(parts, path)
        return undefined
    });
    const fileHandle = await dirHandle?.getFileHandle(parts[parts.length - 1], {create}).catch(e=>{
        // (e) => {
        // todo handle if there is dir with same name
        if(e.name === "NotFoundError") {
            if(!warn404) return undefined
        }
        // if(e.name === "TypeMismatchError") return true
        // return undefined
        // }
        console.error(path, e)
        return undefined
    })
    return {fileHandle, dirHandle};
}

export async function writeFileHandle(fileHandle: ProjectFileHandle, file: Blob | Uint8Array<ArrayBuffer> | string){
    await fileHandle.write(file)
}

export class AnotherFSHelper{

    async writeFile(base: ProjectDirectoryHandle, path: string, file: File, create = true, handle?: ProjectFileHandle){
        handle = handle || (await getFileHandle(base, path, create))?.fileHandle
        if(!handle){
            return false
        }
        await writeFileHandle(handle, file)
        return true
    }


}
