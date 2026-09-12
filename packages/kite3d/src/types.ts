export interface ProjectEntry {
    path: string
    file: File
}

export interface ManifestFile {
    sha256: string
    size: number
    mime?: string
}

export interface ReleaseManifest {
    files: Record<string, ManifestFile>
}

export interface RuntimeRecord {
    version: string
    sha256: string
    size: number
    runtimes?: Array<{
        sha256: string
        size: number
        created_at: string
    }>
}

export interface DeployEntry {
    game_id: string
    deploy_token: string
    claim_secret: string
    claim_url?: string
    preview_url: string
    expires_at: string
    last_release_hash?: string
    claimed?: boolean
}

export interface DeploysFile {
    games: Record<string, DeployEntry>
    last_publish?: PublishStatus
}

export interface PublishStatus {
    slug: string
    status: 'publishing' | 'succeeded' | 'failed'
    updated_at: string
    release_hash?: string
    error?: string
    error_status?: number
    error_code?: string
}

export interface ProjectDependency {
    key: string
    version: string
    url?: string
}

export type PublishProgressPhase = 'creating' | 'walking' | 'hashing' | 'uploading' | 'releasing' | 'verifying' | 'complete'

export interface PublishProgress {
    phase: PublishProgressPhase
    done: number
    total: number
    path?: string
    preview_url?: string
}

export interface CreatedAnonymousGame extends DeployEntry {
    slug: string
    name: string
    state: string
}

export interface GameRecord {
    id: string
    slug: string
    name: string
    active_release: string | null
    [key: string]: unknown
}

export interface ReleaseRecord extends ReleaseManifest {
    release_hash: string
    message: string | null
    created_at: string
    active: boolean
}
