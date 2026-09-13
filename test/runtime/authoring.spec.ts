import {expect, test} from '@playwright/test'

test('createGame publishes read-only hooks and removes them on dispose', async ({page}) => {
    await page.goto('/')
    await expect.poll(() => page.evaluate(() => Boolean(window.__kite3dReady))).toBe(true)

    const first = await page.evaluate(async () => {
        const game = window.__kite3dGame!
        const validation = await game.runGameValidation()
        const telemetry = window.kite3dGame?.telemetry
        const evidence = {
            validation,
            telemetry,
            telemetryFrozen: Object.isFrozen(telemetry),
        }
        game.dispose()
        return evidence
    })

    expect(first.validation).toMatchObject({ok: true, status: 'pass'})
    expect(first.telemetry).toEqual({state: 'playing', nestedAsset: true})
    expect(first.telemetryFrozen).toBe(true)

    const second = await page.evaluate(async () => {
        const {createGame} = await import('/runtime.js')
        const canvas = document.createElement('canvas')
        document.body.append(canvas)
        const game = await createGame({base: new URL('/sample-project/', location.href).href, canvas})
        const cleanup = game.dispose()
        canvas.remove()
        return {cleanup, hookRemoved: window.kite3dGame === undefined}
    })

    expect(second.cleanup).toMatchObject({ok: true, trackedObjectCount: 0})
    expect(second.hookRemoved).toBe(true)
})

declare global {
    interface Window {
        __kite3dGame?: {
            viewer: {
                getPlugin(type: string): unknown
                scene: {
                    modelRoot: object
                }
            }
            runGameValidation(): Promise<unknown>
            dispose(): unknown
        }
        __kite3dErrors: string[]
        __kite3dMainRan?: boolean
        __kite3dReady?: boolean
        __kite3dRuntimeVersion?: string
        __kite3dStartupError?: string
        __kite3dUpdates?: number
    }
}
