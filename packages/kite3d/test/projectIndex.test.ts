import {mkdir, mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {kite3dHomeDirectory, readProjectIndex, registerProject} from '../src/projectIndex.ts'

const cleanup: string[] = []

afterEach(async () => {
    while (cleanup.length) await rm(cleanup.pop()!, {recursive: true, force: true})
    await rm(resolve(kite3dHomeDirectory(), 'projects.json'), {force: true})
})

describe('project index', () => {
    it('registers projects, touches their order, and prunes deleted folders', async () => {
        const parent = await mkdtemp(resolve(tmpdir(), 'kite3d-index-'))
        cleanup.push(parent)
        const first = resolve(parent, 'First Project')
        const second = resolve(parent, 'second')
        await writePackage(first, 'first-game')
        await writePackage(second)
        const canonicalFirst = await realpath(first)
        const canonicalSecond = await realpath(second)

        const firstEntry = await registerProject(first)
        await new Promise((resolveWait) => setTimeout(resolveWait, 5))
        await registerProject(second)
        expect(await readProjectIndex()).toEqual({
            version: 1,
            projects: [
                expect.objectContaining({path: canonicalSecond, name: 'second', repoRoot: null}),
                expect.objectContaining({path: canonicalFirst, name: 'first-game', repoRoot: null}),
            ],
        })

        await new Promise((resolveWait) => setTimeout(resolveWait, 5))
        const touched = await registerProject(first)
        expect(Date.parse(touched.lastOpened)).toBeGreaterThan(Date.parse(firstEntry.lastOpened))
        expect((await readProjectIndex()).projects.map(({path}) => path)).toEqual([canonicalFirst, canonicalSecond])

        await rm(first, {recursive: true})
        expect((await readProjectIndex()).projects.map(({path}) => path)).toEqual([canonicalSecond])
        const written = JSON.parse(await readFile(resolve(kite3dHomeDirectory(), 'projects.json'), 'utf8')) as {
            version: number, projects: Array<{path: string}>
        }
        expect(written).toEqual({version: 1, projects: [expect.objectContaining({path: canonicalSecond})]})
    })
})

async function writePackage(path: string, name?: string): Promise<void> {
    await mkdir(path, {recursive: true})
    await writeFile(resolve(path, 'package.json'), `${JSON.stringify(name ? {name} : {})}\n`)
}
