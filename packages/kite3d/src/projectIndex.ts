import {randomBytes} from 'node:crypto'
import {access, mkdir, readFile, realpath, rename, unlink, writeFile} from 'node:fs/promises'
import {basename, resolve} from 'node:path'
import {kite3dHome} from './home.ts'
import {repoRoot} from './gitInfo.ts'

// ~/.kite3d/projects.json: the projects this machine knows about, across reboots.
export interface ProjectIndex {
    version: 1
    projects: IndexedProject[]
}

export interface IndexedProject {
    path: string            // absolute, symlinks resolved; the key
    name: string            // the package.json name, or the folder name
    repoRoot: string | null // shared by every worktree of one repository; null for a loose project
    lastOpened: string      // ISO time of the last init, dev, or open through the picker; the sort key
}

function indexPath(): string {
    return resolve(kite3dHome(), 'projects.json')
}

// Newest first. A project whose folder or package.json is gone is dropped here and disappears from
// the file at the next registration; there is no lock, so a read never writes.
export async function readProjectIndex(): Promise<ProjectIndex> {
    let parsed: unknown
    try {
        parsed = JSON.parse(await readFile(indexPath(), 'utf8'))
    } catch {
        return {version: 1, projects: []}
    }
    if (!parsed || typeof parsed !== 'object') return {version: 1, projects: []}
    const {version, projects} = parsed as Record<string, unknown>
    if (version !== 1 || !Array.isArray(projects)) return {version: 1, projects: []}
    const kept: IndexedProject[] = []
    for (const value of projects) {
        const project = asIndexedProject(value)
        if (project && await isProjectFolder(project.path)) kept.push(project)
    }
    kept.sort((left, right) => right.lastOpened.localeCompare(left.lastOpened))
    return {version: 1, projects: kept}
}

// Adds the project, or moves it to the front with a fresh lastOpened. The write is a temp file and
// a rename, so a lost race costs one registration that the next init, dev or start repeats.
export async function registerProject(path: string): Promise<IndexedProject> {
    const absolutePath = await realpath(resolve(path))
    const entry: IndexedProject = {
        path: absolutePath,
        name: await projectName(absolutePath),
        repoRoot: await repoRoot(absolutePath),
        lastOpened: new Date().toISOString(),
    }
    const {projects} = await readProjectIndex()
    const index: ProjectIndex = {
        version: 1,
        projects: [entry, ...projects.filter((project) => project.path !== absolutePath)],
    }
    const home = kite3dHome()
    await mkdir(home, {recursive: true})
    const temporary = resolve(home, `.projects-${randomBytes(6).toString('hex')}.tmp`)
    try {
        await writeFile(temporary, `${JSON.stringify(index, null, 2)}\n`, {mode: 0o600})
        await rename(temporary, indexPath())
    } catch (error) {
        await unlink(temporary).catch(() => undefined)
        throw error
    }
    return entry
}

async function projectName(path: string): Promise<string> {
    try {
        const manifest = JSON.parse(await readFile(resolve(path, 'package.json'), 'utf8')) as {name?: unknown}
        if (typeof manifest.name === 'string' && manifest.name.trim()) return manifest.name.trim()
    } catch { /* an unnamed or unreadable manifest falls back to the folder name */ }
    return basename(path)
}

async function isProjectFolder(path: string): Promise<boolean> {
    try {
        await access(resolve(path, 'package.json'))
        return true
    } catch {
        return false
    }
}

function asIndexedProject(value: unknown): IndexedProject | null {
    if (!value || typeof value !== 'object') return null
    const {path, name, repoRoot: root, lastOpened} = value as Record<string, unknown>
    if (typeof path !== 'string' || !path || typeof name !== 'string') return null
    if (root !== null && typeof root !== 'string') return null
    if (typeof lastOpened !== 'string' || !Number.isFinite(Date.parse(lastOpened))) return null
    return {path, name, repoRoot: root, lastOpened}
}
