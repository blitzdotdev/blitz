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
}

export interface DeployEntry {
    game_id: string
    deploy_token: string
    claim_secret: string
    preview_url: string
    expires_at: string
    last_release_hash?: string
    claimed?: boolean
}

export interface DeploysFile {
    games: Record<string, DeployEntry>
}

export interface ProjectDependency {
    key: string
    version: string
    url?: string
}

export type PublishProgressPhase = 'creating' | 'walking' | 'hashing' | 'uploading' | 'releasing' | 'complete'

export interface PublishProgress {
    phase: PublishProgressPhase
    completed: number
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
