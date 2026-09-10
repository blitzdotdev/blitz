export const EDITOR_AUTH_TIMEOUT_MS = 5 * 60_000

export interface EditorAuthConfig {
    cloud_origin: string
    broker_page_url: string
}

export interface EditorAuthRequest {
    state: string
    codeVerifier: string
    codeChallenge: string
}

export interface EditorAuthMessage {
    type: 'blitz-editor-auth'
    version: 1
    state: string
    code?: string
    error?: string
}

interface MessageHost {
    addEventListener(type: 'message', listener: (event: MessageEvent) => void): void
    removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void
}

export class EditorAuthFlowError extends Error {
    readonly name = 'EditorAuthFlowError'

    constructor(readonly code: 'popup_blocked' | 'popup_closed' | 'timeout', message: string) {
        super(message)
    }
}

export async function createEditorAuthRequest(cryptoImplementation: Crypto = crypto): Promise<EditorAuthRequest> {
    const stateBytes = new Uint8Array(32)
    const verifierBytes = new Uint8Array(32)
    cryptoImplementation.getRandomValues(stateBytes)
    cryptoImplementation.getRandomValues(verifierBytes)
    const state = base64url(stateBytes)
    const codeVerifier = base64url(verifierBytes)
    const digest = await cryptoImplementation.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier))
    return {state, codeVerifier, codeChallenge: base64url(new Uint8Array(digest))}
}

export async function s256Challenge(codeVerifier: string, cryptoImplementation: Crypto = crypto): Promise<string> {
    const digest = await cryptoImplementation.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier))
    return base64url(new Uint8Array(digest))
}

export function brokerPopupUrl(
    brokerPageUrl: string,
    localOrigin: string,
    state: string,
    codeChallenge: string,
): string {
    const url = new URL(brokerPageUrl)
    url.search = ''
    url.hash = ''
    url.searchParams.set('origin', new URL(localOrigin).origin)
    url.searchParams.set('state', state)
    url.searchParams.set('code_challenge', codeChallenge)
    url.searchParams.set('code_challenge_method', 'S256')
    return url.href
}

export function openEditorAuthPopup(url: string, open: typeof window.open = window.open.bind(window)): Window {
    const popup = open(url, 'blitz-editor-auth', 'popup,width=520,height=680')
    if (!popup) {
        throw new EditorAuthFlowError(
            'popup_blocked',
            'Your browser blocked the Google sign-in window. Allow popups and try again.',
        )
    }
    return popup
}

export function isEditorAuthMessage(
    event: Pick<MessageEvent, 'origin' | 'source' | 'data'>,
    cloudOrigin: string,
    popup: Window,
    state: string,
): event is Pick<MessageEvent<EditorAuthMessage>, 'origin' | 'source' | 'data'> {
    if (event.origin !== cloudOrigin || event.source !== popup) return false
    const data: unknown = event.data
    if (!data || typeof data !== 'object') return false
    const message = data as Record<string, unknown>
    return message.type === 'blitz-editor-auth' && message.version === 1 && message.state === state
}

export function waitForEditorAuthMessage(
    host: MessageHost,
    popup: Window,
    cloudOrigin: string,
    state: string,
    options: {timeoutMs?: number, closePollMs?: number, signal?: AbortSignal} = {},
): Promise<EditorAuthMessage> {
    const timeoutMs = options.timeoutMs ?? EDITOR_AUTH_TIMEOUT_MS
    const closePollMs = options.closePollMs ?? 500
    return new Promise<EditorAuthMessage>((resolve, reject) => {
        const cleanup = () => {
            host.removeEventListener('message', onMessage)
            options.signal?.removeEventListener('abort', onAbort)
            clearTimeout(timeout)
            clearInterval(closed)
        }
        const onAbort = () => {
            cleanup()
            reject(new DOMException('Google sign-in was cancelled.', 'AbortError'))
        }
        const onMessage = (event: MessageEvent) => {
            if (!isEditorAuthMessage(event, cloudOrigin, popup, state)) return
            cleanup()
            resolve(event.data)
        }
        const timeout = setTimeout(() => {
            cleanup()
            popup.close()
            reject(new EditorAuthFlowError('timeout', 'Google sign-in timed out after five minutes. Try again.'))
        }, timeoutMs)
        const closed = setInterval(() => {
            if (!popup.closed) return
            cleanup()
            reject(new EditorAuthFlowError('popup_closed', 'The Google sign-in window closed before it finished.'))
        }, closePollMs)
        host.addEventListener('message', onMessage)
        options.signal?.addEventListener('abort', onAbort, {once: true})
        if (options.signal?.aborted) onAbort()
    })
}

function base64url(bytes: Uint8Array): string {
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
