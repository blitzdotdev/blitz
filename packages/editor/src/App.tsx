import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {
    createGame,
    registerScripts,
    RUNTIME_VERSION,
    serializeSceneGltfDocument,
    walkScriptExports,
    type CreatedGame,
} from '@blitzdev/engine'
import {DevServerSource} from './DevServerSource.ts'
import {ProjectConflictError, type ProjectEvent, type ProjectFileEntry} from './ProjectSource.ts'

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
const encode = (text: string) => new TextEncoder().encode(text)

interface ServerState {
    name: string
    versions: Record<string, string>
}

export default function App() {
    const source = useMemo(() => new DevServerSource(), [])
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const gameRef = useRef<CreatedGame>()
    const hashes = useRef(new Map<string, string>())
    const saveTimer = useRef<ReturnType<typeof setTimeout>>()
    const sceneTextRef = useRef('')
    const [serverState, setServerState] = useState<ServerState>()
    const [manifest, setManifest] = useState<ProjectFileEntry[]>([])
    const [scenePath, setScenePath] = useState('assets/main.scene.glb')
    const [sceneText, setSceneText] = useState('')
    const [dirty, setDirty] = useState(false)
    const [playing, setPlaying] = useState(false)
    const [components, setComponents] = useState<string[]>([])
    const [lastError, setLastError] = useState<string>()
    const [status, setStatus] = useState('Loading project…')

    const appendConsoleError = useCallback(async (message: string) => {
        let previous = ''
        let ifMatch: string | '*' = '*'
        try {
            const current = await source.read('.blitz/console.log')
            previous = decode(current.bytes)
            ifMatch = current.sha256
        } catch { /* first log entry */ }
        const next = `${previous}${new Date().toISOString()} ${message}\n`.slice(-200_000)
        try {
            const result = await source.write('.blitz/console.log', encode(next), ifMatch)
            hashes.current.set('.blitz/console.log', result.sha256)
        } catch (error) {
            if (!(error instanceof ProjectConflictError)) throw error
        }
    }, [source])

    const reportError = useCallback(async (error: unknown) => {
        const message = error instanceof Error ? `${error.message}\n${error.stack || ''}` : String(error)
        setLastError(message)
        setStatus('Project error')
        await appendConsoleError(message)
    }, [appendConsoleError])

    const writeState = useCallback(async (isPlaying: boolean, error?: string) => {
        const state = {
            editorVersion: '0.12.0',
            engineVersion: RUNTIME_VERSION,
            playState: isPlaying ? 'playing' : 'stopped',
            selectionNames: [],
            lastLoadError: error || null,
            updatedAt: new Date().toISOString(),
        }
        const result = await source.write(
            '.blitz/state.json',
            encode(`${JSON.stringify(state, null, 2)}\n`),
            hashes.current.get('.blitz/state.json') || '*',
        )
        hashes.current.set('.blitz/state.json', result.sha256)
    }, [source])

    const loadScriptTypes = useCallback(async (entries: ProjectFileEntry[]) => {
        const names = new Set<string>()
        for (const entry of entries.filter(({path}) => path.endsWith('.script.js') || path.endsWith('.plugin.js'))) {
            try {
                const module = await import(/* @vite-ignore */ source.fileUrl(entry.path, entry.sha256)) as Record<string, unknown>
                const walked = walkScriptExports(module)
                walked.components.forEach(({value}) => names.add(value.ComponentType))
                walked.plugins.forEach(({value}) => names.add((value as unknown as {PluginType: string}).PluginType))
                if (gameRef.current) await registerScripts(gameRef.current.viewer, [module])
            } catch (error) {
                await reportError(error)
            }
        }
        setComponents([...names].sort())
    }, [reportError, source])

    const readProject = useCallback(async () => {
        const [state, entries, packageFile] = await Promise.all([
            source.state() as Promise<unknown> as Promise<ServerState>,
            source.list(),
            source.read('package.json'),
        ])
        entries.forEach((entry) => hashes.current.set(entry.path, entry.sha256))
        const packageJson = JSON.parse(decode(packageFile.bytes)) as {mainScene?: string}
        const nextScenePath = packageJson.mainScene || 'assets/main.scene.glb'
        const scene = await source.read(nextScenePath)
        validateSceneSource(nextScenePath, decode(scene.bytes))
        hashes.current.set(nextScenePath, scene.sha256)
        setServerState(state)
        setManifest(entries)
        setScenePath(nextScenePath)
        sceneTextRef.current = decode(scene.bytes)
        setSceneText(sceneTextRef.current)
        setDirty(false)
        await loadScriptTypes(entries)
        setStatus('Project loaded')
        await writeState(false)
    }, [loadScriptTypes, source, writeState])

    const stop = useCallback(async () => {
        gameRef.current?.dispose()
        gameRef.current = undefined
        setPlaying(false)
        setStatus('Stopped')
        await writeState(false, lastError)
    }, [lastError, writeState])

    const play = useCallback(async () => {
        if (!canvasRef.current) return
        gameRef.current?.dispose()
        setStatus('Starting game…')
        try {
            const game = await createGame({
                base: new URL('/files/', location.origin).href,
                canvas: canvasRef.current,
                onError: (error) => { void reportError(error) },
            })
            gameRef.current = game
            await loadScriptTypes(await source.list())
            setPlaying(true)
            setStatus('Playing')
            await writeState(true)
        } catch (error) {
            await reportError(error)
            await writeState(false, error instanceof Error ? error.message : String(error))
        }
    }, [loadScriptTypes, reportError, source, writeState])

    const saveScene = useCallback(async () => {
        if (saveTimer.current) {
            clearTimeout(saveTimer.current)
            saveTimer.current = undefined
        }
        try {
            const serialized = await serializeScene(scenePath, sceneTextRef.current)
            for (const file of serialized.files) {
                const written = await source.write(file.path, file.bytes, hashes.current.get(file.path) || '*')
                hashes.current.set(file.path, written.sha256)
            }
            const binPath = scenePath.replace(/\.gltf$/i, '.bin')
            const hasBin = (serialized.document.buffers as Array<{uri?: string}> | undefined)
                ?.some(({uri}) => uri === binPath.split('/').pop())
            if (!hasBin && hashes.current.has(binPath)) {
                await source.delete(binPath)
                hashes.current.delete(binPath)
            }
            const result = await source.write(scenePath, serialized.gltf, hashes.current.get(scenePath) || '*')
            hashes.current.set(scenePath, result.sha256)
            sceneTextRef.current = decode(serialized.gltf)
            setSceneText(sceneTextRef.current)
            setDirty(false)
            setStatus('Scene saved')
        } catch (error) {
            if (!(error instanceof ProjectConflictError)) return reportError(error)
            const disk = await source.read(scenePath)
            if (window.confirm('The scene changed on disk. Reload the disk version?')) {
                hashes.current.set(scenePath, disk.sha256)
                sceneTextRef.current = decode(disk.bytes)
                setSceneText(sceneTextRef.current)
                setDirty(false)
                setStatus('Reloaded scene from disk')
            } else {
                setStatus('Kept unsaved editor scene')
            }
        }
    }, [reportError, scenePath, source])

    const sceneObjectNames = useMemo(() => readSceneObjectNames(scenePath, sceneText), [scenePath, sceneText])

    const onProjectEvent = useCallback(async (event: ProjectEvent) => {
        if (event.client === source.clientId || !event.path) return
        if (event.sha256 && hashes.current.get(event.path) === event.sha256) return
        if (event.sha256) hashes.current.set(event.path, event.sha256)
        else hashes.current.delete(event.path)
        const entries = await source.list()
        setManifest(entries)
        if (event.path.endsWith('.script.js') || event.path.endsWith('.plugin.js')) {
            await loadScriptTypes(entries)
            if (gameRef.current) await play()
            setStatus(`${event.path} reloaded`)
        } else if (event.path === 'package.json' || event.path === 'assets.json') {
            await readProject()
        } else if (event.path === scenePath) {
            if (dirty && !window.confirm('Changed on disk: reload and discard the editor copy?')) {
                setStatus('Kept unsaved editor scene')
                return
            }
            const disk = await source.read(scenePath)
            validateSceneSource(scenePath, decode(disk.bytes))
            sceneTextRef.current = decode(disk.bytes)
            setSceneText(sceneTextRef.current)
            setDirty(false)
            setStatus('Scene reloaded from disk')
        }
    }, [dirty, loadScriptTypes, play, readProject, scenePath, source])

    const onProjectEventRef = useRef(onProjectEvent)
    onProjectEventRef.current = onProjectEvent

    useEffect(() => {
        void readProject().catch(reportError)
        const unsubscribe = source.events((event) => {
            void onProjectEventRef.current(event).catch(reportError)
        })
        const onError = (event: ErrorEvent) => { void reportError(event.error || event.message) }
        const onRejection = (event: PromiseRejectionEvent) => { void reportError(event.reason) }
        window.addEventListener('error', onError)
        window.addEventListener('unhandledrejection', onRejection)
        return () => {
            unsubscribe()
            window.removeEventListener('error', onError)
            window.removeEventListener('unhandledrejection', onRejection)
            gameRef.current?.dispose()
        }
    }, [readProject, reportError, source])

    return <main>
        <header>
            <img src="/logo.svg" alt="Blitz"/>
            <div><h1>{serverState?.name || 'Blitz'}</h1><p>{status}</p></div>
            <button data-testid="play" onClick={() => void (playing ? stop() : play())}>{playing ? 'Stop' : 'Play'}</button>
            <button data-testid="save-scene" disabled={!sceneText} onClick={() => void saveScene()}>Save scene</button>
        </header>
        <section className="workspace">
            <aside>
                <h2>Project files</h2>
                <ul data-testid="project-files">{manifest.map((entry) => <li key={entry.path}>{entry.path}</li>)}</ul>
                <h2>Component types</h2>
                <ul data-testid="component-types">{components.map((name) => <li key={name}>{name}</li>)}</ul>
            </aside>
            <div className="stage"><canvas ref={canvasRef} data-testid="game-canvas"/></div>
            <section className="scene-source">
                <label htmlFor="scene">{scenePath}{dirty ? ' • unsaved' : ''}</label>
                <output data-testid="scene-objects">{sceneObjectNames.join(', ')}</output>
                <textarea
                    id="scene"
                    data-testid="scene-source"
                    value={sceneText}
                    onChange={(event) => {
                        sceneTextRef.current = event.target.value
                        setSceneText(event.target.value)
                        setDirty(true)
                    }}
                    onBlur={() => {
                        if (!dirty) return
                        if (saveTimer.current) clearTimeout(saveTimer.current)
                        saveTimer.current = setTimeout(() => { void saveScene() }, 250)
                    }}
                />
            </section>
        </section>
        {lastError && <pre role="alert">{lastError}</pre>}
    </main>
}

async function serializeScene(path: string, text: string) {
    if (!path.toLowerCase().endsWith('.gltf')) {
        return {document: {}, gltf: encode(text), files: []}
    }
    return serializeSceneGltfDocument(JSON.parse(text), {scenePath: path})
}

function validateSceneSource(path: string, text: string): void {
    if (!path.toLowerCase().endsWith('.gltf')) return
    const document = JSON.parse(text) as {asset?: unknown}
    if (!document || typeof document !== 'object' || !document.asset) {
        throw new Error(`${path} is not a JSON glTF document`)
    }
}

function readSceneObjectNames(path: string, text: string): string[] {
    if (!path.toLowerCase().endsWith('.gltf')) return []
    try {
        const document = JSON.parse(text) as {nodes?: Array<{name?: unknown}>}
        return (document.nodes || [])
            .map(({name}) => typeof name === 'string' ? name : '')
            .filter(Boolean)
    } catch {
        return []
    }
}
