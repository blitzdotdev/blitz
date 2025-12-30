import {settingsKey} from "./project.ts";
import {BroadcastDataTypes} from "./ViewerInstanceManager.ts";

export async function getDirHandle(base: FileSystemDirectoryHandle, parts: string[]|string, create = true) {
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
export async function getFileHandle(base: FileSystemDirectoryHandle, path: string, create = true, warn404 = true) {
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


export async function queryHandlePerm(handle: FileSystemDirectoryHandle) {
    let perm = await handle.queryPermission({mode: 'readwrite'})
    if (perm !== 'granted') {
        perm = await handle.requestPermission({mode: 'readwrite'})
    }
    if (perm !== 'granted') {
        // return {
        //     error: 'no permission to write to the file system, cannot save file'
        // }
        throw new Error('No permission to access the project files')
    }
    return true
}



export async function writeFileHandle(fileHandle: FileSystemFileHandle, file: FileSystemWriteChunkType){
    const writer = await fileHandle.createWritable()
    await writer.write(file)
    await writer.close()
}

export class AnotherFSHelper{

    // todo channel is never closed
    broadcastChannel = new BroadcastChannel(settingsKey + '-threepipe-editor')
    broadcastMessage = <T extends keyof BroadcastDataTypes = keyof BroadcastDataTypes>(type: T, data: BroadcastDataTypes[T]) => {
    };

    async writeFile(base: FileSystemDirectoryHandle, path: string, file: File, project: string, create = true, handle?: FileSystemFileHandle){
        handle = handle || (await getFileHandle(base, path, create))?.fileHandle
        if(!handle){
            return false
        }
        await writeFileHandle(handle, file)
        if(path.startsWith('.')) return true
        // notify to other tabs
        try {
            this.broadcastMessage('file-change', {
                project,
                path,
                file,
                // lastModified: file.lastModified,
            })
        }catch (e) {
            console.warn('Failed to postMessage notification', e)
        }
        return true
    }


}
