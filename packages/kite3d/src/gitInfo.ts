import {execFile} from 'node:child_process'
import {realpath} from 'node:fs/promises'
import {basename, dirname, resolve} from 'node:path'
import {promisify} from 'node:util'

const executeFile = promisify(execFile)

interface GitHead {
    branch: string | null
    head: string | null
}

// The folder of the repository's main worktree. Every worktree of one repository reports the same
// one, which is what the picker groups rows by, and its last segment names the group.
export async function repoRoot(path: string): Promise<string | null> {
    const commonDirectory = await runGit(path, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
    if (!commonDirectory) return null
    const root = basename(commonDirectory) === '.git' ? dirname(commonDirectory) : commonDirectory
    try {
        return await realpath(root)
    } catch {
        return null
    }
}

// The label for a project row: the branch, or the short commit when HEAD is detached. Both are null
// outside a repository. A detached HEAD costs the second call, which almost no project pays.
export async function gitHead(path: string): Promise<GitHead> {
    const branch = await runGit(path, ['branch', '--show-current'])
    if (branch === null) return {branch: null, head: null}
    if (branch) return {branch, head: null}
    return {branch: null, head: await runGit(path, ['rev-parse', '--short', 'HEAD'])}
}

// Null when git failed, which is what a folder outside a repository does.
async function runGit(path: string, args: string[]): Promise<string | null> {
    try {
        const {stdout} = await executeFile('git', args, {cwd: resolve(path), encoding: 'utf8', timeout: 3_000})
        return stdout.trim()
    } catch {
        return null
    }
}
