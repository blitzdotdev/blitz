import {access, readFile} from 'node:fs/promises'
import {resolve} from 'node:path'

const BLITZ_PACKAGE = '@blitzdev/blitz'
const MAIN_SCENE = 'assets/main.scene.gltf'

export async function assertBlitzProjectRoot(root = process.cwd()): Promise<void> {
    const missing: string[] = []
    if (!await hasBlitzDependency(root)) {
        missing.push(`package.json with an ${BLITZ_PACKAGE} dependency`)
    }
    if (!await exists(resolve(root, MAIN_SCENE))) missing.push(MAIN_SCENE)
    if (!missing.length) return

    throw new Error(
        `Not a Blitz project root: missing ${joinMissing(missing)}. `
        + 'cd into a Blitz project or run blitz init. '
        + 'Start with: npx @blitzdev/blitz init my-game',
    )
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
