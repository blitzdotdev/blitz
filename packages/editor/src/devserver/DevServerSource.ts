export interface ProjectFileEntry {
    path: string
    size: number
    sha256: string
    mtime: number
}

export interface ProjectReadResult {
    bytes: Uint8Array<ArrayBuffer>
    sha256: string
}

export interface ProjectState {
    hub?: true
    name?: string
    versions?: Record<string, string>
}

export type ProjectFileEvent = {type: 'change' | 'add' | 'unlink', path: string, sha256?: string, client?: string}

export type ProjectEvent =
    | ProjectFileEvent
    | {type: 'command', id: string, command: 'screenshot', options: {name?: string, width?: number, height?: number}}

/** A write the server refused: the file on disk is not the one the write was based on. */
export class ProjectConflictError extends Error {
    constructor(readonly path: string, readonly sha256?: string) {
        super(`${path} changed on disk`)
    }
}

/**
 * The routes of `kite3d dev`. This is the only file that knows them.
 * The token comes from `?t=` on the URL the CLI prints.
 */
export class DevServerSource {
    readonly clientId = crypto.randomUUID()
    private readonly token: string

    constructor(readonly base = new URL('/', location.href)) {
        const token = new URL(location.href).searchParams.get('t')
        if (!token) throw new Error('Open the tokenized URL printed by kite3d dev.')
        this.token = token
    }

    async list(): Promise<ProjectFileEntry[]> {
        return this.json('/api/files')
    }

    async listDirectories(): Promise<string[]> {
        return (await this.json<{directories: string[]}>('/api/directories')).directories
    }

    async createDirectory(path: string) {
        await this.json('/api/directories', {
            method: 'POST',
            body: JSON.stringify({path}),
            headers: {'Content-Type': 'application/json'},
        })
    }

    async state(): Promise<ProjectState> {
        return this.json('/api/state')
    }

    async read(path: string, sha256?: string): Promise<ProjectReadResult> {
        // ?v=<sha> makes the URL unique per version; no-cache revalidates against the ETag when the sha is unknown
        const res = await fetch(this.fileUrl(path, sha256), {headers: this.headers(), cache: 'no-cache'})
        if (!res.ok) throw new Error(`Cannot read ${path}: ${res.status}`)
        return {
            bytes: new Uint8Array(await res.arrayBuffer()),
            sha256: (res.headers.get('etag') || '').replace(/"/g, ''),
        }
    }

    /** Writes when the file is still at `ifMatch`, or unconditionally when that is `'*'`. */
    async write(path: string, bytes: Blob | Uint8Array<ArrayBuffer> | string, ifMatch: string | '*'): Promise<{sha256: string}> {
        return this.put(path, bytes, {'If-Match': ifMatch === '*' ? '*' : `"${ifMatch}"`})
    }

    /** Writes only when the path is free, so a file this tab has never seen is never truncated. */
    async create(path: string, bytes: Blob | Uint8Array<ArrayBuffer> | string): Promise<{sha256: string}> {
        return this.put(path, bytes, {'If-None-Match': '*'})
    }

    async delete(path: string) {
        const res = await fetch(this.fileUrl(path), {method: 'DELETE', headers: this.headers()})
        if (!res.ok && res.status !== 404) throw new Error(`Cannot delete ${path}: ${res.status}`)
    }

    events(listener: (event: ProjectEvent) => void): () => void {
        const source = new EventSource(`/api/events?client=${encodeURIComponent(this.clientId)}`)
        for (const type of ['change', 'add', 'unlink', 'command'] as const) {
            source.addEventListener(type, (e) => listener({type, ...JSON.parse((e as MessageEvent).data)}))
        }
        return () => source.close()
    }

    private async put(path: string, bytes: Blob | Uint8Array<ArrayBuffer> | string, precondition: Record<string, string>): Promise<{sha256: string}> {
        const res = await fetch(this.fileUrl(path), {
            method: 'PUT',
            body: bytes,
            headers: this.headers({'Content-Type': 'application/octet-stream', ...precondition}),
        })
        if (res.status === 412) throw new ProjectConflictError(path, (await res.json()).sha256)
        if (!res.ok) throw new Error(`Cannot write ${path}: ${res.status}`)
        return res.json()
    }

    /** `?v=` is the file's own version, `?r=` the page revision that forces a module to import fresh. */
    fileUrl(path: string, sha256?: string, revision?: number): string {
        const url = new URL('/files/' + path.split('/').map(encodeURIComponent).join('/'), this.base)
        if (sha256) url.searchParams.set('v', sha256)
        if (revision) url.searchParams.set('r', String(revision))
        return url.href
    }

    private headers(extra: Record<string, string> = {}) {
        return {'X-Kite3D-Token': this.token, 'X-Kite3D-Client': this.clientId, ...extra}
    }

    async json<T>(path: string, init: RequestInit = {}): Promise<T> {
        const res = await fetch(new URL(path, this.base), {
            ...init,
            headers: this.headers(init.headers as Record<string, string>),
        })
        if (!res.ok) {
            // A failure body is {error: {code, message}}, and that message is the one a user can act on.
            const body = await res.json().catch(() => null) as {error?: {message?: string}} | null
            throw new Error(body?.error?.message || `${path}: ${res.status}`)
        }
        return res.json()
    }
}
