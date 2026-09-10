export class FakeDirectory {
    readonly kind = 'directory'
    readonly files = new Map<string, Uint8Array>()
    readonly directories = new Map<string, FakeDirectory>()

    constructor(readonly name: string) {}

    directory(name: string): FakeDirectory {
        let directory = this.directories.get(name)
        if (!directory) {
            directory = new FakeDirectory(name)
            this.directories.set(name, directory)
        }
        return directory
    }

    set(path: string, value: string | Uint8Array): void {
        const parts = path.split('/')
        if (parts.length > 1) {
            this.directory(parts[0]).set(parts.slice(1).join('/'), value)
            return
        }
        this.files.set(parts[0], typeof value === 'string' ? new TextEncoder().encode(value) : value)
    }

    async text(path: string): Promise<string> {
        return (await this.file(path)).text()
    }

    async file(path: string): Promise<File> {
        const parts = path.split('/')
        if (parts.length > 1) {
            const next = this.directories.get(parts[0])
            if (!next) throw notFound()
            return next.file(parts.slice(1).join('/'))
        }
        const name = parts[0]
        const bytes = this.files.get(name)
        if (!bytes) throw notFound()
        return new File([bytes], name)
    }

    async getDirectoryHandle(name: string, options?: {create?: boolean}): Promise<FakeDirectory> {
        const existing = this.directories.get(name)
        if (existing) return existing
        if (!options?.create) throw notFound()
        return this.directory(name)
    }

    async getFileHandle(name: string, options?: {create?: boolean}) {
        if (!this.files.has(name) && !options?.create) throw notFound()
        if (!this.files.has(name)) this.files.set(name, new Uint8Array())
        return {
            kind: 'file',
            name,
            getFile: () => this.file(name),
            createWritable: async () => ({
                write: async (data: FileSystemWriteChunkType) => {
                    this.files.set(name, await bytesOf(data))
                },
                close: async () => undefined,
            }),
        }
    }

    async *values() {
        for (const name of [...this.directories.keys()].sort()) yield this.directories.get(name)!
        for (const name of [...this.files.keys()].sort()) yield await this.getFileHandle(name)
    }

    asHandle(): FileSystemDirectoryHandle {
        return this as unknown as FileSystemDirectoryHandle
    }
}

async function bytesOf(data: FileSystemWriteChunkType): Promise<Uint8Array> {
    if (typeof data === 'string') return new TextEncoder().encode(data)
    if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer())
    if (data instanceof ArrayBuffer) return new Uint8Array(data)
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    throw new Error('The fake directory only supports direct file writes.')
}

function notFound(): DOMException {
    return new DOMException('Not found', 'NotFoundError')
}
