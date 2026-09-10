import {expect, test} from '@playwright/test'
import enginePackage from '../../package.json' with {type: 'json'}

test('the published runtime boots scripts, main, and nested assets', async ({page}) => {
    const componentMessages: string[] = []
    const debugLogs: string[] = []
    page.on('console', (message) => {
        if (message.type() === 'log') debugLogs.push(message.text())
        if (!['error', 'warning'].includes(message.type())) return
        const text = message.text()
        if (text.includes('EntityComponentPlugin: unknown component type')) {
            componentMessages.push(text)
        }
    })

    await page.goto('/')
    await expect.poll(() => page.evaluate(() => Boolean(window.__blitzReady))).toBe(true)
    expect(await page.evaluate(() => window.__blitzStartupError)).toBeUndefined()
    expect(await page.evaluate(() => window.__blitzRuntimeVersion)).toBe(enginePackage.version)
    expect(await page.evaluate(() => window.__blitzMainRan)).toBe(true)
    expect(await page.evaluate(() => window.__blitzGame?.viewer.getPlugin('TonemapPlugin'))).toBeUndefined()

    const nestedAssetLoaded = await page.evaluate(() =>
        Boolean(window.__blitzGame?.viewer.scene.modelRoot.getObjectByName('PropMesh'))
    )
    expect(nestedAssetLoaded).toBe(true)

    const generated = await page.evaluate(() => {
        const root = window.__blitzGame?.viewer.scene.modelRoot.getObjectByName('GeneratorRoot')
        return root?.children.map((child) => ({
            generated: child.userData.blitzGenerated,
            excluded: child.userData.excludeFromExport,
        }))
    })
    expect(generated).toHaveLength(3)
    expect(generated).toEqual(Array(3).fill({generated: true, excluded: true}))

    await expect.poll(() => page.evaluate(() => window.__blitzUpdates || 0)).toBeGreaterThan(0)
    const updatesBefore = await page.evaluate(() => window.__blitzUpdates || 0)
    await expect.poll(() => page.evaluate(() => window.__blitzUpdates || 0)).toBeGreaterThan(updatesBefore)
    expect(componentMessages).toEqual([])
    expect(debugLogs).not.toContain('true')

    await page.evaluate(() => window.__blitzGame?.dispose())
})

declare global {
    interface Window {
        __blitzErrors: string[]
        __blitzGame?: {
            viewer: {
                getPlugin(type: string): unknown
                scene: {
                    modelRoot: {
                        getObjectByName(name: string): {
                            children: Array<{userData: Record<string, unknown>}>
                        } | undefined
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
