import {DevServerSource, ProjectFileEntry} from './DevServerSource.ts'

// The whole contract. Upstream calls nothing else on a handle.
export interface ProjectDirectoryHandle {
    readonly kind: 'directory'
    readonly name: string
    readonly path: string
    getDirectoryHandle(name: string, options?: {create?: boolean}): Promise<ProjectDirectoryHandle>
    getFileHandle(name: string, options?: {create?: boolean}): Promise<ProjectFileHandle>
    entries(): AsyncIterableIterator<[string, ProjectDirectoryHandle | ProjectFileHandle]>
}

export interface ProjectFileHandle {
    readonly kind: 'file'
    readonly name: string
    readonly path: string
    getFile(): Promise<File>
    write(data: Blob | Uint8Array<ArrayBuffer> | string): Promise<void>
}

export class ProjectManifest {
    files = new Map<string, ProjectFileEntry>()
    directories = new Set<string>()
    based = new Map<string, string>()                // the sha this tab last read or wrote, per path

    constructor(private readonly source: DevServerSource) {}

    async refresh() {
        const [files, directories] = await Promise.all([this.source.list(), this.source.listDirectories()])
        this.files = new Map(files.map((f) => [f.path, f]))
        this.directories = new Set(directories)
    }

    childrenOf(dir: string): Array<[string, 'file' | 'directory']> {
        const prefix = dir ? dir + '/' : ''
        const names = new Map<string, 'file' | 'directory'>()
        for (const path of this.files.keys()) {
            if (!path.startsWith(prefix)) continue
            const rest = path.slice(prefix.length)
            const slash = rest.indexOf('/')
            names.set(slash < 0 ? rest : rest.slice(0, slash), slash < 0 ? 'file' : 'directory')
        }
        for (const d of this.directories) {
            if (d.startsWith(prefix) && !d.slice(prefix.length).includes('/')) names.set(d.slice(prefix.length), 'directory')
        }
        return [...names]
    }
}

const notFound = (name: string) => new DOMException(`${name} not found`, 'NotFoundError')

export class DevServerDirectoryHandle implements ProjectDirectoryHandle {
    readonly kind = 'directory' as const

    constructor(readonly path: string, private readonly source: DevServerSource, private readonly manifest: ProjectManifest) {}

    get name() {
        return this.path.split('/').pop() || ''
    }

    async getDirectoryHandle(name: string, options: {create?: boolean} = {}) {
        const path = this.child(name)
        if (!this.manifest.directories.has(path) && !this.manifest.childrenOf(path).length) {
            if (!options.create) throw notFound(name)
            await this.source.createDirectory(path)
            this.manifest.directories.add(path)
        }
        return new DevServerDirectoryHandle(path, this.source, this.manifest)
    }

    async getFileHandle(name: string, options: {create?: boolean} = {}) {
        const path = this.child(name)
        if (!this.manifest.files.has(path)) {
            if (!options.create) throw notFound(name)
            // '*' is unconditional; callers check existence first (FilesPanel.tsx:222)
            const {sha256} = await this.source.write(path, new Uint8Array(), '*')
            this.manifest.files.set(path, {path, size: 0, sha256, mtime: Date.now()})
            this.manifest.based.set(path, sha256)
        }
        return new DevServerFileHandle(path, this.source, this.manifest)
    }

    async* entries(): AsyncIterableIterator<[string, DevServerDirectoryHandle | DevServerFileHandle]> {
        for (const [name, kind] of this.manifest.childrenOf(this.path)) {
            const path = this.child(name)
            yield [name, kind === 'directory'
                ? new DevServerDirectoryHandle(path, this.source, this.manifest)
                : new DevServerFileHandle(path, this.source, this.manifest)]
        }
    }

    private child(name: string) {
        return this.path ? `${this.path}/${name}` : name
    }
}

export class DevServerFileHandle implements ProjectFileHandle {
    readonly kind = 'file' as const

    constructor(readonly path: string, private readonly source: DevServerSource, private readonly manifest: ProjectManifest) {}

    get name() {
        return this.path.split('/').pop() || ''
    }

    async getFile(): Promise<File> {
        const {bytes, sha256} = await this.source.read(this.path, this.manifest.files.get(this.path)?.sha256)
        this.manifest.based.set(this.path, sha256)
        return new File([bytes], this.name, {lastModified: this.manifest.files.get(this.path)?.mtime})
    }

    async write(data: Blob | Uint8Array<ArrayBuffer> | string) {
        // The base is what this tab read or wrote, never what it heard from an event. A file this tab
        // never read (a new sidecar) writes unconditionally, which the server spells '*'.
        const {sha256} = await this.source.write(this.path, data, this.manifest.based.get(this.path) || '*')
        this.manifest.based.set(this.path, sha256)
        this.manifest.files.set(this.path, {
            ...(this.manifest.files.get(this.path) || {path: this.path, size: 0, mtime: 0}),
            sha256,
            mtime: Date.now(),
        })
    }
}
