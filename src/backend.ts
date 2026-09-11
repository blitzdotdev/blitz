export const DEFAULT_BACKEND_URL = 'https://blitz.dev'

export function resolveBackendUrl(override?: string): string {
    return (override || process.env.BLITZ_BACKEND_URL || DEFAULT_BACKEND_URL).replace(/\/+$/, '')
}
