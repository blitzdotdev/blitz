import {constants} from 'node:fs'
import {access, readdir, realpath, stat} from 'node:fs/promises'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

export interface BundledSkill {
    name: string
    path: string
}

/** Locate skills shipped beside the invoked CLI package, independent of the working directory. */
export async function bundledSkills(): Promise<BundledSkill[]> {
    const root = fileURLToPath(new URL('../skills/', import.meta.url))
    let entries
    try {
        entries = await readdir(root, {withFileTypes: true})
    } catch (error) {
        throw new Error(`Could not read bundled skills directory at ${root}: ${errorMessage(error)}`)
    }

    const skills: BundledSkill[] = []
    const names = entries.filter((entry) => entry.isDirectory()).map(({name}) => name).sort()
    for (const name of names) {
        const path = resolve(root, name, 'SKILL.md')
        try {
            if (!(await stat(path)).isFile()) continue
            await access(path, constants.R_OK)
            skills.push({name, path: await realpath(path)})
        } catch (error) {
            if (errorCode(error) === 'ENOENT') continue
            throw new Error(`Could not read bundled skill at ${path}: ${errorMessage(error)}`)
        }
    }
    return skills
}

function errorCode(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
    return String(error.code)
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}
