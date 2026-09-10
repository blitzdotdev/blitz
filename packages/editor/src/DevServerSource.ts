import {
    ProjectConflictError,
    type ProjectEvent,
    type ProjectFileEntry,
    type ProjectReadResult,
    type ProjectSource,
} from './ProjectSource.ts'

export class DevServerSource implements ProjectSource {
    readonly clientId = crypto.randomUUID()
    private readonly token: string
    private readonly base: URL

    constructor(locationUrl = location.href) {
        const url = new URL(locationUrl)
        const token = url.searchParams.get('t')
        if (!token) throw new Error('Open the tokenized URL printed by blitz dev.')
        this.token = token
        this.base = new URL('/', url)
    }

    async list(): Promise<ProjectFileEntry[]> {
        return this.json('/api/files')
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
                'X-Blitz-Client': this.clientId,
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
            headers: this.headers({'X-Blitz-Client': this.clientId}),
        })
        if (!response.ok && response.status !== 404) throw new Error(`Cannot delete ${path}: ${response.status}`)
    }

    events(listener: (event: ProjectEvent) => void): () => void {
        const controller = new AbortController()
        this.readEvents(listener, controller.signal).catch((error) => {
            if (!controller.signal.aborted) console.error('[blitz] Event stream stopped', error)
        })
        return () => controller.abort()
    }

    fileUrl(path: string, sha256?: string): string {
        const url = new URL(`/files/${encodePath(path)}`, this.base)
        if (sha256) url.searchParams.set('v', sha256)
        return url.href
    }

    async bake(nodeName: string, force = false): Promise<Record<string, unknown>> {
        return this.json('/api/bake', {
            method: 'POST',
            headers: this.headers({'Content-Type': 'application/json'}),
            body: JSON.stringify({nodeName, force}),
        })
    }

    async commandResult(id: string, result: Record<string, unknown>): Promise<void> {
        await this.json(`/api/commands/${encodeURIComponent(id)}`, {
            method: 'POST',
            headers: this.headers({'Content-Type': 'application/json'}),
            body: JSON.stringify(result),
        })
    }

    private async readEvents(listener: (event: ProjectEvent) => void, signal: AbortSignal): Promise<void> {
        const response = await fetch(this.url('/api/events'), {
            headers: this.headers({'X-Blitz-Client': this.clientId}),
            signal,
        })
        if (!response.ok || !response.body) throw new Error(`Cannot watch project: ${response.status}`)
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffered = ''
        while (!signal.aborted) {
            const {done, value} = await reader.read()
            if (done) break
            buffered += decoder.decode(value, {stream: true})
            let boundary = buffered.indexOf('\n\n')
            while (boundary >= 0) {
                const frame = buffered.slice(0, boundary)
                buffered = buffered.slice(boundary + 2)
                const eventName = frame.match(/^event: (.+)$/m)?.[1]
                const data = frame.match(/^data: (.+)$/m)?.[1]
                if (eventName && data) listener({type: eventName, ...JSON.parse(data)} as ProjectEvent)
                boundary = buffered.indexOf('\n\n')
            }
        }
    }

    private async json<T>(path: string, init?: RequestInit): Promise<T> {
        const response = await fetch(this.url(path), init || {headers: this.headers()})
        if (!response.ok) {
            const body = await response.json().catch(() => ({})) as {error?: {message?: string}}
            throw new Error(body.error?.message || `${path} failed: ${response.status}`)
        }
        return response.json() as Promise<T>
    }

    private headers(extra: Record<string, string> = {}): Headers {
        return new Headers({'X-Blitz-Token': this.token, ...extra})
    }

    private url(path: string): string {
        return new URL(path, this.base).href
    }
}

function encodePath(path: string): string {
    return path.split('/').map(encodeURIComponent).join('/')
}
