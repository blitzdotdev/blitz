import {access, readFile, readdir} from 'node:fs/promises'
import {resolve} from 'node:path'

const BLITZ_PACKAGE = '@blitzdev/blitz'
const MAIN_SCENE = 'assets/main.scene.gltf'

export async function assertBlitzProjectRoot(root = process.cwd()): Promise<void> {
    const missing: string[] = []
    const hasDependency = await hasBlitzDependency(root)
    const hasMainScene = await exists(resolve(root, MAIN_SCENE))
    if (!hasDependency) {
        missing.push(`package.json with an ${BLITZ_PACKAGE} dependency`)
    }
    if (!hasMainScene) missing.push(MAIN_SCENE)
    if (!missing.length) return

    const childProjects = await findChildBlitzProjects(root)
    const suggestions = childProjects.length
        ? `\nBlitz projects in child directories:\n${childProjects.map((name) => `  cd ${name} && npx blitz dev`).join('\n')}`
        : ''
    throw new Error(
        `This folder is not a Blitz project: missing ${joinMissing(missing)}. `
        + 'cd into a Blitz project or run blitz init. '
        + 'Start with: npx @blitzdev/blitz init my-game'
        + suggestions,
    )
}

export async function isBlitzProjectRoot(root: string): Promise<boolean> {
    return await hasBlitzDependency(root) && await exists(resolve(root, MAIN_SCENE))
}

async function findChildBlitzProjects(root: string): Promise<string[]> {
    const projects: string[] = []
    const entries = await readdir(root, {withFileTypes: true}).catch((error: unknown) => {
        if (isMissing(error)) return []
        throw error
    })
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        if (!entry.isDirectory() || !await isBlitzProjectRoot(resolve(root, entry.name))) continue
        projects.push(entry.name)
        if (projects.length === 5) break
    }
    return projects
}

async function hasBlitzDependency(root: string): Promise<boolean> {
    try {
        const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as {
            dependencies?: Record<string, unknown>
            devDependencies?: Record<string, unknown>
        }
        return [manifest.dependencies, manifest.devDependencies].some((dependencies) =>
            typeof dependencies?.[BLITZ_PACKAGE] === 'string' && dependencies[BLITZ_PACKAGE] !== '')
    } catch (error) {
        if (error instanceof SyntaxError || isMissing(error)) return false
        throw error
    }
}

async function exists(path: string): Promise<boolean> {
    try {
        await access(path)
        return true
    } catch (error) {
        if (isMissing(error)) return false
        throw error
    }
}

function isMissing(error: unknown): boolean {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function joinMissing(paths: string[]): string {
    return paths.length === 1 ? paths[0] : `${paths.slice(0, -1).join(', ')} and ${paths.at(-1)}`
}
