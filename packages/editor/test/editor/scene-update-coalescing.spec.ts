import {expect, test} from '@playwright/test'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import {initProject, runDev} from '../../../kite3d/src/commands.ts'
import {startMockBackend} from '../../../kite3d/test/mockBackend.ts'
import {closeFixtureSteps} from './fixtureClose.ts'

let root: string
let server: Awaited<ReturnType<typeof runDev>>
let backend: Awaited<ReturnType<typeof startMockBackend>>

test.beforeAll(async () => {
    root = await mkdtemp(resolve(tmpdir(), 'kite3d-scene-update-coalescing-'))
    await initProject(root)
    backend = await startMockBackend()
    server = await runDev({projectRoot: root, port: 0, noOpen: true, backendUrl: backend.url})
})

test.afterAll(async () => {
    try {
        await closeFixtureSteps([
            {name: 'coalescing editor server', close: () => server.close()},
            {name: 'coalescing mock backend', close: () => backend.close()},
        ])
    } finally {
        await rm(root, {recursive: true, force: true})
    }
})

/**
 * Dragging a gizmo moves every selected object, and each one reports its own sceneUpdate
 * inside a single frame. Every stateChange re-renders the whole editor tree, so the
 * manager must collapse a frame's worth of updates into one dispatch.
 */
test('a burst of scene updates in one frame dispatches one stateChange', async ({page}) => {
    await page.goto(server.url)
    await expect(page.getByText('Project loaded')).toBeVisible({timeout: 20_000})

    const result = await page.evaluate(async () => {
        interface Manager {
            saveScene: () => Promise<boolean>
            startPlay: (canvas: HTMLCanvasElement) => Promise<void>
            addEventListener: (type: string, listener: () => void) => void
            removeEventListener: (type: string, listener: () => void) => void
        }
        const isManager = (value: unknown): value is Manager => Boolean(value)
            && typeof value === 'object'
            && typeof (value as Manager).saveScene === 'function'
            && typeof (value as Manager).startPlay === 'function'
            && typeof (value as Manager).addEventListener === 'function'

        // The manager lives in React context, so reach it through the fiber behind a
        // component that consumes it. No production code exists only for this test.
        const findManager = (): Manager | undefined => {
            const element = document.querySelector('[data-testid="save-scene"]')
            if (!element) return undefined
            const fiberKey = Object.keys(element).find((key) => key.startsWith('__reactFiber$'))
            if (!fiberKey) return undefined
            let fiber = (element as unknown as Record<string, {return?: unknown} | undefined>)[fiberKey]
            for (let depth = 0; fiber && depth < 200; depth += 1) {
                const frame = fiber as unknown as Record<string, unknown>
                for (const slot of ['memoizedProps', 'memoizedState', 'stateNode']) {
                    const holder = frame[slot]
                    if (!holder || typeof holder !== 'object') continue
                    if (isManager(holder)) return holder
                    for (const value of Object.values(holder as Record<string, unknown>)) {
                        if (isManager(value)) return value
                    }
                }
                fiber = frame.return as {return?: unknown} | undefined
            }
            return undefined
        }

        const manager = findManager()
        if (!manager) throw new Error('Could not reach ViewerInstanceManager through the save button fiber')

        const scene = (window as unknown as {viewer: {
            scene: {
                dispatchEvent: (event: Record<string, unknown>) => void
                modelRoot: unknown,
            },
        }}).viewer.scene
        // A freshly created project has an empty model root, so the root itself stands in
        // for the moved object. What matters is that every event carries one.
        const object = scene.modelRoot
        const nextFrame = () => new Promise<void>((done) => requestAnimationFrame(() => done()))
        const emit = () => scene.dispatchEvent({type: 'sceneUpdate', object, change: 'transform'})

        // The first edit flips the unsaved flag, which dispatches on its own. Settle that
        // transition before counting so the burst is the only thing under measurement.
        emit()
        await nextFrame()
        await nextFrame()
        await nextFrame()

        let dispatches = 0
        const count = () => {
            dispatches += 1
        }
        manager.addEventListener('stateChange', count)
        const burst = 20
        for (let index = 0; index < burst; index += 1) emit()
        await nextFrame()
        await nextFrame()
        manager.removeEventListener('stateChange', count)
        return {dispatches, burst}
    })

    expect(result.burst).toBe(20)
    expect(result.dispatches).toBe(1)
})

// Coalescing must delay the dispatch, never drop it: the editor still has to notice the
// edit and offer to save it.
test('a coalesced scene update still enables Save Scene', async ({page}) => {
    await page.goto(server.url)
    await expect(page.getByText('Project loaded')).toBeVisible({timeout: 20_000})
    await expect(page.getByTestId('save-scene')).toBeDisabled()

    await page.evaluate(() => {
        const scene = (window as unknown as {viewer: {
            scene: {
                dispatchEvent: (event: Record<string, unknown>) => void
                modelRoot: unknown,
            },
        }}).viewer.scene
        scene.dispatchEvent({type: 'sceneUpdate', object: scene.modelRoot, change: 'transform'})
    })

    await expect(page.getByTestId('save-scene')).toBeEnabled({timeout: 5_000})
})
