import {expect, test} from '@playwright/test'

test('the published runtime boots scripts, main, and nested assets', async ({page}) => {
    const componentMessages: string[] = []
    page.on('console', (message) => {
        if (!['error', 'warning'].includes(message.type())) return
        const text = message.text()
        if (text.includes('EntityComponentPlugin: unknown component type')) {
            componentMessages.push(text)
        }
    })

    await page.goto('/')
    await expect.poll(() => page.evaluate(() => Boolean(window.__blitzReady))).toBe(true)
    expect(await page.evaluate(() => window.__blitzStartupError)).toBeUndefined()
    expect(await page.evaluate(() => window.__blitzRuntimeVersion)).toBe('0.12.0')
    expect(await page.evaluate(() => window.__blitzMainRan)).toBe(true)

    const nestedAssetLoaded = await page.evaluate(() =>
        Boolean(window.__blitzGame?.viewer.scene.modelRoot.getObjectByName('PropMesh'))
    )
    expect(nestedAssetLoaded).toBe(true)

    await expect.poll(() => page.evaluate(() => window.__blitzUpdates || 0)).toBeGreaterThan(0)
    const updatesBefore = await page.evaluate(() => window.__blitzUpdates || 0)
    await expect.poll(() => page.evaluate(() => window.__blitzUpdates || 0)).toBeGreaterThan(updatesBefore)
    expect(componentMessages).toEqual([])

    await page.evaluate(() => window.__blitzGame?.dispose())
})

declare global {
    interface Window {
        __blitzErrors: string[]
        __blitzGame?: {
            viewer: {
                scene: {
                    modelRoot: {
                        getObjectByName(name: string): unknown
                    }
                }
            }
            dispose(): void
        }
        __blitzMainRan?: boolean
        __blitzReady?: boolean
        __blitzRuntimeVersion?: string
        __blitzStartupError?: string
        __blitzUpdates?: number
    }
}
