import type {
    CreatedAnonymousGame,
    GameRecord,
    ReleaseManifest,
    ReleaseRecord,
    RuntimeRecord,
} from './types.ts'

interface ErrorPayload {
    error?: {
        code?: string
        message?: string
        [key: string]: unknown
    }
}

export interface BlitzApiOptions {
    baseUrl: string
    gameId?: string
    token?: string
    fetch?: typeof globalThis.fetch
}

export interface BlobUpload {
    sha256: string
    file: Blob
    path?: string
}

export interface BlobUploadProgress {
    completed: number
    total: number
    bytesUploaded: number
    bytesTotal: number
    path?: string
}

export class BlitzApiError extends Error {
    readonly name = 'BlitzApiError'

    constructor(
        readonly status: number,
        readonly code: string,
        message: string,
        readonly details: Record<string, unknown> = {},
    ) {
        super(message)
    }
}

export class BlitzApi {
    readonly baseUrl: string
    private gameId?: string
    private token?: string
    private readonly fetchImpl: typeof globalThis.fetch

    constructor({baseUrl, gameId, token, fetch: fetchImpl = globalThis.fetch}: BlitzApiOptions) {
        this.baseUrl = baseUrl.replace(/\/+$/, '')
        this.gameId = gameId
        this.token = token
        this.fetchImpl = fetchImpl
    }

    useGame(gameId: string, token: string): this {
        this.gameId = gameId
        this.token = token
        return this
    }

    useToken(token: string): this {
        this.token = token
        return this
    }

    checkSlug(slug: string): Promise<{slug: string; available: boolean; reason?: string}> {
        return this.request(`/api/v1/slugs/${encodeURIComponent(slug)}`, {}, false)
    }

    async createAnonymousGame(options: {slug: string; name?: string; source?: string}): Promise<CreatedAnonymousGame> {
        const query = new URLSearchParams()
        if (options.name) query.set('name', options.name)
        if (options.source) query.set('source', options.source)
        const suffix = query.size ? `?${query}` : ''
        const created = await this.request<CreatedAnonymousGame>(
            `/api/v1/new-game/${encodeURIComponent(options.slug)}${suffix}`,
            {method: 'POST'},
            false,
        )
        this.useGame(created.game_id, created.deploy_token)
        return created
    }

    async getGame(id = this.requireGameId()): Promise<GameRecord> {
        const response = await this.request<{game: GameRecord}>(this.gamePath('', id))
        return response.game
    }

    async missingBlobs(hashes: string[]): Promise<string[]> {
        const response = await this.request<{missing: string[]}>(this.gamePath('/blobs/missing'), {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({hashes}),
        })
        return response.missing
    }

    async uploadBlob(
        hash: string,
        file: Blob,
        onProgress?: (uploaded: number, total: number) => void,
    ): Promise<{sha256: string; size: number; uploaded: boolean}> {
        onProgress?.(0, file.size)
        const result = await this.request<{sha256: string; size: number; uploaded: boolean}>(
            this.gamePath(`/blobs/${encodeURIComponent(hash)}`),
            {
                method: 'PUT',
                headers: {'Content-Type': 'application/octet-stream'},
                body: file,
            },
        )
        onProgress?.(file.size, file.size)
        return result
    }

    async uploadBlobs(
        uploads: BlobUpload[],
        onProgress?: (progress: BlobUploadProgress) => void,
    ): Promise<void> {
        const bytesTotal = uploads.reduce((total, upload) => total + upload.file.size, 0)
        const uploadedByIndex = uploads.map(() => 0)
        let completed = 0
        await mapPool(uploads, 4, async (upload, index) => {
            await this.uploadBlob(upload.sha256, upload.file, (uploaded) => {
                uploadedByIndex[index] = uploaded
                onProgress?.({
                    completed,
                    total: uploads.length,
                    bytesUploaded: uploadedByIndex.reduce((total, value) => total + value, 0),
                    bytesTotal,
                    path: upload.path,
                })
            })
            completed += 1
            onProgress?.({
                completed,
                total: uploads.length,
                bytesUploaded: uploadedByIndex.reduce((total, value) => total + value, 0),
                bytesTotal,
                path: upload.path,
            })
        })
    }

