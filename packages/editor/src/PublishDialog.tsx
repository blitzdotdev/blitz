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
    onClose(): void
}

type Availability = 'checking' | 'available' | 'taken' | 'reserved' | 'invalid' | 'error'
type RetryAction = 'publish' | 'claim'

export function PublishDialog({isOpen, name, source, onClose}: PublishDialogProps) {
    const [deploys, setDeploys] = useState<DeployView[]>()
    const [slug, setSlug] = useState('')
    const [availability, setAvailability] = useState<Availability>('checking')
    const [availabilityNonce, setAvailabilityNonce] = useState(0)
    const [publishing, setPublishing] = useState(false)
    const [progress, setProgress] = useState({phase: '', completed: 0, total: 1})
    const [error, setError] = useState('')
    const [retryAction, setRetryAction] = useState<RetryAction>()
    const [fallbackUrl, setFallbackUrl] = useState('')
    const [popupBlocked, setPopupBlocked] = useState(false)
    const [authMode, setAuthMode] = useState<'register' | 'login'>('register')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [authToken, setAuthToken] = useState<string>()
    const [claiming, setClaiming] = useState(false)
    const slugInput = useRef<HTMLInputElement | null>(null)
    const popup = useRef<Window | null>(null)

    const entry = deploys?.[0]
    const expired = Boolean(entry && isExpired(entry))
    const showCreate = deploys !== undefined && (!entry || expired)
    const progressValue = progress.total > 0 ? progress.completed / progress.total : 0

    const refreshDeploys = useCallback(async () => {
        const result = await source.deploys()
        setDeploys(result.games)
        const first = result.games[0]
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
    }, [availabilityNonce, isOpen, showCreate, slug, source])

    useEffect(() => {
        if (!isOpen) return
        return source.events((event) => {
            if (event.type !== 'publish') return
            const phase = typeof event.phase === 'string' ? event.phase : ''
            const completed = typeof event.completed === 'number' ? event.completed : 0
            const total = typeof event.total === 'number' ? event.total : 1
            setProgress({phase, completed, total})
            if (typeof event.preview_url === 'string') {
                setFallbackUrl(event.preview_url)
                navigatePopup(event.preview_url)
            }
        })
    }, [isOpen, source])

    const publish = async (creating: boolean) => {
        if (creating) {
            popup.current = window.open('about:blank', '_blank')
            setPopupBlocked(!popup.current)
        }
        setPublishing(true)
        setError('')
        setRetryAction(undefined)
        setProgress({phase: creating ? 'creating' : 'walking', completed: 0, total: 1})
        try {
            const result = await source.publish({
                slug: creating ? slug : entry?.slug,
                name,
                message: creating ? 'initial' : 'update',
            })
            setFallbackUrl(result.preview_url)
            navigatePopup(result.preview_url)
            await refreshDeploys()
        } catch (caught) {
            if (caught instanceof DevServerRequestError && caught.status === 409 && creating) {
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
        const prompt = `Read AGENTS.md. Run npx blitz publish --slug ${slug} and report the URL. If .blitz/deploys.json exists, follow the pull rule and run npx blitz pull before publishing.`
        await navigator.clipboard.writeText(prompt)
    }

    const claim = async (event?: FormEvent) => {
        event?.preventDefault()
        if (!entry) return
        setClaiming(true)
        setError('')
        setRetryAction(undefined)
        try {
            const auth = await source.authenticate(authMode, email, password)
            setAuthToken(auth.token)
            await source.claim(entry.slug)
            await refreshDeploys()
        } catch (caught) {
            setError(errorMessage(caught))
            setRetryAction('claim')
        } finally {
            setClaiming(false)
        }
    }

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
                <span>{progressLabel(progress.phase, progress.completed, progress.total)}</span>
            </div>}

            {entry && !expired && !publishing && <>
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

function progressLabel(phase: string, completed: number, total: number): string {
    const label = ({creating: 'Creating game', walking: 'Reading project', hashing: 'Preparing files', uploading: 'Uploading files', releasing: 'Creating release', complete: 'Published'} as Record<string, string>)[phase] || 'Publishing'
    return total > 1 ? `${label}: ${completed} of ${total}` : label
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
