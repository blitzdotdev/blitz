import {DevServerSource} from './DevServerSource.ts'

/**
 * One row of the picker: what `~/.kite3d/projects.json` remembers, plus the five things only a
 * server knows at request time. The server side is `ProjectRow` in packages/kite3d/src/hubRoutes.ts.
 */
export interface ProjectRow {
    path: string
    name: string
    repoRoot: string | null // shared by every worktree of one repository; null for a loose project
    lastOpened: string
    branch: string | null
    head: string | null     // the short commit when the branch is null
    running: boolean
    tabs: number            // that server's open editor tabs; 0 when it is not running
    url?: string            // the tokenized URL to open; only when running
}

export interface HubFolder {
    name: string
    path: string
    isProject: boolean
    isRepo: boolean
}

export interface HubFolderListing {
    path: string
    parent: string | null   // null at the home folder, which is where browsing starts
    folders: HubFolder[]
}

/**
 * The hub routes. Every kite3d server serves them, so the picker in any editor tab can list, start
 * and stop the other projects; the launcher is a server that serves nothing else.
 * The seventh route, `GET /api/state`, is `DevServerSource.state()`: main.tsx reads it to choose
 * between the hub page and a project.
 */
export class HubClient {
    constructor(private readonly source: DevServerSource) {}

    projects(): Promise<ProjectRow[]> {
        return this.source.json('/api/hub/projects')
    }

    folders(path?: string): Promise<HubFolderListing> {
        return this.source.json(`/api/hub/folders${path === undefined ? '' : `?path=${encodeURIComponent(path)}`}`)
    }

    start(path: string): Promise<{url: string}> {
        return this.post('/api/hub/projects/start', {path})
    }

    stop(path: string): Promise<{stopped: true}> {
        return this.post('/api/hub/projects/stop', {path})
    }

    create(parent: string, name: string): Promise<{path: string}> {
        return this.post('/api/hub/projects/create', {parent, name})
    }

    add(path: string): Promise<{path: string}> {
        return this.post('/api/hub/projects/add', {path})
    }

    private post<T>(path: string, body: Record<string, string>): Promise<T> {
        return this.source.json<T>(path, {
            method: 'POST',
            body: JSON.stringify(body),
            headers: {'Content-Type': 'application/json'},
        })
    }
}
