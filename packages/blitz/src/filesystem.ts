import type {ProjectEntry} from './types.ts'

const EXCLUDED_DIRECTORIES = new Set(['.blitz', '.git', 'node_modules', 'dist'])

/**
 * Walk a project using only the fixed release exclusions. Project .gitignore
 * rules are deliberately not interpreted.
 */
export async function walkProject(dirHandle: FileSystemDirectoryHandle): Promise<ProjectEntry[]> {
    const entries: ProjectEntry[] = []
    await walkDirectory(dirHandle, '', entries)
    return entries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
}

async function walkDirectory(
    directory: FileSystemDirectoryHandle,
    prefix: string,
    result: ProjectEntry[],
): Promise<void> {
    for await (const handle of directory.values()) {
        if (handle.name.startsWith('.')) continue
        const path = prefix ? `${prefix}/${handle.name}` : handle.name
        if (handle.kind === 'directory') {
            if (EXCLUDED_DIRECTORIES.has(handle.name)) continue
            await walkDirectory(handle, path, result)
        } else {
            result.push({path, file: await handle.getFile()})
        }
    }
}

export async function readProjectFile(
    dirHandle: FileSystemDirectoryHandle,
    path: string,
): Promise<File | undefined> {
    const parts = cleanPathParts(path)
    if (!parts.length) return undefined
    try {
        let directory = dirHandle
        for (const part of parts.slice(0, -1)) {
            directory = await directory.getDirectoryHandle(part)
        }
        return await (await directory.getFileHandle(parts[parts.length - 1])).getFile()
    } catch (error) {
        if (isNotFoundError(error)) return undefined
        throw error
    }
}

export async function writeProjectFile(
    dirHandle: FileSystemDirectoryHandle,
    path: string,
    data: FileSystemWriteChunkType,
): Promise<File> {
    const parts = cleanPathParts(path)
    if (!parts.length) throw new Error('A project file path is required.')
    let directory = dirHandle
    for (const part of parts.slice(0, -1)) {
        directory = await directory.getDirectoryHandle(part, {create: true})
    }
    const fileHandle = await directory.getFileHandle(parts[parts.length - 1], {create: true})
    const writable = await fileHandle.createWritable()
    await writable.write(data)
    await writable.close()
    return fileHandle.getFile()
}

function cleanPathParts(path: string): string[] {
    const parts = path.split('/')
    if (parts.some((part) => !part || part === '.' || part === '..' || part.includes('\\'))) {
        throw new Error(`Invalid project path: ${path}`)
    }
    return parts
}

function isNotFoundError(error: unknown): boolean {
    return error instanceof DOMException
        ? error.name === 'NotFoundError'
        : error instanceof Error && error.name === 'NotFoundError'
}
