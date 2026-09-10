import {execFile} from 'node:child_process'
import {access} from 'node:fs/promises'
import {resolve} from 'node:path'
import {promisify} from 'node:util'

const execute = promisify(execFile)
const CHECKPOINT_PREFIX = 'blitz checkpoint'
const COMMIT_ID = /^[a-f\d]{4,64}$/i

export interface CheckpointResult {
    hash: string
    label?: string
}

export async function gitRepositoryRoot(projectRoot = process.cwd()): Promise<string | undefined> {
    try {
        const {stdout} = await git(projectRoot, ['rev-parse', '--show-toplevel'])
        return resolve(stdout.trim())
    } catch {
        return undefined
    }
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
        '-c', 'user.name=Blitz',
        '-c', 'user.email=blitz@localhost',
        'commit', '--allow-empty', '-m', 'Initial Blitz project',
    ])
}

export async function checkpointProject(
    projectRoot = process.cwd(),
    label?: string,
): Promise<CheckpointResult> {
    const root = resolve(projectRoot)
    await requireGitRepository(root)
    const normalizedLabel = label?.trim() || undefined
    const message = normalizedLabel ? `${CHECKPOINT_PREFIX}: ${normalizedLabel}` : CHECKPOINT_PREFIX
    await git(root, ['add', '-A', '--', '.'])
    await git(root, [
        '-c', 'user.name=Blitz',
        '-c', 'user.email=blitz@localhost',
        'commit', '--only', '--allow-empty', '-m', message, '--', '.',
    ])
    return {hash: await shortHead(root), label: normalizedLabel}
}

export async function restoreProject(
    projectRoot = process.cwd(),
    requestedHash?: string,
): Promise<CheckpointResult> {
    const root = resolve(projectRoot)
    await requireGitRepository(root)
    try {
        await access(resolve(root, '.blitz/publish.lock'))
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
        if (!hash) throw new Error('No Blitz checkpoint exists yet. Run blitz checkpoint first.')
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

async function requireGitRepository(projectRoot: string): Promise<void> {
    if (await gitRepositoryRoot(projectRoot)) return
    throw new Error('This project is not a git repository. Run blitz init without --no-git, or run git init.')
}

async function shortHead(projectRoot: string): Promise<string> {
    const {stdout} = await git(projectRoot, ['rev-parse', '--short', 'HEAD'])
    return stdout.trim()
}

function git(projectRoot: string, args: string[]): Promise<{stdout: string, stderr: string}> {
    return execute('git', args, {cwd: projectRoot, encoding: 'utf8', maxBuffer: 1024 * 1024})
}
