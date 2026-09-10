import {beforeAll, describe, expect, it, vi} from 'vitest'
import type {IObject3D, ThreeViewer} from 'threepipe'
import type * as GeneratorExports from '../../src/plugins/GeneratorComponent.ts'

let generator: typeof GeneratorExports

beforeAll(async () => {
    vi.stubGlobal('ImageData', class ImageData {})
    vi.stubGlobal('window', {location: {href: 'https://example.test/'}})
    generator = await import('../../src/plugins/GeneratorComponent.ts')
})

describe('Generator', () => {
    it('replaces old generated children and marks returned and attached children', async () => {
        const node = new FakeObject()
        const human = new FakeObject('Human')
        const old = new FakeObject('Old generated')
        generator.markGenerated(old as unknown as IObject3D)
        node.add(human, old)
        const returned = new FakeObject('Returned')
        const attached = new FakeObject('Attached')
        const generate = vi.fn(({node: target}: {node: FakeObject}) => {
            target.add(attached)
            return returned
        })

        const generated = await generator.runGenerator({
            node: node as unknown as IObject3D,
            params: {count: 2},
            viewer: {} as ThreeViewer,
            engine: {},
            module: 'generators/forest.js',
            base: new URL('https://example.test/files/'),
            importModule: async () => ({default: generate as never}),
        })

        expect(node.children.map(({name}) => name)).toEqual(['Human', 'Attached', 'Returned'])
        expect(generated).toEqual([attached, returned])
        expect(generate).toHaveBeenCalledOnce()
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

class FakeObject {
    readonly isObject3D = true
    readonly children: FakeObject[] = []
    readonly userData: Record<string, unknown> = {}
    parent?: FakeObject

    constructor(readonly name = '') {}

    add(...children: FakeObject[]): void {
        for (const child of children) {
            child.parent?.remove(child)
            child.parent = this
            this.children.push(child)
        }
    }

    remove(child: FakeObject): void {
        const index = this.children.indexOf(child)
        if (index >= 0) this.children.splice(index, 1)
        child.parent = undefined
    }

    traverse(visitor: (object: FakeObject) => void): void {
        visitor(this)
        for (const child of this.children) child.traverse(visitor)
    }
}
