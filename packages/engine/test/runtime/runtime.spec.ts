import {expect, test} from '@playwright/test'
import {readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import enginePackage from '../../package.json' with {type: 'json'}

const sampleScenePath = fileURLToPath(new URL('../../../editor/test/fixtures/sample-project/assets/main.scene.gltf', import.meta.url))

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

    const nestedAssetMeshCount = await page.evaluate(() => {
        const wrapper = window.__blitzGame?.viewer.scene.modelRoot.getObjectByName('PropRef')
        let count = 0
        wrapper?.traverse((object) => {
            if (object.isMesh) count += 1
        })
        return count
    })
    expect(nestedAssetMeshCount).toBe(1)

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

test('the published runtime replaces a legacy nested asset child instead of duplicating it', async ({page}) => {
    const scene = JSON.parse(await readFile(sampleScenePath, 'utf8')) as {
        nodes: Array<{children?: number[], name?: string, mesh?: number}>
    }
    const wrapper = scene.nodes.find((node) => node.name === 'PropRef')
    if (!wrapper) throw new Error('The runtime fixture is missing PropRef')
    wrapper.children = [scene.nodes.length]
    scene.nodes.push({name: 'PropMesh', mesh: 0})
    await page.route('**/sample-project/assets/main.scene.gltf', async (route) => {
        await route.fulfill({contentType: 'model/gltf+json', json: scene})
    })

    await page.goto('/')
    await expect.poll(() => page.evaluate(() => Boolean(window.__blitzReady))).toBe(true)
    expect(await page.evaluate(() => window.__blitzStartupError)).toBeUndefined()
    const meshCount = await page.evaluate(() => {
        const nestedWrapper = window.__blitzGame?.viewer.scene.modelRoot.getObjectByName('PropRef')
        let count = 0
        nestedWrapper?.traverse((object) => {
            if (object.isMesh) count += 1
        })
        return count
    })
    expect(meshCount).toBe(1)

    await page.evaluate(() => window.__blitzGame?.dispose())
})
