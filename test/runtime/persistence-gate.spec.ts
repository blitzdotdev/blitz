import {readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {expect, test} from '@playwright/test'

const sampleDirectory = fileURLToPath(new URL('../../../editor/test/fixtures/sample-project/', import.meta.url))
const sourceFiles = [
    'package.json',
    'assets.json',
    'main.js',
    'Spinner.script.js',
    'assets/prop.gltf',
]

// Guards the core manual workflow: scene edits save, reload, and clean up deterministically.
test('serializes, reloads, persists edits deterministically, then cleans up after Play and Stop', async ({page}) => {
    test.setTimeout(60_000)
    const roundTripFiles = new Map<string, Buffer>()
    await Promise.all(sourceFiles.map(async (path) => {
        roundTripFiles.set(path, await readFile(resolve(sampleDirectory, path)))
    }))
    await page.route('**/roundtrip-project/**', async (route) => {
        const pathname = new URL(route.request().url()).pathname
        const path = decodeURIComponent(pathname.slice('/roundtrip-project/'.length))
        const body = roundTripFiles.get(path)
        if (!body) {
            await route.fulfill({status: 404, body: 'Not found'})
            return
        }
        await route.fulfill({
            status: 200,
            body,
            contentType: contentType(path),
        })
    })
    await page.goto('/test-shell.html')

    const initial = await page.evaluate(async () => {
        const {
            createGame,
            EntityComponentPlugin,
            semanticSceneSnapshot,
            serializeSceneGltf,
        } = await import('/runtime.js')
        const canvas = document.createElement('canvas')
        document.body.append(canvas)
        const game = await createGame({base: new URL('/sample-project/', location.href).href, canvas})
        game.viewer.getPlugin(EntityComponentPlugin)?.stop()
        game.viewer.timeline.stop()
        game.viewer.scene.modelRoot.getObjectByName('Spinner').rotation.y = 0
        const snapshot = semanticSceneSnapshot(game.viewer)
        const first = await serializeSceneGltf(game.viewer, {scenePath: 'assets/main.scene.gltf'})
        const second = await serializeSceneGltf(game.viewer, {scenePath: 'assets/main.scene.gltf'})
        const cleanup = game.dispose()
        canvas.remove()
        return {
            snapshot,
            first: encodeSerialization(first),
            second: encodeSerialization(second),
            cleanup,
        }

        function encodeSerialization(serialized: {
            gltf: Uint8Array
            files: Array<{path: string, bytes: Uint8Array}>
        }) {
            return {
                gltf: bytesToBase64(serialized.gltf),
                files: serialized.files.map(({path, bytes}) => ({path, bytes: bytesToBase64(bytes)})),
            }
        }

        function bytesToBase64(bytes: Uint8Array): string {
            let binary = ''
            for (const byte of bytes) binary += String.fromCharCode(byte)
            return btoa(binary)
        }
    })

    expect(initial.first).toEqual(initial.second)
    expect(initial.cleanup).toMatchObject({ok: true, trackedObjectCount: 0})
    installSerialization(roundTripFiles, initial.first)

    const edited = await page.evaluate(async (before) => {
        const {
            createGame,
            EntityComponentPlugin,
            persistenceReport,
            semanticSceneSnapshot,
            serializeSceneGltf,
        } = await import('/runtime.js')
        const canvas = document.createElement('canvas')
        document.body.append(canvas)
        const game = await createGame({base: new URL('/roundtrip-project/', location.href).href, canvas})
        game.viewer.getPlugin(EntityComponentPlugin)?.stop()
        game.viewer.timeline.stop()
        game.viewer.scene.modelRoot.getObjectByName('Spinner').rotation.y = 0
        const persistence = persistenceReport(before, semanticSceneSnapshot(game.viewer))

        const prop = game.viewer.scene.modelRoot.getObjectByName('PropRef')
        prop.position.set(4, 5, 6)
        prop.setDirty?.({source: 'persistence gate', change: 'position'})
        const editedSnapshot = semanticSceneSnapshot(game.viewer)
        const serialized = await serializeSceneGltf(game.viewer, {scenePath: 'assets/main.scene.gltf'})
        const cleanup = game.dispose()
        canvas.remove()
        return {
            persistence,
            editedSnapshot,
            serialized: {
                gltf: bytesToBase64(serialized.gltf),
                files: serialized.files.map(({path, bytes}) => ({path, bytes: bytesToBase64(bytes)})),
            },
            cleanup,
        }

        function bytesToBase64(bytes: Uint8Array): string {
            let binary = ''
            for (const byte of bytes) binary += String.fromCharCode(byte)
            return btoa(binary)
        }
    }, initial.snapshot)

    expect(edited.persistence).toMatchObject({ok: true, status: 'pass', changes: []})
    expect(edited.cleanup).toMatchObject({ok: true, trackedObjectCount: 0})
    installSerialization(roundTripFiles, edited.serialized)

    const playing = await page.evaluate(async () => {
        const {createGame} = await import('/runtime.js')
        ;(window as any).__kite3dUpdates = 0
        const canvas = document.createElement('canvas')
        document.body.append(canvas)
        ;(window as any).__persistenceGateGame = await createGame({
            base: new URL('/roundtrip-project/', location.href).href,
            canvas,
        })
        return true
    })
    expect(playing).toBe(true)
    await expect.poll(() => page.evaluate(() => (window as any).__kite3dUpdates || 0)).toBeGreaterThan(0)

    const final = await page.evaluate(async (before) => {
        const {EntityComponentPlugin, persistenceReport, semanticSceneSnapshot} = await import('/runtime.js')
        const game = (window as any).__persistenceGateGame
        game.viewer.getPlugin(EntityComponentPlugin)?.stop()
        game.viewer.timeline.stop()
        game.viewer.scene.modelRoot.getObjectByName('Spinner').rotation.y = 0
        const prop = game.viewer.scene.modelRoot.getObjectByName('PropRef')
        const result = {
            transform: prop.position.toArray(),
            persistence: persistenceReport(before, semanticSceneSnapshot(game.viewer)),
            cleanup: game.dispose(),
        }
        return result
    }, edited.editedSnapshot)

    expect(final.transform).toEqual([4, 5, 6])
    expect(final.persistence).toMatchObject({ok: true, status: 'pass', changes: []})
    expect(final.cleanup).toMatchObject({ok: true, status: 'pass', trackedObjectCount: 0})
})

function installSerialization(
    files: Map<string, Buffer>,
    serialized: {gltf: string, files: Array<{path: string, bytes: string}>},
): void {
    files.set('assets/main.scene.gltf', Buffer.from(serialized.gltf, 'base64'))
    for (const file of serialized.files) files.set(file.path, Buffer.from(file.bytes, 'base64'))
}

function contentType(path: string): string {
    if (path.endsWith('.html')) return 'text/html; charset=utf-8'
    if (path.endsWith('.js')) return 'text/javascript; charset=utf-8'
    if (path.endsWith('.json')) return 'application/json; charset=utf-8'
    if (path.endsWith('.gltf')) return 'model/gltf+json'
    return 'application/octet-stream'
}
