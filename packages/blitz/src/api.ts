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
    requestTimeoutMs?: number
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
        readonly retryAfterMs?: number,
    ) {
        super(sanitizeDiagnostic(message))
    }
}

const MAX_REQUEST_ATTEMPTS = 5
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000

export class BlitzApi {
    readonly baseUrl: string
    private gameId?: string
    private token?: string
    private readonly fetchImpl: typeof globalThis.fetch
    private readonly requestTimeoutMs: number

    constructor({
        baseUrl,
        gameId,
        token,
        fetch: fetchImpl = globalThis.fetch,
        requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    }: BlitzApiOptions) {
        this.baseUrl = baseUrl.replace(/\/+$/, '')
        this.gameId = gameId
        this.token = token
        this.fetchImpl = fetchImpl
        this.requestTimeoutMs = requestTimeoutMs
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
        const path = this.gamePath(`/blobs/${encodeURIComponent(hash)}`)
        for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt += 1) {
            try {
                const response = await this.rawRequest(path, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/octet-stream',
                        'Content-Length': String(file.size),
                    },
                    body: file,
                }, true, false)
                const result = await response.json() as {sha256: string; size: number; uploaded: boolean}
                onProgress?.(file.size, file.size)
                return result
            } catch (error) {
                if (!isTransientError(error) || attempt === MAX_REQUEST_ATTEMPTS) throw error
                let exists: boolean
                try {
                    exists = await this.hasBlob(hash)
                } catch (reconciliationError) {
                    throw new Error(`Could not confirm whether blob ${hash} was saved; refusing an uncertain retry: ${sanitizeDiagnostic(errorMessage(reconciliationError))}`)
                }
                if (exists) {
                    onProgress?.(file.size, file.size)
                    return {sha256: hash, size: file.size, uploaded: false}
                }
                await wait(retryDelay(error, attempt))
            }
        }
        throw new Error(`Blob upload failed after ${MAX_REQUEST_ATTEMPTS} attempts.`)
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
        options: {message?: string; base_release?: string; metadata?: {description?: string}} = {},
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

    async claim(slug: string, secret: string): Promise<{game_id: string; slug: string; owner_id: string; claimed: boolean}> {
        try {
            return await this.request<{game_id: string; slug: string; owner_id: string; claimed: boolean}>(`/api/v1/games/${encodeURIComponent(slug)}/claim`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({secret}),
            })
        } catch (error) {
            if (!(error instanceof Error)) throw new Error(sanitizeDiagnostic(error, [secret]))
            const safe = new Error(sanitizeDiagnostic(error.message, [secret]))
            Object.assign(safe, error, {message: safe.message})
            throw safe
        }
    }

    async downloadBlob(hash: string): Promise<Blob> {
        const response = await this.rawRequest(this.gamePath(`/blobs/${encodeURIComponent(hash)}`))
        return response.blob()
    }

    async downloadPublicFile(url: string): Promise<Blob> {
        // Verification owns its five-attempt readiness loop, so do not nest the
        // generic request retry loop here.
        const response = await this.rawRequest(url, {}, false, false)
        return response.blob()
    }

    async hasBlob(hash: string): Promise<boolean> {
        try {
            await this.rawRequest(this.gamePath(`/blobs/${encodeURIComponent(hash)}`), {method: 'HEAD'})
            return true
        } catch (error) {
            if (error instanceof BlitzApiError && error.status === 404) return false
            throw error
        }
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

    private async rawRequest(
        path: string,
        init: RequestInit = {},
        authenticated = true,
        retry = true,
    ): Promise<Response> {
        const headers = new Headers(init.headers)
        if (authenticated) {
            if (!this.token) throw new Error('A Bearer token is required for this API call.')
            headers.set('Authorization', `Bearer ${this.token}`)
        }
        const url = /^https?:\/\//.test(path) ? path : `${this.baseUrl}${path}`
        const attempts = retry ? MAX_REQUEST_ATTEMPTS : 1
        let lastError: unknown
        for (let attempt = 1; attempt <= attempts; attempt += 1) {
            try {
                const response = await this.fetchResponse(url, {...init, headers})
                if (response.ok) return response
                const error = await apiError(response)
                if (!isTransientError(error) || attempt === attempts) throw error
                lastError = error
                await wait(retryDelay(error, attempt))
            } catch (error) {
                const safeError = error instanceof BlitzApiError ? error : transportError(init.method || 'GET', error)
                if (!isTransientError(safeError) || attempt === attempts
                    || (!(safeError instanceof BlitzApiError) && !isRetryableMethod(init.method, path))) throw safeError
                lastError = safeError
                await wait(retryDelay(safeError, attempt))
            }
        }
        throw lastError
    }

    private async fetchResponse(url: string, init: RequestInit): Promise<Response> {
        const controller = new AbortController()
        const abort = () => controller.abort()
        init.signal?.addEventListener('abort', abort, {once: true})
        const timer = setTimeout(abort, this.requestTimeoutMs)
        try {
            const response = await this.fetchImpl(url, {...init, signal: controller.signal})
            const body = requestHasNoResponseBody(init.method, response.status)
                ? null
                : await response.arrayBuffer()
            return new Response(body, {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
            })
        } finally {
            clearTimeout(timer)
            init.signal?.removeEventListener('abort', abort)
        }
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

async function apiError(response: Response): Promise<BlitzApiError> {
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
    return new BlitzApiError(response.status, code, message, details, retryAfter(response.headers.get('Retry-After')))
}

function transportError(method: string, error: unknown): Error {
    const code = error instanceof Error && 'code' in error ? String(error.code) : error instanceof Error ? error.name : 'transport_error'
    return Object.assign(new Error(`${method.toUpperCase()} request lost its connection (${sanitizeDiagnostic(code)}).`), {
        name: 'BlitzTransportError',
        transient: true,
    })
}

function isTransientError(error: unknown): boolean {
    return error instanceof BlitzApiError
        ? error.status === 429 || error.status >= 500
        : Boolean(error && typeof error === 'object' && 'transient' in error && error.transient === true)
}

function isRetryableMethod(method = 'GET', path: string): boolean {
    const normalized = method.toUpperCase()
    return ['GET', 'HEAD', 'PUT', 'DELETE'].includes(normalized)
        || (normalized === 'POST' && path.endsWith('/blobs/missing'))
}

function retryAfter(value: string | null): number | undefined {
    if (!value) return undefined
    const seconds = Number(value)
    const milliseconds = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(value) - Date.now()
    return Number.isFinite(milliseconds) ? Math.max(0, Math.min(milliseconds, 10_000)) : undefined
}

function retryDelay(error: unknown, attempt: number): number {
    const requested = error instanceof BlitzApiError ? error.retryAfterMs : undefined
    return requested ?? Math.min(100 * 2 ** (attempt - 1), 1_000)
}

function wait(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function requestHasNoResponseBody(method: string | undefined, status: number): boolean {
    return method?.toUpperCase() === 'HEAD' || status === 204 || status === 205 || status === 304
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

export function sanitizeDiagnostic(value: unknown, secrets: string[] = []): string {
    let result = String(value)
        .replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [redacted]')
        .replace(/\btp_[A-Za-z0-9_-]+\b/g, '[redacted]')
        .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted]')
    for (const secret of secrets.filter(Boolean)) {
        result = result.replace(new RegExp(escapeRegExp(secret), 'g'), '[redacted]')
    }
    return result
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
