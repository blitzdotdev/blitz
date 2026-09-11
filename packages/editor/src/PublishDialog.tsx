import {useCallback, useEffect, useMemo, useRef, useState, type FormEvent} from 'react'
import {
    AnchorButton,
    Button,
    ButtonGroup,
    Callout,
    Dialog,
    FormGroup,
    InputGroup,
    Intent,
    ProgressBar,
} from '@blueprintjs/core'
import {DevServerRequestError, DevServerSource} from './DevServerSource.ts'
import {isExpired, slugify, timeLeft, type DeployView} from './publishing.ts'

interface PublishDialogProps {
    isOpen: boolean
    name: string
    source: DevServerSource
    beforePublish(): Promise<boolean>
    onClose(): void
}

type Availability = 'checking' | 'available' | 'taken' | 'reserved' | 'invalid' | 'error'
type RetryAction = 'publish' | 'claim'
const GOOGLE_CLIENT_ID = '118090436804-rqddo4q5qof92bejmslrrtglnrtb23k1.apps.googleusercontent.com'
const GOOGLE_SCRIPT_URL = 'https://accounts.google.com/gsi/client'
const GOOGLE_CREDENTIAL_WAIT_MS = 4_000

interface GoogleCredentialResponse {
    credential?: string
    select_by?: string
}

interface GooglePromptNotification {
    isNotDisplayed?(): boolean
    getNotDisplayedReason?(): string
}

interface GoogleIdentity {
    initialize(config: {client_id: string, callback(response: GoogleCredentialResponse): void}): void
    renderButton(parent: HTMLElement, options: {
        type: string
        theme: string
        size: string
        text: string
        click_listener(): void
    }): void
    prompt?(listener: (notification: GooglePromptNotification) => void): void
}

declare global {
    interface Window {
        google?: {accounts?: {id?: GoogleIdentity}}
    }
}

let googleIdentityPromise: Promise<GoogleIdentity> | undefined
let googleInitialized = false
let googleCredentialHandler: ((response: GoogleCredentialResponse) => void) | undefined

