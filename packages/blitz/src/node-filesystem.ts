import {mkdir, readFile, readdir, stat, writeFile} from 'node:fs/promises'
import {basename, dirname, resolve, sep} from 'node:path'

/** A File System Access-shaped adapter backed by a real directory on disk. */
export class NodeProjectDirectory {
    readonly kind = 'directory' as const
    readonly name: string
    private readonly root: string
    private readonly directory: string

    constructor(root: string, directory = resolve(root)) {
        this.root = resolve(root)
        this.directory = resolve(directory)
        this.name = basename(this.directory)
        this.assertInside(this.directory)
    }

    asHandle(): FileSystemDirectoryHandle {
        return this as unknown as FileSystemDirectoryHandle
    }

    async getDirectoryHandle(name: string, options?: {create?: boolean}): Promise<NodeProjectDirectory> {
        const target = this.child(name)
        if (options?.create) await mkdir(target, {recursive: true})
        try {
            if (!(await stat(target)).isDirectory()) throw notFound()
        } catch (error) {
            if (isMissing(error)) throw notFound()
            throw error
        }
        return new NodeProjectDirectory(this.root, target)
    }

    async getFileHandle(name: string, options?: {create?: boolean}) {
        const target = this.child(name)
        if (options?.create) {
            await mkdir(dirname(target), {recursive: true})
            try {
                await stat(target)
            } catch (error) {
                if (!isMissing(error)) throw error
                await writeFile(target, new Uint8Array())
            }
        }
        try {
            if (!(await stat(target)).isFile()) throw notFound()
        } catch (error) {
            if (isMissing(error)) throw notFound()
            throw error
        }
        return this.fileHandle(target)
    }

    async *values() {
        for (const entry of await readdir(this.directory, {withFileTypes: true})) {
            const target = this.child(entry.name)
            if (entry.isSymbolicLink()) throw new Error(`The project contains a symlink: ${this.relativePath(target)}`)
            if (entry.isDirectory()) yield new NodeProjectDirectory(this.root, target)
            else if (entry.isFile()) yield this.fileHandle(target)
        }
    }

    private fileHandle(target: string) {
        return {
            kind: 'file' as const,
            name: basename(target),
            getFile: async () => {
                const [bytes, metadata] = await Promise.all([readFile(target), stat(target)])
                const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
                return new File([arrayBuffer], basename(target), {lastModified: metadata.mtimeMs})
            },
            createWritable: async () => {
                let next: Uint8Array<ArrayBufferLike> = new Uint8Array()
                return {
                    write: async (data: FileSystemWriteChunkType) => { next = await bytesOf(data) },
                    close: async () => { await writeFile(target, next) },
                }
            },
        }
    }

    private child(name: string): string {
        if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
            throw new Error(`Invalid project path segment: ${name}`)
        }
        const target = resolve(this.directory, name)
        this.assertInside(target)
        return target
    }

    private assertInside(target: string): void {
        if (target !== this.root && !target.startsWith(`${this.root}${sep}`)) {
            throw new Error(`Path escapes project: ${target}`)
        }
    }
    private relativePath(target: string): string {
        return target.slice(this.root.length + 1).replaceAll('\\', '/')
    }
}

async function bytesOf(data: FileSystemWriteChunkType): Promise<Uint8Array> {
    if (typeof data === 'string') return new TextEncoder().encode(data)
    if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer())
    if (data instanceof ArrayBuffer) return new Uint8Array(data)
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    if (typeof data === 'object' && data && 'data' in data && data.data != null) {
        return bytesOf(data.data as FileSystemWriteChunkType)
    }
    throw new Error('Unsupported file write value')
}

function isMissing(error: unknown): boolean {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function notFound(): DOMException {
    return new DOMException('Not found', 'NotFoundError')
}
