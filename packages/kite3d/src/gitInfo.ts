import {execFile} from 'node:child_process'
import {realpath} from 'node:fs/promises'
import {resolve} from 'node:path'
import {promisify} from 'node:util'

const executeFile = promisify(execFile)
const gitTimeoutMilliseconds = 3_000

export interface GitWorktree {
    path: string
    branch: string | null
    head: string
}

export async function repoRoot(path: string): Promise<string | null> {
    const value = await runGit(path, ['rev-parse', '--show-toplevel'])
    return value === null ? null : canonicalGitPath(path, value)
}

export async function repoKey(path: string): Promise<string | null> {
    const value = await runGit(path, ['rev-parse', '--git-common-dir'])
    return value === null ? null : canonicalGitPath(path, value)
}

export async function branch(path: string): Promise<string | null> {
    const value = await runGit(path, ['branch', '--show-current'])
    return value?.trim() || null
}

export async function worktrees(path: string): Promise<GitWorktree[] | null> {
    const value = await runGit(path, ['worktree', 'list', '--porcelain', '-z'])
    if (value === null) return null
    const result: GitWorktree[] = []
    let current: Partial<GitWorktree> = {}
    for (const field of value.split('\0')) {
        if (!field) {
            if (current.path && current.head) {
                result.push({
                    path: resolve(current.path),
                    branch: current.branch ?? null,
                    head: current.head,
                })
            }
            current = {}
        } else if (field.startsWith('worktree ')) {
            current.path = field.slice('worktree '.length)
        } else if (field.startsWith('HEAD ')) {
            current.head = field.slice('HEAD '.length)
        } else if (field.startsWith('branch ')) {
            current.branch = field.slice('branch '.length).replace(/^refs\/heads\//, '')
        }
    }
    return result
}

async function runGit(path: string, args: string[]): Promise<string | null> {
    try {
        const {stdout} = await executeFile('git', args, {
            cwd: resolve(path),
            encoding: 'utf8',
            timeout: gitTimeoutMilliseconds,
            maxBuffer: 1024 * 1024,
        })
        return stdout
    } catch {
        return null
    }
}

async function canonicalGitPath(path: string, value: string): Promise<string | null> {
    try {
        return await realpath(resolve(path, value.trim()))
    } catch {
        return null
    }
}
