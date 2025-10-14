export async function getDirHandle(base: FileSystemDirectoryHandle, parts: string[]|string, create = true) {
    if(typeof parts === 'string') parts = parts.split('/').filter(Boolean)
    let dirHandle = base
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i]
        // if(i === parts.length - 1){
        //     fileHandle = await dirHandle.getFileHandle(part, {create: true})
        // } else {
        dirHandle = await dirHandle.getDirectoryHandle(part, {create})
        // }
    }
    return dirHandle
}

// path should not start with / here and should be clean
export async function getFileHandle(base: FileSystemDirectoryHandle, path: string, create = true) {
    const parts = path.split('/')
    const dirHandle = await getDirHandle(base, parts.slice(0, -1), create).catch(e=>{
        // (e) => {
        // todo handle if there is dir with same name
        // if(e.name === "NotFoundError") return null
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
        // if(e.name === "NotFoundError") return null
        // if(e.name === "TypeMismatchError") return true
        // return undefined
        // }
        console.error(e)
        return undefined
    })
    return {fileHandle, dirHandle};
}
