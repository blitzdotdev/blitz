import {
    ProjectConflictError,
    type ProjectEvent,
    type ProjectFileEntry,
    type ProjectReadResult,
    type ProjectSource,
} from './ProjectSource.ts'
import type {
    DeployView,
    PublishProgress,
    PublishRequest,
    PublishResult,
    PublishStatusView,
    SlugAvailability,
} from './publishing.ts'

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

    async deploys(): Promise<{games: DeployView[], last_publish?: PublishStatusView}> {
        return this.json('/api/deploys')
    }

    async checkSlug(slug: string): Promise<SlugAvailability> {
        return this.json(`/api/slug/${encodeURIComponent(slug)}`)
    }

    async publish(request: PublishRequest, onProgress?: (progress: PublishProgress) => void): Promise<PublishResult> {
        const response = await fetch(this.url('/api/publish'), {
            method: 'POST',
            headers: this.headers({'Content-Type': 'application/json'}),
            body: JSON.stringify(request),
        })
        if (!response.ok) {
            const body = await response.json().catch(() => ({})) as {error?: {code?: string, message?: string}}
            throw new DevServerRequestError(
                response.status,
                body.error?.code || `http_${response.status}`,
                body.error?.message || `/api/publish failed: ${response.status}`,
            )
        }
        if (!response.body || !response.headers.get('Content-Type')?.includes('text/event-stream')) {
            throw new Error('The publish route did not return an event stream.')
        }
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let result: PublishResult | undefined
        let streamDone = false
        while (!streamDone) {
            const chunk = await reader.read()
            streamDone = chunk.done
            buffer += decoder.decode(chunk.value || new Uint8Array(), {stream: !chunk.done}).replace(/\r\n/g, '\n')
            const blocks = buffer.split('\n\n')
            buffer = blocks.pop() || ''
            for (const block of blocks) {
                const event = block.split('\n').find((line) => line.startsWith('event:'))?.slice(6).trim()
                const data = block.split('\n').filter((line) => line.startsWith('data:'))
                    .map((line) => line.slice(5).trimStart()).join('\n')
                if (!event || !data) continue
                const payload = JSON.parse(data) as Record<string, unknown>
                if (event === 'publish:progress') {
                    onProgress?.(payload as unknown as PublishProgress)
                } else if (event === 'publish:result') {
                    result = payload as unknown as PublishResult
                } else if (event === 'publish:error') {
                    await reader.cancel()
                    throw new DevServerRequestError(
                        typeof payload.status === 'number' ? payload.status : 500,
                        typeof payload.code === 'string' ? payload.code : 'publish_failed',
                        typeof payload.message === 'string' ? payload.message : 'Publishing failed.',
                    )
                }
            }
        }
        if (!result) throw new Error('The publish stream ended before returning a result.')
        return result
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

    async authenticateWithGoogle(credential: string, selectBy?: string): Promise<{token: string}> {
        const csrfToken = readCookie('g_csrf_token')
        if (!csrfToken) throw new Error('Google sign-in did not provide its CSRF cookie.')
        return this.json('/api/auth/google', {
            method: 'POST',
            headers: this.headers({'Content-Type': 'application/json'}),
            body: JSON.stringify({credential, g_csrf_token: csrfToken, select_by: selectBy}),
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
        for (const type of ['change', 'add', 'unlink', 'publish:progress', 'command']) {
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

function usernameFromEmail(email: string): string {
    let username = email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
    if (!/^[a-z]/.test(username)) username = `player_${username}`
    return (username || 'player').slice(0, 30)
}

function encodePath(path: string): string {
    return path.split('/').map(encodeURIComponent).join('/')
}

function readCookie(name: string): string | undefined {
    const prefix = `${encodeURIComponent(name)}=`
    const value = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix))
    return value ? decodeURIComponent(value.slice(prefix.length)) : undefined
}
