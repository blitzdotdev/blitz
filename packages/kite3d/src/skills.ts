import {readdir, realpath} from 'node:fs/promises'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

export interface BundledSkill {
    name: string
    path: string
}

/** Locate skills shipped beside the invoked CLI package, independent of the working directory. */
export async function bundledSkills(): Promise<BundledSkill[]> {
    const root = fileURLToPath(new URL('../skills/', import.meta.url))
    const entries = await readdir(root, {withFileTypes: true})
    const names = entries.filter((entry) => entry.isDirectory()).map(({name}) => name).sort()
    return Promise.all(names.map(async (name) => ({
        name,
        path: await realpath(resolve(root, name, 'SKILL.md')),
    })))
}