export function PublishDialog({isOpen, name, source, beforePublish, onClose}: PublishDialogProps) {
    const [deploys, setDeploys] = useState<DeployView[]>()
    const [slug, setSlug] = useState('')
    const [availability, setAvailability] = useState<Availability>('checking')
    const [availabilityNonce, setAvailabilityNonce] = useState(0)
    const [publishing, setPublishing] = useState(false)
    const [progress, setProgress] = useState({phase: '', done: 0, total: 1})
    const [error, setError] = useState('')
    const [retryAction, setRetryAction] = useState<RetryAction>()
    const [fallbackUrl, setFallbackUrl] = useState('')
    const [popupBlocked, setPopupBlocked] = useState(false)
    const [authMode, setAuthMode] = useState<'register' | 'login'>('register')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [authToken, setAuthToken] = useState<string>()
    const [claiming, setClaiming] = useState(false)
    const [googleError, setGoogleError] = useState('')
    const slugInput = useRef<HTMLInputElement | null>(null)
    const googleButton = useRef<HTMLDivElement | null>(null)
    const googleCredentialTimeout = useRef<number | undefined>(undefined)
    const popup = useRef<Window | null>(null)

    const entry = deploys?.[0]
    const expired = Boolean(entry && isExpired(entry))
    const pendingInitialRelease = Boolean(entry && !expired && !entry.last_release_hash)
    const showCreate = deploys !== undefined && (!entry || expired || pendingInitialRelease)
    const progressValue = progress.total > 0 ? progress.done / progress.total : 0

    const refreshDeploys = useCallback(async () => {
        const result = await source.deploys()
        setDeploys(result.games)
        if (result.last_publish?.status === 'failed') {
            setError(errorMessage(new DevServerRequestError(
                result.last_publish.error_status || 500,
                result.last_publish.error_code || 'publish_failed',
                result.last_publish.error || 'The previous publish did not finish.',
            )))
            setRetryAction('publish')
        } else if (result.last_publish?.status === 'publishing') {
            setError('The previous publish was interrupted. Retry to finish it.')
            setRetryAction('publish')
        }
        const first = result.games[0]
        if (first && !first.last_release_hash) setFallbackUrl(first.preview_url)
        if (first && isExpired(first)) setSlug(first.slug)
        else if (!first) setSlug((current) => current || slugify(name))
        return first
    }, [name, source])

    useEffect(() => {
        if (!isOpen) return
        setError('')
        setRetryAction(undefined)
        setFallbackUrl('')
        setPopupBlocked(false)
        void refreshDeploys().catch((caught) => {
            setDeploys([])
            setError(errorMessage(caught))
        })
    }, [isOpen, refreshDeploys])

    useEffect(() => {
        if (!isOpen || !showCreate) return
        if (pendingInitialRelease) {
            setAvailability('available')
            return
        }
        setAvailability('checking')
        let cancelled = false
        const timer = setTimeout(() => {
            void source.checkSlug(slug).then((result) => {
                if (cancelled) return
                setAvailability(result.available ? 'available' : availabilityFromReason(result.reason))
            }).catch(() => {
                if (!cancelled) setAvailability('error')
            })
        }, 300)
        return () => {
            cancelled = true
            clearTimeout(timer)
        }
    }, [availabilityNonce, isOpen, pendingInitialRelease, showCreate, slug, source])

    const publish = async (creating: boolean) => {
        if (creating) {
            popup.current = window.open('about:blank', '_blank')
            setPopupBlocked(!popup.current)
        }
        setPublishing(true)
        setError('')
        setRetryAction(undefined)
        setProgress({phase: 'walking', done: 0, total: 1})
        try {
            if (!await beforePublish()) {
                popup.current?.close()
                popup.current = null
                throw new Error('Save the editor scene before publishing.')
            }
            const result = await source.publish({
                slug: creating ? slug : entry?.slug,
                name,
                message: creating ? 'initial' : 'update',
            }, (next) => {
                setProgress({phase: next.phase, done: next.done, total: next.total})
                if (next.preview_url) {
                    setFallbackUrl(next.preview_url)
                    navigatePopup(next.preview_url)
                }
            })
            setFallbackUrl(result.preview_url)
            navigatePopup(result.preview_url)
            await refreshDeploys()
        } catch (caught) {
            if (caught instanceof DevServerRequestError && caught.code === 'slug_taken' && creating) {
                popup.current?.close()
                popup.current = null
                setAvailability('taken')
                requestAnimationFrame(() => slugInput.current?.focus())
            }
            setError(errorMessage(caught))
            setRetryAction('publish')
        } finally {
            setPublishing(false)
        }
    }

    const navigatePopup = (url: string) => {
        try {
            if (popup.current && !popup.current.closed) popup.current.location.href = url
        } catch {
            setPopupBlocked(true)
        }
    }

    const copyPrompt = async () => {
        const prompt = `Deploy the Kite3D game in this folder to a live URL.\nRead https://blitz.dev/agents.md and follow the Deploy section.\nUse the slug "${slug}". If .kite3d/deploys.json exists, reuse its deploy_token.\nOtherwise create a new anonymous game. Report the preview URL when done.`
        await navigator.clipboard.writeText(prompt)
    }

    const authenticateAndClaim = useCallback(async (authenticate: () => Promise<{token: string}>) => {
        if (!entry) return
        setClaiming(true)
        setError('')
        setRetryAction(undefined)
        try {
            const auth = await authenticate()
            setAuthToken(auth.token)
            await source.claim(entry.slug)
            await refreshDeploys()
        } catch (caught) {
            setError(errorMessage(caught))
            setRetryAction('claim')
        } finally {
            setClaiming(false)
        }
    }, [entry, refreshDeploys, source])

    const claim = async (event?: FormEvent) => {
        event?.preventDefault()
        await authenticateAndClaim(() => source.authenticate(authMode, email, password))
    }

    const clearGoogleCredentialTimeout = useCallback(() => {
        if (googleCredentialTimeout.current === undefined) return
        window.clearTimeout(googleCredentialTimeout.current)
        googleCredentialTimeout.current = undefined
    }, [])

    const handleGoogleButtonClick = useCallback(() => {
        clearGoogleCredentialTimeout()
        setGoogleError('')
        googleCredentialTimeout.current = window.setTimeout(() => {
            googleCredentialTimeout.current = undefined
            setGoogleError(googleOriginMessage())
        }, GOOGLE_CREDENTIAL_WAIT_MS)
    }, [clearGoogleCredentialTimeout])

    const handleGoogleCredential = useCallback((response: GoogleCredentialResponse) => {
        clearGoogleCredentialTimeout()
        const credential = response.credential
        if (!credential) {
            setGoogleError('Google sign-in did not return a credential.')
            return
        }
        setGoogleError('')
        void authenticateAndClaim(() => source.authenticateWithGoogle(credential, response.select_by))
    }, [authenticateAndClaim, clearGoogleCredentialTimeout, source])

    useEffect(() => {
        if (!isOpen || !entry?.last_release_hash || expired || entry.claimed) return
        let cancelled = false
        googleCredentialHandler = handleGoogleCredential
        setGoogleError('')
        void loadGoogleIdentity().then((identity) => {
            if (cancelled || !googleButton.current) return
            if (!googleInitialized) {
                identity.initialize({
                    client_id: GOOGLE_CLIENT_ID,
                    callback: (response) => googleCredentialHandler?.(response),
                })
                googleInitialized = true
            }
            googleButton.current.replaceChildren()
            identity.renderButton(googleButton.current, {
                type: 'standard',
                theme: 'outline',
                size: 'large',
                text: 'continue_with',
                click_listener: handleGoogleButtonClick,
            })
            identity.prompt?.((notification) => {
                if (notification.isNotDisplayed?.()
                    && notification.getNotDisplayedReason?.() === 'unregistered_origin') {
                    setGoogleError(googleOriginMessage())
                }
            })
        }).catch((caught) => {
            if (!cancelled) setGoogleError(isOriginError(caught) ? googleOriginMessage() : errorMessage(caught))
        })
        return () => {
            cancelled = true
            clearGoogleCredentialTimeout()
            if (googleCredentialHandler === handleGoogleCredential) googleCredentialHandler = undefined
        }
    }, [clearGoogleCredentialTimeout, entry?.claimed, entry?.last_release_hash, expired, handleGoogleButtonClick, handleGoogleCredential, isOpen])

    const retry = () => {
        if (retryAction === 'claim') void claim()
        else void publish(showCreate)
    }

    const availabilityText = useMemo(() => ({
        checking: 'Checking availability...',
        available: 'Available',
        taken: 'Taken. Choose another slug.',
        reserved: 'Reserved. Choose another slug.',
        invalid: 'Use 3 to 49 lowercase letters, digits, or single hyphens.',
        error: 'Could not check availability.',
    })[availability], [availability])

    return <Dialog className="bp5-dark publish-dialog" isOpen={isOpen} onClose={onClose} title="Open game">
        <div className="publish-dialog-body">
            {deploys === undefined && <p>Loading publish status...</p>}

            {showCreate && <>
                {expired && <Callout intent={Intent.WARNING} title="This game expired">
                    Create it again to publish a new live version.
                </Callout>}
                <FormGroup label="Slug" labelFor="publish-slug" helperText={availabilityText}
                    intent={availability === 'available' ? Intent.SUCCESS : availability === 'checking' ? Intent.NONE : Intent.DANGER}>
                    <InputGroup
                        id="publish-slug"
                        inputRef={slugInput}
                        value={slug}
                        onChange={(event) => setSlug(event.target.value.toLowerCase())}
                        intent={availability === 'available' ? Intent.SUCCESS : availability === 'checking' ? Intent.NONE : Intent.DANGER}
                    />
                </FormGroup>
                {availability === 'error' && <Button minimal onClick={() => setAvailabilityNonce((value) => value + 1)}>Check again</Button>}
                <Callout className="publish-notice" intent={Intent.PRIMARY}>
                    This game expires in 12 hours unless you sign in and claim it.
                </Callout>
                <div className="publish-agent-row">
                    <span>An agent can create this for you.</span>
                    <Button small onClick={() => void copyPrompt()}>Copy prompt</Button>
                </div>
                <Button
                    data-testid="create-live-game"
                    intent={Intent.PRIMARY}
                    loading={publishing}
                    disabled={availability !== 'available'}
                    onClick={() => void publish(true)}
                >Create live game</Button>
            </>}

            {publishing && <div className="publish-progress" aria-live="polite">
                <ProgressBar value={progressValue} animate stripes/>
                <span>{progressLabel(progress.phase, progress.done, progress.total)}</span>
            </div>}

            {entry?.last_release_hash && !expired && !publishing && <>
                <Callout intent={Intent.SUCCESS} title="Your game is live">
                    <a data-testid="live-url" href={entry.preview_url} target="_blank" rel="noreferrer">{entry.preview_url}</a>
                </Callout>
                <div className="publish-actions">
                    <Button onClick={() => void navigator.clipboard.writeText(entry.preview_url)}>Copy URL</Button>
                    <AnchorButton href={entry.preview_url} target="_blank" rel="noreferrer">Open</AnchorButton>
                    <Button data-testid="publish-update" intent={Intent.PRIMARY} onClick={() => void publish(false)}>Publish update</Button>
                </div>
                {!entry.claimed && <>
                    <p className="publish-expiry">{timeLeft(entry)}. Sign in and claim it to keep it live.</p>
                    <form className="claim-form" onSubmit={(event) => void claim(event)}>
                        <ButtonGroup fill>
                            <Button active={authMode === 'register'} onClick={() => setAuthMode('register')}>Register</Button>
                            <Button active={authMode === 'login'} onClick={() => setAuthMode('login')}>Log in</Button>
                        </ButtonGroup>
                        <FormGroup label="Email" labelFor="claim-email">
                            <InputGroup id="claim-email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)}/>
                        </FormGroup>
                        <FormGroup label="Password" labelFor="claim-password">
                            <InputGroup id="claim-password" type="password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)}/>
                        </FormGroup>
                        <Button data-testid="claim-game" type="submit" intent={Intent.SUCCESS} loading={claiming}>
                            {authMode === 'register' ? 'Register and claim' : 'Log in and claim'}
                        </Button>
                        <div className="google-sign-in" data-testid="google-sign-in" ref={googleButton}>
                            <span>Continue with Google</span>
                        </div>
                        {googleError && <Callout data-testid="google-origin-error" intent={Intent.WARNING}>{googleError}</Callout>}
                    </form>
                </>}
                {entry.claimed && <Callout data-testid="claimed-notice" intent={Intent.SUCCESS}>
                    Claimed. This game does not expire.
                </Callout>}
                {authToken && !entry.claimed && <p>Signed in for this editor session.</p>}
            </>}

            {popupBlocked && fallbackUrl && <Callout intent={Intent.WARNING} title="Popup blocked">
                <a href={fallbackUrl} target="_blank" rel="noreferrer">Open the live game</a>
            </Callout>}

            {error && <Callout className="publish-error" intent={Intent.DANGER} title="Publishing could not finish">
                <p>{error}</p>
                {retryAction && <Button onClick={retry}>Retry</Button>}
            </Callout>}
        </div>
    </Dialog>
}

