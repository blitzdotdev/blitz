import {Button, Icon, InputGroup, Spinner, Tag} from '@blueprintjs/core'
import {useCallback, useEffect, useState} from 'react'
import {AppToaster} from 'uiconfig-blueprint/lib/esm/lib'
import {HubFolderListing, ProjectRow} from '../devserver/HubClient.ts'
import {useHub} from '../utils/UseHub.ts'

/**
 * The project list of the hub page and of the navbar popover: every project this machine knows,
 * grouped by repository, with Open and Stop, and the two ways to add one.
 * It never polls. The list is read when it mounts, after every action, and on Refresh.
 */
export function ProjectPicker() {
    const hub = useHub()
    const [rows, setRows] = useState<ProjectRow[] | null>(null)
    const [loading, setLoading] = useState(true)
    const [busyPath, setBusyPath] = useState<string | null>(null)
    const [browsing, setBrowsing] = useState<'new' | 'open' | null>(null)

    const refresh = useCallback(async () => {
        setLoading(true)
        try {
            setRows(await hub.projects())
        } catch (error) {
            setRows(null)
            showError(error)
        } finally {
            setLoading(false)
        }
    }, [hub])

    useEffect(() => {
        void refresh()
    }, [refresh])

    // Only the server knows which projects run now, so every action ends with a fresh list.
    const run = async (path: string, action: () => Promise<unknown>) => {
        setBusyPath(path)
        try {
            await action()
        } catch (error) {
            showError(error)
        } finally {
            setBusyPath(null)
            await refresh()
        }
    }

    const openRow = (row: ProjectRow) => {
        // A running project already has a server: this is a second tab on it, and no new process.
        if (row.url) window.open(row.url, '_blank')
        else void run(row.path, async () => window.open((await hub.start(row.path)).url, '_blank'))
    }

    return <div className="project-picker">
        <div className="project-picker-head">
            <span className="project-picker-title">{browsing ? browsingTitles[browsing] : 'Projects'}</span>
            {!browsing && <Button
                variant="minimal" size="small" icon="refresh" text="Refresh"
                loading={loading} onClick={() => void refresh()}/>}
        </div>
        {browsing ? <FolderBrowser mode={browsing} onDone={() => {
            setBrowsing(null)
            void refresh()
        }}/> : <>
            <div className="project-picker-list">
                {loading && !rows && <Spinner size={20}/>}
                {!loading && !rows && <div className="project-picker-note">Could not read the project list.</div>}
                {rows?.length === 0 && <div className="project-picker-note">No projects yet. Start one below.</div>}
                {rows && groupByRepository(rows).map((group) => <div className="project-picker-group" key={group.key}>
                    <div className="project-picker-group-name">{group.name}</div>
                    {group.rows.map((row) => <div className="project-picker-row" key={row.path}>
                        <Icon icon={row.repoRoot ? 'git-branch' : 'folder-close'}/>
                        <span className="project-picker-row-name">{row.name}</span>
                        {(row.branch || row.head) && <Tag minimal>{row.branch || row.head}</Tag>}
                        {row.running && <span className="project-picker-running">{runningText(row)}</span>}
                        {/* This page is served by one of these servers, and that row is this tab. */}
                        {row.url && new URL(row.url).origin === location.origin &&
                            <Tag minimal intent="primary">this tab</Tag>}
                        <Button
                            className="project-picker-row-action" variant="minimal" size="small"
                            icon="share" text="Open"
                            loading={busyPath === row.path} onClick={() => openRow(row)}/>
                        {row.running && <Button
                            variant="minimal" size="small" icon="stop" text="Stop"
                            loading={busyPath === row.path}
                            onClick={() => void run(row.path, () => hub.stop(row.path))}/>}
                    </div>)}
                </div>)}
            </div>
            <div className="project-picker-footer">
                <Button
                    variant="minimal" size="small" icon="add" text="New Project"
                    onClick={() => setBrowsing('new')}/>
                <Button
                    variant="minimal" size="small" icon="folder-open" text="Open Project"
                    onClick={() => setBrowsing('open')}/>
            </div>
        </>}
    </div>
}

const browsingTitles = {new: 'New project', open: 'Open project'}

