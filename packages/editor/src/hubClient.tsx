/* eslint-disable react-refresh/only-export-components */
import {createContext, createElement, useCallback, useContext, useMemo, useState, type ReactNode} from 'react'

export interface HubWorktree {
    path: string
    name: string
    branch: string | null
    running: boolean
    url: string | null
}

export interface HubProjects {
    active: Array<{path: string, name: string, branch: string | null, url: string}>
    repos: Array<{name: string, root: string, worktrees: HubWorktree[]}>
    loose: HubWorktree[]
}

export interface HubFolderListing {
    path: string
    parent: string | null
    folders: Array<{name: string, path: string, isProject: boolean, isRepo: boolean}>
}

interface HubClientValue {
    projects: HubProjects | null
    error: string | null
    refreshing: boolean
    starting: ReadonlySet<string>
    stopping: ReadonlySet<string>
    currentProjectPath: string | null
    refresh(): Promise<void>
    folders(path?: string): Promise<HubFolderListing>
    openProject(path: string, url?: string | null): Promise<void>
    addAndOpen(path: string): Promise<void>
    createAndOpen(parent: string, name: string): Promise<void>
    stop(path: string): Promise<void>
}

const HubClientContext = createContext<HubClientValue | undefined>(undefined)

export function HubClientProvider({children}: {children: ReactNode}) {
    const client = useMemo(() => new HubRouteClient(), [])
    const [projects, setProjects] = useState<HubProjects | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [refreshing, setRefreshing] = useState(false)
    const [starting, setStarting] = useState<ReadonlySet<string>>(new Set())
    const [stopping, setStopping] = useState<ReadonlySet<string>>(new Set())

    const refresh = useCallback(async () => {
        setRefreshing(true)
        try {
            setProjects(await client.projects())
            setError(null)
        } catch (caught) {
            setError(errorMessage(caught))
        } finally {
            setRefreshing(false)
        }
    }, [client])

    const folders = useCallback(async (path?: string) => {
        try {
            const listing = await client.folders(path)
            setError(null)
            return listing
        } catch (caught) {
            setError(errorMessage(caught))
            throw caught
        }
    }, [client])

    const runStarting = useCallback(async (path: string, operation: () => Promise<void>) => {
        setStarting((current) => new Set(current).add(path))
        setError(null)
        try {
            await operation()
        } catch (caught) {
            setError(errorMessage(caught))
        } finally {
            setStarting((current) => without(current, path))
        }
    }, [])

    const openProject = useCallback(async (path: string, url?: string | null) => {
        if (url) {
            window.open(url, '_blank')
            return
        }
        await runStarting(path, async () => {
            let destination: string
            try {
                destination = (await client.start(path)).url
            } finally {
                await refresh()
            }
            window.open(destination, '_blank')
        })
    }, [client, refresh, runStarting])

    const addAndOpen = useCallback(async (path: string) => {
        await runStarting(path, async () => {
            try {
                await client.add(path)
            } finally {
                await refresh()
            }
            let url: string
            try {
                url = (await client.start(path)).url
            } finally {
                await refresh()
            }
            window.open(url, '_blank')
        })
    }, [client, refresh, runStarting])

    const createAndOpen = useCallback(async (parent: string, name: string) => {
        const pendingPath = `${parent.replace(/\/$/, '')}/${name}`
        await runStarting(pendingPath, async () => {
            let created: {path: string}
            try {
                created = await client.create(parent, name)
            } finally {
                await refresh()
            }
            let url: string
            try {
                url = (await client.start(created.path)).url
            } finally {
                await refresh()
            }
            window.open(url, '_blank')
        })
    }, [client, refresh, runStarting])

    const stop = useCallback(async (path: string) => {
        setStopping((current) => new Set(current).add(path))
        setError(null)
        let caughtError: string | null = null
        try {
            await client.stop(path)
        } catch (caught) {
            caughtError = errorMessage(caught)
        } finally {
            await refresh()
            setStopping((current) => without(current, path))
        }
        if (caughtError) setError(caughtError)
    }, [client, refresh])

    const currentProjectPath = useMemo(() => {
        if (!projects) return null
        return projects.active.find(({url}) => isCurrentServer(url))?.path || null
    }, [projects])

    const value = useMemo<HubClientValue>(() => ({
        projects,
        error,
        refreshing,
        starting,
        stopping,
        currentProjectPath,
        refresh,
        folders,
        openProject,
        addAndOpen,
        createAndOpen,
        stop,
    }), [
        projects, error, refreshing, starting, stopping, currentProjectPath, refresh, folders,
        openProject, addAndOpen, createAndOpen, stop,
    ])
    return createElement(HubClientContext.Provider, {value}, children)
}

export function useHubClient() {
    const value = useContext(HubClientContext)
    if (!value) throw new Error('Hub client context is missing')
    return value
}

export function displayHubPath(path: string): string {
    return path.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, '~')
}

class HubRouteClient {
    private readonly token: string

    constructor(locationUrl = window.location.href) {
        this.token = new URL(locationUrl).searchParams.get('t') || ''
    }

    projects(): Promise<HubProjects> {
        return this.request('/api/hub/projects')
    }

    folders(path?: string): Promise<HubFolderListing> {
        const query = path === undefined ? '' : `?path=${encodeURIComponent(path)}`
        return this.request(`/api/hub/folders${query}`)
    }

    start(path: string): Promise<{url: string}> {
        return this.post('/api/hub/projects/start', {path})
    }

    stop(path: string): Promise<{stopped: true}> {
        return this.post('/api/hub/projects/stop', {path})
    }

    add(path: string): Promise<{path: string}> {
        return this.post('/api/hub/projects/add', {path})
    }

    create(parent: string, name: string): Promise<{path: string}> {
        return this.post('/api/hub/projects/create', {parent, name})
    }

    private post<T>(path: string, body: Record<string, string>): Promise<T> {
        return this.request(path, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(body),
        })
    }

    private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
        const headers = new Headers(init.headers)
        headers.set('X-Kite3D-Token', this.token)
        const response = await fetch(path, {...init, headers})
        if (!response.ok) {
            const body = await response.json().catch(() => ({})) as {error?: {message?: string}}
            throw new Error(body.error?.message || `${path} failed: ${response.status}`)
        }
        return response.json() as Promise<T>
    }
}

function isCurrentServer(serverUrl: string): boolean {
    try {
        const current = new URL(window.location.href)
        const server = new URL(serverUrl)
        return current.origin === server.origin && current.searchParams.get('t') === server.searchParams.get('t')
    } catch {
        return false
    }
}

function without(values: ReadonlySet<string>, value: string): ReadonlySet<string> {
    const next = new Set(values)
    next.delete(value)
    return next
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}
