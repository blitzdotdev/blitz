import {execFile} from 'node:child_process'
import {constants} from 'node:fs'
import {access, mkdir, mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {isAbsolute, resolve} from 'node:path'
import {promisify} from 'node:util'
import {afterEach, describe, expect, it} from 'vitest'

const execute = promisify(execFile)
const cli = resolve('dist/cli.js')
const cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
    while (cleanup.length) await cleanup.pop()!()
})

async function temporaryDirectory(): Promise<string> {
    const root = await mkdtemp(resolve(tmpdir(), 'kite3d skills '))
    cleanup.push(() => rm(root, {recursive: true, force: true}))
    return root
}

function listedSkills(stdout: string): Array<{name: string, path: string}> {
    return stdout.trimEnd().split('\n').filter(Boolean).map((line) => {
        const separator = line.indexOf('\t')
        expect(separator).toBeGreaterThan(0)
        expect(line.indexOf('\t', separator + 1)).toBe(-1)
        return {name: line.slice(0, separator), path: line.slice(separator + 1)}
    })
}

describe('kite3d skills', () => {
    it('prints a readable absolute path from a directory with no package.json', async () => {
        const cwd = await temporaryDirectory()
        const result = await execute(process.execPath, [cli, 'skills'], {cwd})
        expect(result.stderr).toBe('')
        const entries = listedSkills(result.stdout)
        expect(entries).toHaveLength(1)
        expect(entries[0]).toEqual({
            name: 'kite3d-project',
            path: await realpath(resolve('skills/kite3d-project/SKILL.md')),
        })
        expect(isAbsolute(entries[0].path)).toBe(true)
        await expect(access(entries[0].path, constants.R_OK)).resolves.toBeUndefined()
        expect(await readFile(entries[0].path, 'utf8')).toContain('name: kite3d-project')
    })

    it('prints the stable entry shape as JSON', async () => {
        const cwd = await temporaryDirectory()
        const result = await execute(process.execPath, [cli, 'skills', '--json'], {cwd})
        expect(result.stderr).toBe('')
        expect(JSON.parse(result.stdout)).toEqual([{
            name: 'kite3d-project',
            path: await realpath(resolve('skills/kite3d-project/SKILL.md')),
        }])
    })

    it('does not require migration, installation, or version delegation', async () => {
        const cwd = await temporaryDirectory()
        await writeFile(resolve(cwd, 'package.json'), JSON.stringify({
            devDependencies: {kite3d: '0.0.1'},
            kite3d: {version: '0.0.1'},
        }))
        const result = await execute(process.execPath, [cli, 'skills'], {cwd})
        expect(listedSkills(result.stdout)[0].name).toBe('kite3d-project')
        expect(result.stderr).toBe('')
    })

    it.each([['--install'], ['kite3d-project']])('rejects unsupported arguments: %s', async (argument) => {
        await expect(execute(process.execPath, [cli, 'skills', argument])).rejects.toMatchObject({
            code: 1,
            stdout: '',
        })
    })

    it('ships readable skills in the npm tarball and discovers them in name order', async () => {
        const root = await temporaryDirectory()
        const packed = await execute('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', root])
        const [{filename, files}] = JSON.parse(packed.stdout) as Array<{
            filename: string
            files: Array<{path: string}>
        }>
        expect(files.map(({path}) => path)).toContain('skills/kite3d-project/SKILL.md')
        await execute('tar', ['-xzf', resolve(root, filename), '-C', root])

        const packedModule = resolve(root, 'package/dist/skills.js')
        const runner = resolve(root, 'list-skills.mjs')
        await writeFile(runner, [
            "import {pathToFileURL} from 'node:url'",
            `const {bundledSkills} = await import(pathToFileURL(${JSON.stringify(packedModule)}).href)`,
            'console.log(JSON.stringify(await bundledSkills()))',
        ].join('\n'))
        const first = JSON.parse((await execute(process.execPath, [runner], {cwd: '/'})).stdout) as Array<{
            name: string
            path: string
        }>
        expect(first).toEqual([{
            name: 'kite3d-project',
            path: await realpath(resolve(root, 'package/skills/kite3d-project/SKILL.md')),
        }])
        await expect(access(first[0].path, constants.R_OK)).resolves.toBeUndefined()

        const next = resolve(root, 'package/skills/a-other')
        await mkdir(next)
        await writeFile(resolve(next, 'SKILL.md'), '---\nname: a-other\n---\n')
        const second = JSON.parse((await execute(process.execPath, [runner], {cwd: '/'})).stdout) as Array<{
            name: string
            path: string
        }>
        expect(second.map(({name}) => name)).toEqual(['a-other', 'kite3d-project'])
    })
})
