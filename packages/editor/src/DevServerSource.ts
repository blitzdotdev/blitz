import {
    ProjectConflictError,
    type ProjectEvent,
    type ProjectFileEntry,
    type ProjectReadResult,
    type ProjectSource,
} from './ProjectSource.ts'
import type {DeployView, PublishRequest, PublishResult, SlugAvailability} from './publishing.ts'

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

    async deploys(): Promise<{games: DeployView[]}> {
        return this.json('/api/deploys')
    }

    async checkSlug(slug: string): Promise<SlugAvailability> {
        return this.json(`/api/slug/${encodeURIComponent(slug)}`)
    }

    async publish(request: PublishRequest): Promise<PublishResult> {
        return this.json('/api/publish', {
            method: 'POST',
            headers: this.headers({'Content-Type': 'application/json'}),
            body: JSON.stringify(request),
        })
    }

    async authenticate(mode: 'register' | 'login', email: string, password: string): Promise<{token: string}> {
        const body = mode === 'login'
            ? {identity: email, password}
            : {email, password, username: usernameFromEmail(email)}
        return this.json(`/api/auth/${mode}`, {
            method: 'POST',
            headers: this.headers({'Content-Type': 'application/json'}),
            body: JSON.stringify(body),
        })
    }

    async claim(slug: string): Promise<void> {
        await this.json('/api/claim', {
            method: 'POST',
            headers: this.headers({'Content-Type': 'application/json'}),
            body: JSON.stringify({slug}),
        })
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
        const source = new EventSource(this.url(`/api/events?client=${encodeURIComponent(this.clientId)}`))
        const receive = (event: Event) => {
            const message = event as MessageEvent<string>
            listener({type: event.type, ...JSON.parse(message.data)} as ProjectEvent)
        }
        for (const type of ['change', 'add', 'unlink', 'publish', 'command']) {
            source.addEventListener(type, receive)
        }
        return () => source.close()
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
        return new Headers({'X-Blitz-Token': this.token, ...extra})
    }

    private url(path: string): string {
        return new URL(path, this.base).href
    }
}

function usernameFromEmail(email: string): string {
    let username = email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
    if (!/^[a-z]/.test(username)) username = `player_${username}`
    return (username || 'player').slice(0, 30)
}

function encodePath(path: string): string {
    return path.split('/').map(encodeURIComponent).join('/')
}
