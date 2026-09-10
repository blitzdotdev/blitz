import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import type {Group as ThreeGroup, ThreeViewer} from 'threepipe'
import type * as GeneratorExports from '../../src/plugins/GeneratorComponent.ts'

let generator: typeof GeneratorExports
let Group: typeof ThreeGroup
let generatorDirectory: string
let generatorBase: URL

beforeAll(async () => {
    vi.stubGlobal('ImageData', class ImageData {})
    vi.stubGlobal('window', {location: {href: 'https://example.test/'}})
    generator = await import('../../src/plugins/GeneratorComponent.ts')
    Group = (await import('threepipe')).Group
    generatorDirectory = await mkdtemp(resolve(import.meta.dirname, 'generator-'))
    generatorBase = pathToFileURL(`${generatorDirectory}/`)
    await writeFile(resolve(generatorDirectory, 'forest.mjs'), `
export default function generate({node}) {
    node.add(node.userData.attached)
    return node.userData.returned
}
`)
})

afterAll(async () => rm(generatorDirectory, {recursive: true, force: true}))

describe('Generator', () => {
    it('replaces old generated children and marks returned and attached children', async () => {
        const node = new Group()
        const human = new Group()
        human.name = 'Human'
        const old = new Group()
        old.name = 'Old generated'
        generator.markGenerated(old)
        node.add(human, old)
        const returned = new Group()
        returned.name = 'Returned'
        const attached = new Group()
        attached.name = 'Attached'
        node.userData.returned = returned
        node.userData.attached = attached

        const generated = await generator.runGenerator({
            node,
            params: {count: 2},
            viewer: {} as ThreeViewer,
            module: 'forest.mjs',
            base: generatorBase,
        })

        expect(node.children.map(({name}) => name)).toEqual(['Human', 'Attached', 'Returned'])
        expect(generated).toEqual([attached, returned])
        for (const child of generated) {
            expect(child.userData).toMatchObject({blitzGenerated: true, excludeFromExport: true})
        }
    })

    it('accepts only same-origin project-relative module paths', () => {
        const base = new URL('https://example.test/files/')
        expect(generator.resolveGeneratorModule('generators/forest.js', base).href)
            .toBe('https://example.test/files/generators/forest.js')
        expect(() => generator.resolveGeneratorModule('/generators/forest.js', base)).toThrow('project-relative')
        expect(() => generator.resolveGeneratorModule('https://elsewhere.test/a.js', base)).toThrow('project-relative')
    })
})
