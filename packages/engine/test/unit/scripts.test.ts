import {beforeAll, describe, expect, it, vi} from 'vitest'
import type {ThreeViewer} from 'threepipe'
import type * as ScriptExports from '../../src/scripts.ts'

let registerScripts: typeof ScriptExports.registerScripts
let EntityComponentPlugin: typeof import('threepipe').EntityComponentPlugin
let Object3DComponent: typeof import('threepipe').Object3DComponent

beforeAll(async () => {
    vi.stubGlobal('ImageData', class ImageData {})
    vi.stubGlobal('window', {location: {href: 'https://example.test/'}})
    const threepipe = await import('threepipe')
    EntityComponentPlugin = threepipe.EntityComponentPlugin
    Object3DComponent = threepipe.Object3DComponent
    registerScripts = (await import('../../src/scripts.ts')).registerScripts
})

describe('registerScripts', () => {
    it('replaces a component class when a reloaded module uses the same type name', async () => {
        class FirstVersion extends Object3DComponent {
            static ComponentType = 'ReloadedComponent'
        }
        class SecondVersion extends Object3DComponent {
            static ComponentType = 'ReloadedComponent'
        }
        const entityComponents = new EntityComponentPlugin(false)
        const viewer = {
            getPlugin: (type: unknown) => type === EntityComponentPlugin ? entityComponents : undefined,
            addPlugin: async () => undefined,
        } as unknown as ThreeViewer

        await registerScripts(viewer, [{FirstVersion}])
        await registerScripts(viewer, [{SecondVersion}])

        expect(entityComponents.componentTypes.get('ReloadedComponent')).toBe(SecondVersion)
    })
})
