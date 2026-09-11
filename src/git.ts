import {execFile} from 'node:child_process'
import {access, realpath} from 'node:fs/promises'
import {resolve} from 'node:path'
import {promisify} from 'node:util'

const execute = promisify(execFile)
const CHECKPOINT_PREFIX = 'kite3d checkpoint'
const COMMIT_ID = /^[a-f\d]{4,64}$/i

export interface CheckpointResult {
    hash: string
    label?: string
}

export interface GitProjectOptions {
    allowParentRepo?: boolean
}

export async function gitRepositoryRoot(projectRoot = process.cwd()): Promise<string | undefined> {
    try {
        const {stdout} = await git(projectRoot, ['rev-parse', '--show-toplevel'])
        const requested = resolve(projectRoot)
        const repository = resolve(stdout.trim())
        return await realpath(requested) === await realpath(repository) ? requested : repository
    } catch {
        return undefined
    }
}

export async function gitTracksProject(projectRoot = process.cwd()): Promise<boolean> {
    if (!await gitRepositoryRoot(projectRoot)) return false
    const {stdout} = await git(projectRoot, ['ls-files', '--', '.'])
    return stdout.trim().length > 0
}

export async function gitHead(projectRoot = process.cwd()): Promise<string | undefined> {
    if (!await gitRepositoryRoot(projectRoot)) return undefined
    try {
        const {stdout} = await git(projectRoot, ['rev-parse', 'HEAD'])
        return stdout.trim() || undefined
    } catch {
        return undefined
    }
}

export async function initializeGitRepository(projectRoot: string): Promise<void> {
    await git(projectRoot, ['init'])
    await git(projectRoot, ['add', '-A', '--', '.'])
    await git(projectRoot, [
        '-c', 'user.name=Kite3D',
        '-c', 'user.email=kite3d@localhost',
        'commit', '--allow-empty', '-m', 'Initial Kite3D project',
    ])
}

export async function checkpointProject(
    projectRoot = process.cwd(),
    label?: string,
    options: GitProjectOptions = {},
): Promise<CheckpointResult> {
    const root = resolve(projectRoot)
    await requireGitRepository(root, options)
    const normalizedLabel = label?.trim() || undefined
    const message = normalizedLabel ? `${CHECKPOINT_PREFIX}: ${normalizedLabel}` : CHECKPOINT_PREFIX
    await git(root, ['add', '-A', '--', '.'])
    await git(root, [
        '-c', 'user.name=Kite3D',
        '-c', 'user.email=kite3d@localhost',
        'commit', '--only', '--allow-empty', '-m', message, '--', '.',
    ])
    return {hash: await shortHead(root), label: normalizedLabel}
}

export async function latestCheckpointProject(projectRoot = process.cwd()): Promise<CheckpointResult | undefined> {
    const root = resolve(projectRoot)
    if (await gitRepositoryRoot(root) !== root) return undefined
    const {stdout} = await git(root, [
        'log', '-n', '1', '--format=%h%x00%s', `--grep=^${CHECKPOINT_PREFIX}`,
    ])
    const entry = stdout.trim()
    if (!entry) return undefined
    const [hash, subject] = entry.split('\0', 2)
    const labelPrefix = `${CHECKPOINT_PREFIX}: `
    return {
        hash,
        ...(subject.startsWith(labelPrefix) ? {label: subject.slice(labelPrefix.length)} : {}),
    }
}

export async function restoreProject(
    projectRoot = process.cwd(),
    requestedHash?: string,
    options: GitProjectOptions = {},
): Promise<CheckpointResult> {
    const root = resolve(projectRoot)
    await requireGitRepository(root, options)
    try {
        await access(resolve(root, '.kite3d/publish.lock'))
        throw Object.assign(new Error('Cannot restore while a publish is in progress. Wait for publish to finish and try again.'), {
            status: 409,
            code: 'publish_locked',
        })
    } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }

    let hash = requestedHash?.trim()
    if (hash && !COMMIT_ID.test(hash)) throw new Error(`Invalid checkpoint hash: ${hash}`)
    if (!hash) {
        const {stdout} = await git(root, ['log', '-n', '1', '--format=%H', `--grep=^${CHECKPOINT_PREFIX}`])
        hash = stdout.trim()
        if (!hash) throw new Error('No Kite3D checkpoint exists yet. Run kite3d checkpoint first.')
    }
    let commit: string
    try {
        ({stdout: commit} = await git(root, ['rev-parse', '--verify', `${hash}^{commit}`]))
    } catch {
        throw new Error(`Checkpoint not found: ${hash}`)
    }
    commit = commit.trim()
    await git(root, ['checkout', commit, '--', '.'])
    const {stdout: short} = await git(root, ['rev-parse', '--short', commit])
    return {hash: short.trim()}
}

async function requireGitRepository(projectRoot: string, options: GitProjectOptions): Promise<void> {
    const repository = await gitRepositoryRoot(projectRoot)
    if (!repository) {
        throw new Error('This project is not a git repository. Run kite3d init without --no-git, or run git init.')
    }
    if (repository !== projectRoot && !options.allowParentRepo) {
        throw new Error(`The Git repository root is ${repository}, not the project root ${projectRoot}. Pass --allow-parent-repo to use it.`)
    }
}

async function shortHead(projectRoot: string): Promise<string> {
    const {stdout} = await git(projectRoot, ['rev-parse', '--short', 'HEAD'])
    return stdout.trim()
}

function git(projectRoot: string, args: string[]): Promise<{stdout: string, stderr: string}> {
    return execute('git', args, {cwd: projectRoot, encoding: 'utf8', maxBuffer: 1024 * 1024})
}
