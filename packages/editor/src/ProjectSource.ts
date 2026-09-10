export interface ProjectFileEntry {
    path: string
    size: number
    sha256: string
    mtime: number
}

export interface ProjectReadResult {
    bytes: Uint8Array
    sha256: string
}

export interface ProjectEvent {
    type: 'change' | 'add' | 'unlink' | 'publish:progress' | 'command'
    path?: string
    sha256?: string
    client?: string
    [key: string]: unknown
}

export interface ProjectSource {
    readonly clientId: string
    list(): Promise<ProjectFileEntry[]>
    read(path: string): Promise<ProjectReadResult>
    write(path: string, bytes: Uint8Array, ifMatch: string | '*'): Promise<{sha256: string}>
    delete(path: string): Promise<void>
    events(listener: (event: ProjectEvent) => void): () => void
    bake?(nodeName: string, force?: boolean): Promise<Record<string, unknown>>
    checkpoint?(label?: string): Promise<{hash: string, label?: string}>
    restore?(hash?: string): Promise<{hash: string}>
    commandResult?(id: string, result: Record<string, unknown>): Promise<void>
}

export class ProjectConflictError extends Error {
    constructor(readonly path: string, readonly sha256?: string) {
        super(`${path} changed on disk`)
        this.name = 'ProjectConflictError'
    }
}
