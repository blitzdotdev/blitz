export interface EditorState {
    editorVersion: string
    engineVersion: string
    projectLoaded: boolean
    playState: 'playing' | 'stopped'
    dirty: boolean
    selectionNames: string[]
    lastLoadError: string | null
    updatedAt: string
    clientId: string
}

interface StateFileSource {
    write(path: string, bytes: Uint8Array, ifMatch: string | '*'): Promise<{sha256: string}>
}

export async function writeEditorState(source: StateFileSource, state: EditorState, ifMatch: string | '*'): Promise<string> {
    const bytes = new TextEncoder().encode(`${JSON.stringify(state, null, 2)}\n`)
    return (await source.write('.blitz/state.json', bytes, ifMatch)).sha256
}