function availabilityFromReason(reason: string | undefined): Availability {
    if (reason === 'slug_taken') return 'taken'
    if (reason === 'reserved_slug') return 'reserved'
    return 'invalid'
}

function progressLabel(phase: string, done: number, total: number): string {
    const label = ({creating: 'Creating game', walking: 'Reading project', hashing: 'Preparing files', uploading: 'Uploading files', releasing: 'Creating release', verifying: 'Verifying live files', complete: 'Published'} as Record<string, string>)[phase] || 'Publishing'
    return total > 1 ? `${label}: ${done} of ${total}` : label
}

function errorMessage(error: unknown): string {
    if (error instanceof DevServerRequestError) {
        if (error.status === 413) return 'A file exceeds 100 MiB, or the game exceeds the 500 MiB or 2,000 file limit.'
        if (error.status === 429 || error.status === 503) return 'Publishing is temporarily unavailable. Try again in a minute.'
        if (error.status === 409 && error.code === 'slug_taken') return 'That slug was just taken. Choose another slug and try again.'
        return error.message
    }
    if (error instanceof TypeError) return 'The network connection was lost. Check your connection and retry.'
    return error instanceof Error ? error.message : String(error)
}

function loadGoogleIdentity(): Promise<GoogleIdentity> {
    const available = window.google?.accounts?.id
    if (available) return Promise.resolve(available)
    if (googleIdentityPromise) return googleIdentityPromise

    googleIdentityPromise = new Promise<GoogleIdentity>((resolveIdentity, reject) => {
        const existing = document.querySelector<HTMLScriptElement>(`script[src="${GOOGLE_SCRIPT_URL}"]`)
        const script = existing || document.createElement('script')
        const loaded = () => {
            const identity = window.google?.accounts?.id
            if (identity) resolveIdentity(identity)
            else reject(new Error('Google Identity Services did not initialize.'))
        }
        script.addEventListener('load', loaded, {once: true})
        script.addEventListener('error', () => reject(new Error('Google Identity Services could not be loaded.')), {once: true})
        if (!existing) {
            script.src = GOOGLE_SCRIPT_URL
            script.async = true
            document.head.append(script)
        }
    }).catch((error) => {
        googleIdentityPromise = undefined
        throw error
    })
    return googleIdentityPromise
}

function isOriginError(error: unknown): boolean {
    return /origin/i.test(error instanceof Error ? error.message : String(error))
}

function googleOriginMessage(): string {
    return `Add the editor origin ${window.location.origin} to the Google OAuth client's authorized JavaScript origins. Listing http://localhost does not cover every port; each editor origin, including its port, must be listed separately.`
}
