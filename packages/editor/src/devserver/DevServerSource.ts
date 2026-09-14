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

    async write(path: string, bytes: Blob | Uint8Array<ArrayBuffer> | string, ifMatch: string | '*'): Promise<{sha256: string}> {
        const res = await fetch(this.fileUrl(path), {
            method: 'PUT',
            body: bytes,
            headers: this.headers({
                'Content-Type': 'application/octet-stream',
                'If-Match': ifMatch === '*' ? '*' : `"${ifMatch}"`,
            }),
        })
        if (!res.ok) throw new Error(`Cannot write ${path}: ${res.status}`)
        return res.json()
    }

    private fileUrl(path: string, sha256?: string): string {
        const url = new URL('/files/' + path.split('/').map(encodeURIComponent).join('/'), this.base)
        if (sha256) url.searchParams.set('v', sha256)
        return url.href
    }

    private headers(extra: Record<string, string> = {}) {
        return {'X-Kite3D-Token': this.token, 'X-Kite3D-Client': this.clientId, ...extra}
    }

    private async json<T>(path: string, init: RequestInit = {}): Promise<T> {
        const res = await fetch(new URL(path, this.base), {
            ...init,
            headers: this.headers(init.headers as Record<string, string>),
        })
        if (!res.ok) throw new Error(`${path}: ${res.status}`)
        return res.json()
    }
}
