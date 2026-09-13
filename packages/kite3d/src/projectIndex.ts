import {randomBytes} from 'node:crypto'
import {mkdir, open, readFile, realpath, rename, stat, unlink, writeFile} from 'node:fs/promises'
import {homedir} from 'node:os'
import {basename, isAbsolute, resolve} from 'node:path'
import {repoRoot} from './gitInfo.ts'

export interface IndexedProject {
    path: string
    name: string
    repoRoot: string | null
    lastOpened: string
}

export interface ProjectIndex {
    version: 1
    projects: IndexedProject[]
}

const emptyProjectIndex = (): ProjectIndex => ({version: 1, projects: []})

export function kite3dHomeDirectory(): string {
    return resolve(process.env.KITE3D_HOME || resolve(homedir(), '.kite3d'))
}

export async function readProjectIndex(): Promise<ProjectIndex> {
    return withIndexLock(async () => {
        const {index, changed} = await readIndexFile()
        if (changed) await writeIndexFile(index)
        return index
    })
}

export async function registerProject(path: string): Promise<IndexedProject> {
    const absolutePath = await realpath(resolve(path))
    if (!(await stat(absolutePath)).isDirectory()) throw new Error(`Project path is not a folder: ${absolutePath}`)
    const packageJson = await readPackageJson(absolutePath)
    const entry: IndexedProject = {
        path: absolutePath,
        name: typeof packageJson.name === 'string' && packageJson.name.trim()
            ? packageJson.name.trim()
            : basename(absolutePath),
        repoRoot: await repoRoot(absolutePath),
        lastOpened: new Date().toISOString(),
    }
    await withIndexLock(async () => {
        const {index} = await readIndexFile()
        index.projects = [entry, ...index.projects.filter((project) => project.path !== absolutePath)]
        await writeIndexFile(index)
    })
    return entry
}

async function readIndexFile(): Promise<{index: ProjectIndex, changed: boolean}> {
    let parsed: unknown
    try {
        parsed = JSON.parse(await readFile(resolve(kite3dHomeDirectory(), 'projects.json'), 'utf8')) as unknown
    } catch (error) {
        if (errorCode(error) === 'ENOENT') return {index: emptyProjectIndex(), changed: false}
        return {index: emptyProjectIndex(), changed: true}
    }
    if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.projects)) {
        return {index: emptyProjectIndex(), changed: true}
    }
    const projects: IndexedProject[] = []
    for (const value of parsed.projects) {
        if (!isIndexedProject(value) || !await projectFilesExist(value.path)) continue
        projects.push(value)
    }
    projects.sort((left, right) => right.lastOpened.localeCompare(left.lastOpened))
    return {
        index: {version: 1, projects},
        changed: projects.length !== parsed.projects.length,
    }
}

async function writeIndexFile(index: ProjectIndex): Promise<void> {
    const home = kite3dHomeDirectory()
    await mkdir(home, {recursive: true})
    const destination = resolve(home, 'projects.json')
    const temporary = resolve(home, `.projects-${process.pid}-${randomBytes(6).toString('hex')}.tmp`)
    try {
        await writeFile(temporary, `${JSON.stringify(index, null, 2)}\n`, {mode: 0o600})
        await rename(temporary, destination)
    } finally {
        await unlink(temporary).catch(() => undefined)
    }
}

async function withIndexLock<T>(operation: () => Promise<T>): Promise<T> {
    const home = kite3dHomeDirectory()
    await mkdir(home, {recursive: true})
    const lockPath = resolve(home, 'projects.lock')
    for (let attempt = 0; attempt < 100; attempt += 1) {
        try {
            const handle = await open(lockPath, 'wx', 0o600)
            await handle.writeFile(`${JSON.stringify({pid: process.pid, createdAt: Date.now()})}\n`)
            await handle.close()
            try {
                return await operation()
            } finally {
                await unlink(lockPath).catch(() => undefined)
            }
        } catch (error) {
            if (errorCode(error) !== 'EEXIST') throw error
            if (await lockIsStale(lockPath)) {
                await unlink(lockPath).catch(() => undefined)
                continue
            }
            await new Promise((resolveWait) => setTimeout(resolveWait, 50))
        }
    }
    throw new Error(`Timed out waiting for the project index lock at ${lockPath}`)
}

async function lockIsStale(path: string): Promise<boolean> {
    try {
        const value = JSON.parse(await readFile(path, 'utf8')) as {pid?: unknown, createdAt?: unknown}
        if (typeof value.pid === 'number' && Number.isInteger(value.pid) && !processIsAlive(value.pid)) return true
        return typeof value.createdAt !== 'number' || Date.now() - value.createdAt > 60_000
    } catch {
        return true
    }
}

async function projectFilesExist(path: string): Promise<boolean> {
    try {
        return (await stat(path)).isDirectory() && (await stat(resolve(path, 'package.json'))).isFile()
    } catch {
        return false
    }
}

async function readPackageJson(path: string): Promise<Record<string, unknown>> {
    return JSON.parse(await readFile(resolve(path, 'package.json'), 'utf8')) as Record<string, unknown>
}

function isIndexedProject(value: unknown): value is IndexedProject {
    return isRecord(value)
        && typeof value.path === 'string' && isAbsolute(value.path)
        && typeof value.name === 'string' && Boolean(value.name)
        && (value.repoRoot === null || typeof value.repoRoot === 'string' && isAbsolute(value.repoRoot))
        && typeof value.lastOpened === 'string' && Number.isFinite(Date.parse(value.lastOpened))
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function processIsAlive(pid: number): boolean {
    try {
        process.kill(pid, 0)
        return true
    } catch (error) {
        return errorCode(error) === 'EPERM'
    }
}

function errorCode(error: unknown): string | undefined {
    return isRecord(error) && typeof error.code === 'string' ? error.code : undefined
}
