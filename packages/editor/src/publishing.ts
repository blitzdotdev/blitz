export interface DeployView {
    game_id: string
    slug: string
    preview_url: string
    expires_at: string
    last_release_hash?: string
    claimed: boolean
}

export interface SlugAvailability {
    slug: string
    available: boolean
    reason?: 'invalid_slug' | 'reserved_slug' | 'slug_taken'
}

export interface PublishRequest {
    slug?: string
    name?: string
    message?: string
}

export interface PublishResult {
    preview_url: string
    release_hash: string
}

export function slugify(name: string): string {
    let slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/--+/g, '-')
    if (slug.length < 3) slug = `${slug || 'game'}-game`
    slug = slug.slice(0, 49).replace(/-+$/, '')
    return slug
}

export function isExpired(entry: DeployView, now = Date.now()): boolean {
    return !entry.claimed && parseBackendDate(entry.expires_at) <= now
}

export function timeLeft(entry: DeployView, now = Date.now()): string {
    if (entry.claimed) return ''
    const milliseconds = parseBackendDate(entry.expires_at) - now
    if (!Number.isFinite(milliseconds) || milliseconds <= 0) return 'Expired'
    const minutes = Math.ceil(milliseconds / 60_000)
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m left`
}

function parseBackendDate(value: string): number {
    const hasZone = /[zZ]|[+-]\d\d:\d\d$/.test(value)
    return Date.parse(value.replace(' ', 'T') + (hasZone ? '' : 'Z'))
}
