import {Button, Classes, Menu, MenuDivider, MenuItem, Popover, Spinner} from '@blueprintjs/core'
import {useEffect, useState, type ReactNode} from 'react'
import {displayHubPath, useHubClient} from '../hubClient.tsx'
import {useProject} from '../utils/UseProject.ts'
import {BranchTag} from './WelcomeDialogProjectsTab.tsx'

export function HubProjectPicker({fallbackPath}: {fallbackPath: string}) {
    const [open, setOpen] = useState(false)
    const {
        projects, refreshing, starting, stopping, currentProjectPath, refresh, openProject, stop,
    } = useHubClient()
    const {setWelcomeOpen, setWelcomeView} = useProject()

    useEffect(() => {
        if (open) void refresh()
    }, [open, refresh])

    const showDialog = (view: 'new' | 'open') => {
        setOpen(false)
        setWelcomeView(view)
        setWelcomeOpen(true)
    }
    const currentPath = currentProjectPath ? displayHubPath(currentProjectPath) : fallbackPath
    return <Popover
        isOpen={open}
        onInteraction={(nextOpen) => setOpen(nextOpen)}
        minimal={true}
        placement="bottom-start"
        content={<Menu className={`${Classes.ELEVATION_0} hub-project-menu`} data-testid="hub-project-menu">
            <MenuDivider title="Active editors"/>
            {!projects && refreshing && (
                <MenuItem disabled={true} text={<LoadingMenuText text="Loading projects"/>}/>
            )}
            {projects?.active.length === 0 && <MenuItem disabled={true} text="No active editors"/>}
            {projects?.active.map((active) => <MenuItem
                key={active.path}
                icon="desktop"
                text={<span className="hub-menu-title"><strong>{active.name}</strong> <BranchTag branch={active.branch}/></span>}
                labelElement={active.path === currentProjectPath ? <span className="hub-this-tab-tag">this tab</span> : undefined}>
                <MenuItem icon="document-open" text="Open" onClick={() => void openProject(active.path, active.url)}/>
                <MenuItem
                    icon="stop"
                    text={stopping.has(active.path) ? <LoadingMenuText text="stopping"/> : 'Stop server'}
                    disabled={stopping.has(active.path)}
                    onClick={() => void stop(active.path)}/>
            </MenuItem>)}
            <MenuDivider title="Projects"/>
            {projects?.repos.map((repo) => <MenuSection key={repo.root}>
                <MenuItem
                    className="hub-repo-menu-item"
                    disabled={true}
                    icon="folder-close"
                    text={<strong>{repo.name}</strong>}
                    label={`${repo.worktrees.length} ${repo.worktrees.length === 1 ? 'worktree' : 'worktrees'}`}/>
                {repo.worktrees.map((worktree) => <MenuItem
                    className="hub-worktree-menu-item"
                    key={worktree.path}
                    icon="git-branch"
                    shouldDismissPopover={false}
                    text={<span className="hub-menu-title">
                        <span>{worktree.branch || worktree.name}</span>
                        {worktree.running && <span className="kite3d-status-chip">Running</span>}
                    </span>}
                    labelElement={starting.has(worktree.path)
                        ? <LoadingMenuText text="starting"/>
                        : <code>{displayHubPath(worktree.path)}</code>}
                    onClick={() => void openProject(worktree.path, worktree.url)}/>) }
            </MenuSection>)}
            {projects?.loose.map((project) => <MenuItem
                key={project.path}
                icon="folder-close"
                shouldDismissPopover={false}
                text={<span className="hub-menu-title">
                    <strong>{project.name}</strong>
                    {project.running && <span className="kite3d-status-chip">Running</span>}
                </span>}
                labelElement={starting.has(project.path)
                    ? <LoadingMenuText text="starting"/>
                    : <code>{displayHubPath(project.path)}</code>}
                onClick={() => void openProject(project.path, project.url)}/>) }
            <MenuDivider/>
            <MenuItem icon="add" text="New Project…" onClick={() => showDialog('new')}/>
            <MenuItem icon="folder-open" text="Open Project…" onClick={() => showDialog('open')}/>
        </Menu>}>
        <Button
            data-testid="project-picker"
            role="heading"
            variant="minimal"
            size="small"
            icon="folder-close"
            text={currentPath}/>
    </Popover>
}

function MenuSection({children}: {children: ReactNode}) {
    return <>{children}</>
}

function LoadingMenuText({text}: {text: string}) {
    return <span className="hub-starting"><Spinner size={12}/>{text}</span>
}
