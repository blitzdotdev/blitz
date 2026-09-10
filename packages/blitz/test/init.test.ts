import {mkdtemp, readdir, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {initProject} from '../src/commands.ts'
import {BLITZ_VERSION} from '../src/versions.ts'

const roots: string[] = []

afterEach(async () => {
    while (roots.length) await rm(roots.pop()!, {recursive: true, force: true})
})

describe('initProject', () => {
    it('copies the complete template tree with the one rename and stamped versions', async () => {
        const parent = await mkdtemp(resolve(tmpdir(), 'blitz-init-'))
        roots.push(parent)
        const target = resolve(parent, 'My Project')
        await initProject(target)

        const templateRoot = resolve('../template/template')
        const templateFiles = await filesUnder(templateRoot)
        const targetFiles = (await filesUnder(target)).filter((path) => !path.startsWith('.git/'))
        const expected = templateFiles.map((path) => path === 'gitignore' ? '.gitignore' : path).sort()
        expect(targetFiles).toEqual(expected)

        for (const sourcePath of templateFiles.filter((path) => path !== 'package.json')) {
            const destinationPath = sourcePath === 'gitignore' ? '.gitignore' : sourcePath
            expect(await readFile(resolve(target, destinationPath))).toEqual(await readFile(resolve(templateRoot, sourcePath)))
        }
        const packageJson = JSON.parse(await readFile(resolve(target, 'package.json'), 'utf8')) as Record<string, unknown>
        expect(packageJson).not.toHaveProperty('version')
        expect(packageJson).toMatchObject({
            name: 'my-project',
            devDependencies: {'@blitzdev/blitz': BLITZ_VERSION},
            blitz: {version: BLITZ_VERSION},
        })
        const instructions = await readFile(resolve(target, 'AGENTS.md'), 'utf8')
        expect(instructions).toContain('Pointer lock requires a focused browser window')
        expect(instructions).toContain('node_modules/@blitzdev/engine/dist/runtime.js')
        expect(instructions).toContain('Treat a timestamp more than 15 seconds old as stale')
        expect(instructions).toContain('It records `console.warn`, `console.error`')
        expect(instructions).toContain('Authenticated read endpoints are `GET /api/state`, `GET /api/files`')
        expect(instructions).toContain('every key inside `extras.EntityComponentPlugin` stable')
        expect(instructions).toContain('wire a component without the editor UI')
        expect(instructions).toContain('never call `dispose(true)` from inside that root\'s `traverse()`')
        expect(instructions).toContain('use `position: fixed` and copy `viewer.canvas.getBoundingClientRect()`')
        expect(instructions).toContain('Supported JSON settings are `msaa`, `rgbm`')
        expect(instructions).toContain('`PhysicalMaterial` can look very dark')
        expect(instructions).toContain('Then run `npx blitz check`')
        expect(await readFile(resolve('../../docs/agents.md'))).toEqual(await readFile(resolve(templateRoot, 'AGENTS.md')))
    })
})

async function filesUnder(root: string): Promise<string[]> {
    const files: string[] = []
    await walk(root, '')
    return files.sort()

    async function walk(directory: string, prefix: string): Promise<void> {
        for (const entry of await readdir(directory, {withFileTypes: true})) {
            const path = prefix ? `${prefix}/${entry.name}` : entry.name
            if (entry.isDirectory()) await walk(resolve(directory, entry.name), path)
            else if (entry.isFile()) files.push(path)
        }
    }
}
