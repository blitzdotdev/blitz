import {expect, test, type Page} from '@playwright/test'

test.beforeEach(async ({page}) => {
    await page.goto('/test-shell.html')
})

test('registers project component types before loading the scene that uses them', async ({page}) => {
    const unknownComponentWarnings: string[] = []
    page.on('console', (message) => {
        if (message.text().includes('unknown component type')) unknownComponentWarnings.push(message.text())
    })

    const result = await page.evaluate(async () => {
        const {createGame} = await import('/runtime.js')
        const canvas = document.createElement('canvas')
        document.body.append(canvas)
        const errors: string[] = []
        const game = await createGame({
            base: new URL('/fixtures/startup-order/', location.href).href,
            canvas,
            onError: (error: unknown) => errors.push(String(error)),
        })
        ;(window as any).__startupOrderGame = game
        return {
            errors,
            mainRan: Boolean((window as any).__startupOrderMainRan),
            registeredBeforePlugin: Boolean((window as any).__componentRegisteredBeforePlugin),
            registeredBeforeScriptPlugin: Boolean((window as any).__componentRegisteredBeforeScriptPlugin),
        }
    })

    await expect.poll(() => page.evaluate(() => (window as any).__startupOrderUpdates || 0)).toBeGreaterThan(0)
    expect(result).toEqual({
        errors: [],
        mainRan: true,
        registeredBeforePlugin: true,
        registeredBeforeScriptPlugin: true,
    })
    expect(unknownComponentWarnings).toEqual([])
    expect(await page.evaluate(() => (window as any).__startupOrderGame.dispose())).toMatchObject({ok: true})
})

test('reports a missing main scene through onError and the console with its path', async ({page}) => {
    const consoleErrors = collectConsoleErrors(page)
    const result = await attemptCreateGame(page, 'missing-scene')

    expect(result.callbackErrors).toHaveLength(1)
    expect(result.callbackErrors[0]).toContain('assets/not-there.scene.gltf')
    expect(result.thrown).toContain('assets/not-there.scene.gltf')
    expect(consoleErrors.some((message) =>
        message.includes('[blitz] Runtime error') && message.includes('assets/not-there.scene.gltf'))).toBe(true)
})

test('reports a corrupt glTF through onError with the scene filename', async ({page}) => {
    const result = await attemptCreateGame(page, 'corrupt-scene')

    expect(result.callbackErrors).toHaveLength(1)
    expect(result.callbackErrors[0]).toContain('corrupt.scene.gltf')
    expect(result.thrown).toContain('corrupt.scene.gltf')
})

test('rejects a missing blitz.scripts module with its path', async ({page}) => {
    const result = await attemptCreateGame(page, 'missing-script')

    expect(result.callbackErrors).toHaveLength(1)
    expect(result.callbackErrors[0]).toContain('scripts/not-there.script.js')
    expect(result.thrown).toContain('scripts/not-there.script.js')
})

function collectConsoleErrors(page: Page): string[] {
    const messages: string[] = []
    page.on('console', (message) => {
        if (message.type() === 'error') messages.push(message.text())
    })
    return messages
}

async function attemptCreateGame(page: Page, fixture: string): Promise<{
    callbackErrors: string[]
    thrown: string
}> {
    return page.evaluate(async (fixtureName) => {
        const {createGame} = await import('/runtime.js')
        const canvas = document.createElement('canvas')
        document.body.append(canvas)
        const callbackErrors: string[] = []
        try {
            await createGame({
                base: new URL(`/fixtures/${fixtureName}/`, location.href).href,
                canvas,
                onError: (error: unknown) => callbackErrors.push(String(error)),
            })
            return {callbackErrors, thrown: ''}
        } catch (error) {
            return {callbackErrors, thrown: String(error)}
        } finally {
            canvas.remove()
        }
    }, fixture)
}
