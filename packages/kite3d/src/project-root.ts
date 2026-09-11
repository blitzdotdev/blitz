import {access, readFile, readdir} from 'node:fs/promises'
import {resolve} from 'node:path'

const KITE3D_PACKAGE = 'kite3d'
const MAIN_SCENE = 'assets/main.scene.gltf'

export async function assertKite3dProjectRoot(root = process.cwd()): Promise<void> {
    const missing: string[] = []
    const hasDependency = await hasKite3dDependency(root)
    const hasMainScene = await exists(resolve(root, MAIN_SCENE))
    if (!hasDependency) {
        missing.push(`package.json with a ${KITE3D_PACKAGE} dependency`)
    }
    if (!hasMainScene) missing.push(MAIN_SCENE)
    if (!missing.length) return

    const childProjects = await findChildKite3dProjects(root)
    const suggestions = childProjects.length
        ? `\nKite3D projects in child directories:\n${childProjects.map((name) => `  cd ${name} && npx kite3d dev`).join('\n')}`
        : ''
    throw new Error(
        `This folder is not a Kite3D project: missing ${joinMissing(missing)}. `
        + 'cd into a Kite3D project or run kite3d init. '
        + 'Start with: npx kite3d init my-game'
        + suggestions,
    )
}

export async function isKite3dProjectRoot(root: string): Promise<boolean> {
    return await hasKite3dDependency(root) && await exists(resolve(root, MAIN_SCENE))
}

async function findChildKite3dProjects(root: string): Promise<string[]> {
    const projects: string[] = []
    const entries = await readdir(root, {withFileTypes: true}).catch((error: unknown) => {
        if (isMissing(error)) return []
        throw error
    })
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        if (!entry.isDirectory() || !await isKite3dProjectRoot(resolve(root, entry.name))) continue
        projects.push(entry.name)
        if (projects.length === 5) break
    }
    return projects
}

async function hasKite3dDependency(root: string): Promise<boolean> {
    try {
        const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as {
            dependencies?: Record<string, unknown>
            devDependencies?: Record<string, unknown>
        }
        return [manifest.dependencies, manifest.devDependencies].some((dependencies) =>
            typeof dependencies?.[KITE3D_PACKAGE] === 'string' && dependencies[KITE3D_PACKAGE] !== '')
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
