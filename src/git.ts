import {execFile} from 'node:child_process'
import {realpath} from 'node:fs/promises'
import {resolve} from 'node:path'
import {promisify} from 'node:util'

const execute = promisify(execFile)
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

function git(projectRoot: string, args: string[]): Promise<{stdout: string, stderr: string}> {
    return execute('git', args, {cwd: projectRoot, encoding: 'utf8', maxBuffer: 1024 * 1024})
}