    putRelease(
        manifest: ReleaseManifest,
        options: {message?: string; base_release?: string} = {},
    ): Promise<{release_hash: string; preview_url: string; files: ReleaseManifest['files']}> {
        return this.request(this.gamePath('/releases'), {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({...manifest, ...options}),
        })
    }

    async listReleases(): Promise<Array<{
        release_hash: string
        created_at: string
        message: string | null
        files: number
        active: boolean
    }>> {
        const response = await this.request<{releases: Array<{
            release_hash: string
            created_at: string
            message: string | null
            files: number
            active: boolean
        }> }>(this.gamePath('/releases'))
        return response.releases
    }

    getRelease(hash: string): Promise<ReleaseRecord> {
        return this.request(this.gamePath(`/releases/${encodeURIComponent(hash)}`))
    }

    activate(hash: string): Promise<{release_hash: string; preview_url: string; files: number}> {
        return this.request(this.gamePath(`/releases/${encodeURIComponent(hash)}/activate`), {method: 'POST'})
    }

    getRuntime(version: string): Promise<RuntimeRecord> {
        return this.request(`/api/v1/runtimes/${encodeURIComponent(version)}`, {}, false)
    }

    register(input: {email: string; username: string; password: string; name?: string}): Promise<AuthResponse> {
        return this.request('/api/v1/auth/register', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(input),
        }, false)
    }

    login(input: {identity: string; password: string}): Promise<AuthResponse> {
        return this.request('/api/v1/auth/login', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(input),
        }, false)
    }

    async me(): Promise<Record<string, unknown>> {
        const response = await this.request<{user: Record<string, unknown>}>('/api/v1/auth/me')
        return response.user
    }

    claim(slug: string, secret: string): Promise<{game_id: string; slug: string; owner_id: string; claimed: boolean}> {
        return this.request(`/api/v1/games/${encodeURIComponent(slug)}/claim`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({secret}),
        })
    }

    async downloadBlob(hash: string): Promise<Blob> {
        const response = await this.rawRequest(this.gamePath(`/blobs/${encodeURIComponent(hash)}`))
        return response.blob()
    }

    private gamePath(suffix: string, id = this.requireGameId()): string {
        return `/api/v1/games/${encodeURIComponent(id)}${suffix}`
    }

    private requireGameId(): string {
        if (!this.gameId) throw new Error('A game ID or slug is required for this API call.')
        return this.gameId
    }

    private async request<T>(path: string, init: RequestInit = {}, authenticated = true): Promise<T> {
        const response = await this.rawRequest(path, init, authenticated)
        if (response.status === 204) return undefined as T
        return response.json() as Promise<T>
    }

    private async rawRequest(path: string, init: RequestInit = {}, authenticated = true): Promise<Response> {
        const headers = new Headers(init.headers)
        if (authenticated) {
            if (!this.token) throw new Error('A Bearer token is required for this API call.')
            headers.set('Authorization', `Bearer ${this.token}`)
        }
        const response = await this.fetchImpl(`${this.baseUrl}${path}`, {...init, headers})
        if (response.ok) return response

        let payload: ErrorPayload = {}
        try {
            payload = await response.clone().json() as ErrorPayload
        } catch {
            // Some edge responses have a plain-text body.
        }
        const code = payload.error?.code || `http_${response.status}`
        const message = payload.error?.message || response.statusText || `HTTP ${response.status}`
        const details = payload.error ? {...payload.error} : {}
        delete details.code
        delete details.message
        throw new BlitzApiError(response.status, code, message, details)
    }
}

interface AuthResponse {
    user: Record<string, unknown>
    token: string
    refresh_token: string
}

async function mapPool<T>(
    values: T[],
    concurrency: number,
    task: (value: T, index: number) => Promise<void>,
): Promise<void> {
    let nextIndex = 0
    const workers = Array.from({length: Math.min(concurrency, values.length)}, async () => {
        while (nextIndex < values.length) {
            const index = nextIndex
            nextIndex += 1
            await task(values[index], index)
        }
    })
    await Promise.all(workers)
}
