import {EventDispatcher} from "threepipe";

export interface FileTrackItem{
    file: File
    objectUrl: string
    lastUsed: number
    path: string
    onUpdate: Set<() => void>
}
export class FileTracker extends EventDispatcher<{
    fileAdd: { path: string, item: FileTrackItem },
    fileRemove: { path: string, item: FileTrackItem }
    fileUpdate: { path: string, item: FileTrackItem }
    fileGet: { path: string, item: FileTrackItem }
}> {
    _fileStash: Record<string, FileTrackItem> = {}

    get files() {
        return Object.values(this._fileStash)
    }

    getFile(path: string) {
        const p = encodeURI(decodeURI(path))
        const ex = this._fileStash[p]
        if (ex) {
            ex.lastUsed = Date.now()
            console.log('get from stash', p)
            ex.onUpdate.forEach(f => f())
        } else {
            console.log('not in stash', p, {...this._fileStash})
        }
        this.dispatchEvent({type: 'fileGet', path, item: ex!})
        return ex
    }

    setFile(path: string, file: File) {
        const p = encodeURI(decodeURI(path))
        const url = URL.createObjectURL(file) + '#' + p // todo revoke object url
        this._fileStash[p] = {
            file,
            objectUrl: url,
            lastUsed: Date.now(),
            onUpdate: new Set(),
            path: p,
        }
        this.dispatchEvent({type: 'fileAdd', path, item: this._fileStash[p]})
        console.log('set in stash', encodeURI(p), path)
        return url
    }

    updateFile(path: string, file: File) {
        const p = encodeURI(decodeURI(path))
        const ex = this._fileStash[p]
        if (ex) {
            URL.revokeObjectURL(ex.objectUrl)
            ex.file = file
            ex.lastUsed = Date.now()
            ex.objectUrl = URL.createObjectURL(file) + '#' + p
            ex.path = p
            console.log('update in stash', p)
            ex.onUpdate.forEach(f => f())
            this.dispatchEvent({type: 'fileUpdate', path, item: ex})
        }else{
            this.setFile(path, file)
        }
    }

    removeFile(path: string) {
        const p = encodeURI(decodeURI(path))
        const ex = this._fileStash[p]
        if (ex) {
            URL.revokeObjectURL(ex.objectUrl)
            delete this._fileStash[p]
            console.log('remove from stash', p)
            this.dispatchEvent({type: 'fileRemove', path, item: ex})
        }
    }

}
