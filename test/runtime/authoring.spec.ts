import {expect, test} from '@playwright/test'

test('createGame publishes read-only hooks and generator previews survive a reload without multiplying', async ({page}) => {
    await page.goto('/')
    await expect.poll(() => page.evaluate(() => Boolean(window.__blitzReady))).toBe(true)

    const first = await page.evaluate(async () => {
        const game = window.__blitzGame!
        const root = game.viewer.scene.modelRoot.getObjectByName('GeneratorRoot')!
        const validation = await game.runGameValidation()
        const telemetry = window.blitzGame?.telemetry
        const evidence = {
            generator: root.userData.blitzAuthoring,
            previews: root.children.map((child) => ({
                name: child.name,
                z: Object.is(child.position.z, -0) ? 0 : child.position.z,
                authoring: child.userData.blitzAuthoring,
            })),
            validation,
            telemetry,
            telemetryFrozen: Object.isFrozen(telemetry),
        }
        game.dispose()
        return evidence
    })

    expect(first.generator).toMatchObject({role: 'generator', id: expect.any(String)})
    expect(first.previews).toHaveLength(3)
    expect(first.previews.map(({z}) => z)).toEqual([0, -0.5, -1])
    expect(first.previews.every(({authoring}) =>
        authoring.role === 'generator' && authoring.sourceId === first.generator.id)).toBe(true)
    expect(first.validation).toMatchObject({ok: true, status: 'pass'})
    expect(first.telemetry).toEqual({state: 'playing', generated: 3})
    expect(first.telemetryFrozen).toBe(true)

    const second = await page.evaluate(async () => {
        const {createGame} = await import('/runtime.js')
        const canvas = document.createElement('canvas')
        document.body.append(canvas)
        const game = await createGame({base: new URL('/sample-project/', location.href).href, canvas})
        const root = game.viewer.scene.modelRoot.getObjectByName('GeneratorRoot')!
        const previews = root.children.map((child) => ({
            name: child.name,
            z: Object.is(child.position.z, -0) ? 0 : child.position.z,
        }))
        const cleanup = game.dispose()
        canvas.remove()
        return {previews, cleanup, hookRemoved: window.blitzGame === undefined}
    })

    expect(second.previews).toEqual(first.previews.map(({name, z}) => ({name, z})))
    expect(second.cleanup).toMatchObject({ok: true, trackedObjectCount: 0})
    expect(second.hookRemoved).toBe(true)
})

declare global {
    interface Window {
        __blitzGame?: {
            viewer: {
                getPlugin(type: string): unknown
                scene: {
                    modelRoot: {
                        getObjectByName(name: string): {
                            userData: Record<string, unknown>
                            children: Array<{
                                name: string
                                position: {z: number}
                                userData: Record<string, unknown>
                            }>
                        } | undefined
                    }
                }
            }
            runGameValidation(): Promise<unknown>
            dispose(): unknown
        }
        __blitzErrors: string[]
        __blitzMainRan?: boolean
        __blitzReady?: boolean
        __blitzRuntimeVersion?: string
        __blitzStartupError?: string
        __blitzUpdates?: number
    }
}
