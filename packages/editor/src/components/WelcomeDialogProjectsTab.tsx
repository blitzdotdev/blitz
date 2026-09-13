import {Button, Callout, H4, Icon, InputGroup, Spinner} from '@blueprintjs/core'
import {useEffect, useRef, useState} from 'react'
import {displayHubPath, type HubFolderListing, type HubWorktree, useHubClient} from '../hubClient.tsx'
import {useProject} from '../utils/UseProject.ts'
import {WelcomeDialogCreateProjectActions} from './WelcomeDialogCreateProjectActions.tsx'

export function WelcomeDialogProjectsTab() {
    const {welcomeView, setWelcomeView} = useProject()
    if (welcomeView === 'open') return <FolderProjectView mode="open" onCancel={() => setWelcomeView('projects')}/>
    if (welcomeView === 'new') return <FolderProjectView mode="new" onCancel={() => setWelcomeView('projects')}/>
    return <ProjectLists
        onNew={() => setWelcomeView('new')}
        onOpen={() => setWelcomeView('open')}/>
}

function ProjectLists({onNew, onOpen}: {onNew(): void, onOpen(): void}) {
    const {projects, error, refreshing, starting, stopping, openProject, stop} = useHubClient()
    return <div className="welcome-main-container" data-testid="hub-project-lists">
        <H4>Open a project</H4>
        <div className="welcome-main-create-actions">
            <WelcomeDialogCreateProjectActions onNew={onNew} onOpen={onOpen}/>
        </div>
        {error && <Callout intent="danger" compact={true}>{error}</Callout>}
        <WelcomeSectionLabel text="Active editors"/>
        {!projects && refreshing && <LoadingRow text="Loading projects"/>}
        {projects && projects.active.length === 0 && <EmptyRow text="No active editors"/>}
        {projects?.active.map((active) => <div className="hub-project-row hub-active-row" key={active.path}>
            <Icon icon="desktop"/>
            <strong>{active.name}</strong>
            <BranchTag branch={active.branch}/>
            <HubPath path={active.path}/>
            <Button small={true} text="Open" onClick={() => void openProject(active.path, active.url)}/>
            <Button
                minimal={true}
                small={true}
                text={stopping.has(active.path) ? 'stopping' : 'Stop'}
                loading={stopping.has(active.path)}
                onClick={() => void stop(active.path)}/>
        </div>)}
        <WelcomeSectionLabel text="Projects"/>
        {projects?.repos.map((repo) => <div className="hub-repo-group" key={repo.root}>
            <div className="hub-project-row hub-repo-row">
                <Icon icon="folder-close"/>
                <strong>{repo.name}</strong>
                <HubPath path={repo.root}/>
                <span className="hub-row-note">{repo.worktrees.length} {repo.worktrees.length === 1 ? 'worktree' : 'worktrees'}</span>
            </div>
            {repo.worktrees.map((worktree) => <ProjectRow
                key={worktree.path}
                project={worktree}
                indented={true}
                starting={starting.has(worktree.path)}
                onOpen={() => void openProject(worktree.path, worktree.url)}/>) }
        </div>)}
        {projects?.loose.map((project) => <ProjectRow
            key={project.path}
            project={project}
            starting={starting.has(project.path)}
            loose={true}
            onOpen={() => void openProject(project.path, project.url)}/>) }
        {projects && projects.repos.length === 0 && projects.loose.length === 0 && <EmptyRow text="No projects yet"/>}
    </div>
}

function ProjectRow({project, indented = false, loose = false, starting, onOpen}: {
    project: HubWorktree
    indented?: boolean
    loose?: boolean
    starting: boolean
    onOpen(): void
}) {
    return <div className={`hub-project-row ${indented ? 'is-indented' : ''}`}>
        <Icon icon={loose ? 'folder-close' : 'git-branch'}/>
        {loose ? <strong>{project.name}</strong> : <BranchTag branch={project.branch}/>}
        <HubPath path={project.path}/>
        {loose && <span className="hub-row-note">no git</span>}
        {project.running && <span className="kite3d-status-chip">Running</span>}
        <StartButton starting={starting} onClick={onOpen}/>
    </div>
}