/**
 * Walks the folders under the home folder, which is as far as the server looks.
 * New: pick a parent, name the project, and the server runs kite3d init in it.
 * Open: pick a folder that is already a project, and the server adds it to the index.
 * Either way the project starts and opens in a new tab.
 */
function FolderBrowser({mode, onDone}: {mode: 'new' | 'open', onDone: () => void}) {
    const hub = useHub()
    const [listing, setListing] = useState<HubFolderListing | null>(null)
    const [home, setHome] = useState('')
    const [name, setName] = useState('')
    const [busy, setBusy] = useState(false)

    const browse = useCallback(async (path?: string) => {
        try {
            const next = await hub.folders(path)
            // Only the home folder has no parent, and every other path here is under it.
            if (next.parent === null) setHome(next.path)
            setListing(next)
        } catch (error) {
            showError(error)
        }
    }, [hub])

    useEffect(() => {
        void browse()
    }, [browse])

    const openProject = async (action: () => Promise<string>) => {
        setBusy(true)
        try {
            window.open(await action(), '_blank')
            onDone()
        } catch (error) {
            showError(error)
        } finally {
            setBusy(false)
        }
    }

    const displayPath = (path: string) => path === home ? '~' : path.startsWith(home) ? `~${path.slice(home.length)}` : path

    return <>
        <div className="project-picker-path">
            <Button
                variant="minimal" size="small" icon="arrow-up" text="Up"
                disabled={!listing?.parent} onClick={() => void browse(listing?.parent ?? undefined)}/>
            <code>{listing ? displayPath(listing.path) : ''}</code>
        </div>
        <div className="project-picker-list">
            {!listing && <Spinner size={20}/>}
            {listing?.folders.length === 0 && <div className="project-picker-note">No folders here.</div>}
            {listing?.folders.map((folder) => <div className="project-picker-row" key={folder.path}>
                <Button
                    className="project-picker-folder" variant="minimal" size="small" fill alignText="start"
                    icon={folder.isRepo ? 'git-repo' : 'folder-close'} text={folder.name}
                    onClick={() => void browse(folder.path)}/>
                {mode === 'open' && folder.isProject && <Button
                    variant="minimal" size="small" icon="share" text="Open" loading={busy}
                    onClick={() => void openProject(async () => {
                        await hub.add(folder.path)
                        return (await hub.start(folder.path)).url
                    })}/>}
            </div>)}
        </div>
        <div className="project-picker-footer">
            {mode === 'new' && <>
                <InputGroup
                    className="project-picker-name" size="small" placeholder="Project name"
                    value={name} onValueChange={setName}/>
                <Button
                    variant="minimal" size="small" icon="add" text="Create"
                    disabled={!listing || !name.trim()} loading={busy}
                    onClick={() => void openProject(async () => {
                        const {path} = await hub.create(listing!.path, name.trim())
                        return (await hub.start(path)).url
                    })}/>
            </>}
            <Button variant="minimal" size="small" text="Cancel" onClick={onDone}/>
        </div>
    </>
}

interface ProjectGroup {
    key: string
    name: string
    rows: ProjectRow[]
}

// Worktrees of one repository under the repository's name, loose projects under a list of their
// own, below the repositories. Running rows come first, then the ones opened most recently.
function groupByRepository(rows: ProjectRow[]): ProjectGroup[] {
    const groups = new Map<string, ProjectGroup>()
    const sorted = [...rows].sort((left, right) =>
        Number(right.running) - Number(left.running) || right.lastOpened.localeCompare(left.lastOpened))
    for (const row of sorted) {
        const key = row.repoRoot ?? ''
        const group = groups.get(key) ?? {key, name: row.repoRoot?.split(/[\\/]/).pop() || 'Other projects', rows: []}
        group.rows.push(row)
        groups.set(key, group)
    }
    return [...groups.values()].sort((left, right) => Number(!left.key) - Number(!right.key))
}

function runningText(row: ProjectRow): string {
    if (!row.tabs) return 'running, no tab'
    return `running, ${row.tabs} ${row.tabs === 1 ? 'tab' : 'tabs'}`
}

function showError(error: unknown) {
    AppToaster().show({
        message: error instanceof Error ? error.message : String(error),
        intent: 'danger',
        icon: 'error',
        timeout: 5000,
        isCloseButtonShown: true,
    })
}
