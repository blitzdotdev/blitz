import {expect, test} from '@playwright/test'
import {
    brokerPopupUrl,
    createEditorAuthRequest,
    isEditorAuthMessage,
    openEditorAuthPopup,
    s256Challenge,
    waitForEditorAuthMessage,
} from '../../src/authBroker.ts'

test('creates independent 32-byte state and verifier values', async () => {
    for (let index = 0; index < 64; index += 1) {
        const request = await createEditorAuthRequest()
        for (const value of [request.state, request.codeVerifier, request.codeChallenge]) {
            expectCanonical32ByteBase64url(value)
        }
        expect(request.state).not.toBe(request.codeVerifier)
        expect(request.codeChallenge).toBe(await s256Challenge(request.codeVerifier))
    }
})

test('computes the RFC 7636 appendix B S256 challenge', async () => {
    expect(await s256Challenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
        'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    )
})

test('puts state and challenge in the popup URL but never the verifier', () => {
    const state = 'state'.padEnd(43, 's')
    const challenge = 'challenge'.padEnd(43, 'c')
    const verifier = 'verifier'.padEnd(43, 'v')
    const value = brokerPopupUrl('https://blitz.dev/auth/editor', 'http://localhost:4321', state, challenge)
    const url = new URL(value)
    expect(url.origin).toBe('https://blitz.dev')
    expect(url.pathname).toBe('/auth/editor')
    expect(url.searchParams.get('origin')).toBe('http://localhost:4321')
    expect(url.searchParams.get('state')).toBe(state)
    expect(url.searchParams.get('code_challenge')).toBe(challenge)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(value).not.toContain(verifier)
})

test('ignores broker messages with the wrong origin, source, state, type, or version', () => {
    const popup = fakePopup()
    const otherPopup = fakePopup()
    const valid = {
        origin: 'https://blitz.dev',
        source: popup,
        data: {type: 'blitz-editor-auth', version: 1, state: 'expected', code: 'code'},
    } as unknown as MessageEvent
    expect(isEditorAuthMessage(valid, 'https://blitz.dev', popup, 'expected')).toBe(true)
    expect(isEditorAuthMessage({...valid, origin: 'https://evil.example'}, 'https://blitz.dev', popup, 'expected')).toBe(false)
    expect(isEditorAuthMessage({...valid, source: otherPopup}, 'https://blitz.dev', popup, 'expected')).toBe(false)
    expect(isEditorAuthMessage({...valid, data: {...valid.data, state: 'wrong'}}, 'https://blitz.dev', popup, 'expected')).toBe(false)
    expect(isEditorAuthMessage({...valid, data: {...valid.data, type: 'other'}}, 'https://blitz.dev', popup, 'expected')).toBe(false)
    expect(isEditorAuthMessage({...valid, data: {...valid.data, version: 2}}, 'https://blitz.dev', popup, 'expected')).toBe(false)
})

test('reports a blocked popup clearly', () => {
    const blocked = (() => null) as unknown as typeof window.open
    expect(() => openEditorAuthPopup('https://blitz.dev/auth/editor', blocked)).toThrow(
        'Your browser blocked the Google sign-in window. Allow popups and try again.',
    )
})

test('reports a popup closed without a result', async () => {
    const host = new MessageHarness()
    const popup = fakePopup()
    const result = waitForEditorAuthMessage(host, popup, 'https://blitz.dev', 'state', {
        timeoutMs: 100,
        closePollMs: 1,
    })
    ;(popup as unknown as {closed: boolean}).closed = true
    await expect(result).rejects.toMatchObject({
        code: 'popup_closed',
        message: 'The Google sign-in window closed before it finished.',
    })
})

test('reports and closes a popup when the five-minute wait times out', async () => {
    const host = new MessageHarness()
    const popup = fakePopup()
    const result = waitForEditorAuthMessage(host, popup, 'https://blitz.dev', 'state', {
        timeoutMs: 5,
        closePollMs: 100,
    })
    await expect(result).rejects.toMatchObject({
        code: 'timeout',
        message: 'Google sign-in timed out after five minutes. Try again.',
    })
    expect(popup.closed).toBe(true)
})

class MessageHarness {
    private listener?: (event: MessageEvent) => void

    addEventListener(_type: 'message', listener: (event: MessageEvent) => void) {
        this.listener = listener
    }

    removeEventListener(_type: 'message', listener: (event: MessageEvent) => void) {
        if (this.listener === listener) this.listener = undefined
    }
}

function fakePopup(): Window {
    return {
        closed: false,
        close() { this.closed = true },
    } as unknown as Window
}

function expectCanonical32ByteBase64url(value: string): void {
    expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='
    const decoded = Uint8Array.from(atob(padded), character => character.charCodeAt(0))
    expect(decoded).toHaveLength(32)
    const reencoded = btoa(String.fromCharCode(...decoded))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')
    expect(reencoded).toBe(value)
}