function FolderProjectView({mode, onCancel}: {mode: 'open' | 'new', onCancel(): void}) {
    const {folders, addAndOpen, createAndOpen, error, starting} = useHubClient()
    const [listing, setListing] = useState<HubFolderListing | null>(null)
    const [loading, setLoading] = useState(true)
    const [name, setName] = useState('my-game')
    const nameEdited = useRef(false)

    const load = async (path?: string) => {
        setLoading(true)
        try {
            const next = await folders(path)
            setListing(next)
            if (mode === 'new' && !nameEdited.current) {
                setName(freeProjectName(next.folders.map((folder) => folder.name)))
            }
        } catch {
            // Keep the last usable folder listing while the shared client shows the route error.
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        void load()
    }, [mode])

    const pendingPath = listing ? `${listing.path.replace(/\/$/, '')}/${name}` : ''
    return <div className="welcome-main-container hub-folder-view" data-testid={`hub-${mode}-project`}>
        <H4>{mode === 'open' ? 'Open Project' : 'New Project'}</H4>
        {listing && <div className="hub-path-bar">
            <code>{displayHubPath(listing.path)}</code>
            <Button
                icon="arrow-up"
                small={true}
                text="Up"
                disabled={!listing.parent || loading}
                onClick={() => void load(listing.parent || undefined)}/>
        </div>}
        {mode === 'new' && <label className="hub-project-name-field">
            <span>Name</span>
            <InputGroup
                aria-label="Project name"
                value={name}
                onChange={(event) => {
                    nameEdited.current = true
                    setName(event.currentTarget.value)
                }}/>
        </label>}
        {error && <Callout intent="danger" compact={true}>{error}</Callout>}
        <div className="hub-folder-list">
            {loading && <LoadingRow text="Loading folders"/>}
            {!loading && listing?.folders.map((folder) => <div
                className="hub-project-row hub-folder-row"
                key={folder.path}
                role="button"
                tabIndex={0}
                onClick={() => void load(folder.path)}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') void load(folder.path)
                }}>
                {folder.isProject
                    ? <img src="/logo.svg" className="hub-kite-icon" alt="Kite3D project"/>
                    : <Icon icon={folder.isRepo ? 'git-branch' : 'folder-close'}/>}
                <strong>{folder.name}</strong>
                {folder.isRepo && !folder.isProject && <span className="hub-row-note">git repo, not a Kite3D project</span>}
                {folder.isProject && (
                    <Button
                        small={true}
                        text="Open"
                        onClick={(event) => {
                            event.stopPropagation()
                            void addAndOpen(folder.path)
                        }}/>
                )}
            </div>)}
        </div>
        <div className="hub-folder-actions">
            <Button text="Cancel" onClick={onCancel}/>
            {mode === 'new' && (
                <Button
                    intent="primary"
                    text={starting.has(pendingPath) ? 'starting' : 'Create'}
                    loading={starting.has(pendingPath)}
                    disabled={!listing || !validProjectName(name)}
                    onClick={() => listing && void createAndOpen(listing.path, name)}/>
            )}
        </div>
    </div>
}

export function BranchTag({branch}: {branch: string | null}) {
    return branch ? <span className="hub-branch-tag">{branch}</span> : null
}

export function HubPath({path}: {path: string}) {
    return <code className="hub-path" title={path}>{displayHubPath(path)}</code>
}

export function StartButton({starting, onClick}: {starting: boolean, onClick(): void}) {
    return starting
        ? <span className="hub-starting"><Spinner size={14}/> starting</span>
        : <Button small={true} text="Open" onClick={onClick}/>
}

function WelcomeSectionLabel({text}: {text: string}) {
    return <h3 className="hub-section-label">{text}</h3>
}

function LoadingRow({text}: {text: string}) {
    return <div className="hub-loading-row"><Spinner size={14}/>{text}</div>
}

function EmptyRow({text}: {text: string}) {
    return <div className="hub-empty-row">{text}</div>
}

function freeProjectName(names: string[]): string {
    const used = new Set(names)
    if (!used.has('my-game')) return 'my-game'
    for (let suffix = 2; ; suffix += 1) {
        if (!used.has(`my-game-${suffix}`)) return `my-game-${suffix}`
    }
}

function validProjectName(name: string): boolean {
    return Boolean(name) && name !== '.' && name !== '..' && !name.includes('/') && !name.includes('\\')
}
