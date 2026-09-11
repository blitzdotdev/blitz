import {expect, test} from '@playwright/test'
import {writeEditorState} from '../../src/utils/editorState.ts'

test('state writer records liveness, client identity, and play state', async () => {
    let writtenPath = ''
    let writtenBytes = new Uint8Array()
    const source = {
        write: async (path: string, bytes: Uint8Array) => {
            writtenPath = path
            writtenBytes = bytes
            return {sha256: 'a'.repeat(64)}
        },
    }

    const sha256 = await writeEditorState(source, {
        editorVersion: '0.12.0',
        engineVersion: '0.12.0',
        projectLoaded: true,
        playState: 'playing',
        dirty: true,
        sourceDraftDirty: false,
        sceneHash: 'b'.repeat(64),
        savedSceneHash: 'a'.repeat(64),
        clientId: 'state-writer-test',
        selectionNames: [],
        lastLoadError: null,
        updatedAt: '2026-09-10T12:00:00.000Z',
    }, '*')

    expect(writtenPath).toBe('.kite3d/state.json')
    expect(sha256).toBe('a'.repeat(64))
    const state = JSON.parse(new TextDecoder().decode(writtenBytes)) as Record<string, unknown>
    expect(state).toMatchObject({
        projectLoaded: true,
        playState: 'playing',
        dirty: true,
        sourceDraftDirty: false,
        sceneHash: 'b'.repeat(64),
        savedSceneHash: 'a'.repeat(64),
        clientId: 'state-writer-test',
        selectionNames: [],
        lastLoadError: null,
    })
    expect(state.updatedAt).toBe('2026-09-10T12:00:00.000Z')
})
