import {
    ProjectConflictError,
    type ProjectEvent,
    type ProjectFileEntry,
    type ProjectReadResult,
    type ProjectSource,
} from './ProjectSource.ts'

export class DevServerRequestError extends Error {
    readonly name = 'DevServerRequestError'

    constructor(readonly status: number, readonly code: string, message: string) {
        super(message)
    }
}

export class DevServerSource implements ProjectSource {
    readonly clientId = crypto.randomUUID()
    private readonly token: string
    private readonly base: URL

    constructor(locationUrl = location.href) {
        const url = new URL(locationUrl)
        const token = url.searchParams.get('t')
        if (!token) throw new Error('Open the tokenized URL printed by kite3d dev.')
        this.token = token
        this.base = new URL('/', url)
    }

    async list(): Promise<ProjectFileEntry[]> {
        return this.json('/api/files')
    }

    async listDirectories(): Promise<string[]> {
        const result = await this.json<{directories: string[]}>('/api/directories')
        return result.directories
    }

    async createDirectory(path: string): Promise<void> {
        await this.json('/api/directories', {
            method: 'POST',
            headers: this.headers({'Content-Type': 'application/json'}),
            body: JSON.stringify({path}),
        })
    }

    async state(): Promise<Record<string, unknown>> {
        return this.json('/api/state')
    }

    async read(path: string): Promise<ProjectReadResult> {
        const response = await fetch(this.url(`/files/${encodePath(path)}`), {headers: this.headers()})
        if (!response.ok) throw new Error(`Cannot read ${path}: ${response.status}`)
        const etag = response.headers.get('ETag')
        return {bytes: new Uint8Array(await response.arrayBuffer()), sha256: etag?.replace(/"/g, '') || ''}
    }

    async write(path: string, bytes: Uint8Array, ifMatch: string | '*'): Promise<{sha256: string}> {
        const response = await fetch(this.url(`/files/${encodePath(path)}`), {
            method: 'PUT',
            headers: this.headers({
                'Content-Type': 'application/octet-stream',
                'If-Match': ifMatch === '*' ? '*' : `"${ifMatch}"`,
                'X-Kite3D-Client': this.clientId,
            }),
            body: bytes as BodyInit,
        })
        if (response.status === 412) {
            const body = await response.json().catch(() => ({})) as {sha256?: string}
            throw new ProjectConflictError(path, body.sha256)
        }
        if (!response.ok) throw new Error(`Cannot write ${path}: ${response.status}`)
        return response.json() as Promise<{sha256: string}>
    }

    async delete(path: string): Promise<void> {
        const response = await fetch(this.url(`/files/${encodePath(path)}`), {
            method: 'DELETE',
            headers: this.headers({'X-Kite3D-Client': this.clientId}),
        })
        if (!response.ok && response.status !== 404) throw new Error(`Cannot delete ${path}: ${response.status}`)
    }

    events(listener: (event: ProjectEvent) => void): () => void {
        const source = new EventSource(this.url(`/api/events?client=${encodeURIComponent(this.clientId)}`))
        const receive = (event: Event) => {
            const message = event as MessageEvent<string>
            listener({type: event.type, ...JSON.parse(message.data)} as ProjectEvent)
        }
        for (const type of ['change', 'add', 'unlink', 'command']) {
            source.addEventListener(type, receive)
        }
        return () => source.close()
    }

    fileUrl(path: string, sha256?: string, reloadRevision?: string): string {
        const url = new URL(`/files/${encodePath(path)}`, this.base)
        if (sha256) url.searchParams.set('v', sha256)
        if (reloadRevision) url.searchParams.set('r', reloadRevision)
        return url.href
    }

    async screenshotResult(id: string, blob: Blob): Promise<void> {
        const response = await fetch(this.url(`/api/screenshot/${encodeURIComponent(id)}`), {
            method: 'POST',
            headers: this.headers({'Content-Type': 'image/png'}),
            body: blob,
        })
        if (response.status === 404) return
        if (!response.ok) throw new Error(`Cannot return screenshot: ${response.status}`)
    }

    private async json<T>(path: string, init?: RequestInit): Promise<T> {
        const response = await fetch(this.url(path), init || {headers: this.headers()})
        if (!response.ok) {
            const body = await response.json().catch(() => ({})) as {error?: {code?: string, message?: string}}
            throw new DevServerRequestError(
                response.status,
                body.error?.code || `http_${response.status}`,
                body.error?.message || `${path} failed: ${response.status}`,
            )
        }
        return response.json() as Promise<T>
    }

    private headers(extra: Record<string, string> = {}): Headers {
        return new Headers({'X-Kite3D-Token': this.token, ...extra})
    }

    private url(path: string): string {
        return new URL(path, this.base).href
    }
}

function encodePath(path: string): string {
    return path.split('/').map(encodeURIComponent).join('/')
}
