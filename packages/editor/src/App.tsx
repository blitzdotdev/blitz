import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {
    createGame,
    EntityComponentPlugin,
    GeneratorComponent,
    registerScripts,
    RUNTIME_VERSION,
    serializeSceneGltf,
    serializeSceneGltfDocument,
    validateSceneSource,
    walkScriptExports,
    type CreatedGame,
    type SerializedSceneGltf,
} from '@blitzdev/engine'
import {DevServerSource} from './DevServerSource.ts'
import {PublishDialog} from './PublishDialog.tsx'
import {ProjectConflictError, type ProjectEvent, type ProjectFileEntry} from './ProjectSource.ts'

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
const encode = (text: string) => new TextEncoder().encode(text)

interface ServerState {
    name: string
    versions: Record<string, string>
    asset_library_proxy_url: string
}

interface HierarchyEntry {
    name: string
    generated: boolean
}

interface GeneratorEditorState {
    componentId: string
    module: string
    nodeIndex: number
    nodeName: string
    params: Record<string, unknown>
}

export default function App() {
    const source = useMemo(() => new DevServerSource(), [])
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const gameRef = useRef<CreatedGame>()
    const hashes = useRef(new Map<string, string>())
    const saveTimer = useRef<ReturnType<typeof setTimeout>>()
    const sceneTextRef = useRef('')
    const editorVersionRef = useRef(RUNTIME_VERSION)
    const [serverState, setServerState] = useState<ServerState>()
    const [manifest, setManifest] = useState<ProjectFileEntry[]>([])
    const [scenePath, setScenePath] = useState('assets/main.scene.glb')
    const [sceneText, setSceneText] = useState('')
    const [dirty, setDirty] = useState(false)
    const [playing, setPlaying] = useState(false)
    const [components, setComponents] = useState<string[]>([])
    const [runtimeHierarchy, setRuntimeHierarchy] = useState<HierarchyEntry[]>([])
    const [lastError, setLastError] = useState<string>()
    const [status, setStatus] = useState('Loading project…')
    const [publishDialogOpen, setPublishDialogOpen] = useState(false)

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
            editorVersion: editorVersionRef.current,
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
        const names = new Set<string>([GeneratorComponent.ComponentType])
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
        editorVersionRef.current = state.versions.editor || RUNTIME_VERSION
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
        setRuntimeHierarchy([])
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
            setRuntimeHierarchy(readRuntimeHierarchy(game))
            setPlaying(true)
            setStatus('Playing')
            await writeState(true)
        } catch (error) {
            await reportError(error)
            await writeState(false, error instanceof Error ? error.message : String(error))
        }
    }, [loadScriptTypes, reportError, source, writeState])

    const writeSerializedScene = useCallback(async (serialized: SerializedSceneGltf) => {
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
    }, [scenePath, source])

    const saveScene = useCallback(async () => {
        if (saveTimer.current) {
            clearTimeout(saveTimer.current)
            saveTimer.current = undefined
        }
        try {
            const serialized = await serializeScene(scenePath, sceneTextRef.current)
            await writeSerializedScene(serialized)
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
    }, [reportError, scenePath, source, writeSerializedScene])

    const sceneObjectNames = useMemo(() => readSceneObjectNames(scenePath, sceneText), [scenePath, sceneText])
    const generatorStates = useMemo(() => readGeneratorStates(scenePath, sceneText), [scenePath, sceneText])
    const sourceHierarchy = useMemo<HierarchyEntry[]>(() => sceneObjectNames.map((name) => ({name, generated: false})), [sceneObjectNames])

    const updateGeneratorState = useCallback(async (
        generator: GeneratorEditorState,
        update: Partial<Pick<GeneratorEditorState, 'module' | 'params'>>,
    ) => {
        const document = JSON.parse(sceneTextRef.current) as {
            nodes?: Array<{extras?: {EntityComponentPlugin?: Record<string, {state?: Record<string, unknown>}>}}>
        }
        const state = document.nodes?.[generator.nodeIndex]?.extras?.EntityComponentPlugin?.[generator.componentId]?.state
        if (!state) throw new Error(`Generator component is missing on ${generator.nodeName}`)
        Object.assign(state, update)
        const nextText = JSON.stringify(document, null, 2)
        sceneTextRef.current = nextText
        setSceneText(nextText)
        setDirty(true)
        await saveScene()

        const game = gameRef.current
        const object = game?.viewer.scene.modelRoot.getObjectByName(generator.nodeName)
        const component = object && EntityComponentPlugin.GetComponent(object, GeneratorComponent)
        if (component && game) {
            if (update.module !== undefined) component.module = update.module
            if (update.params !== undefined) component.params = update.params
            await GeneratorComponent.waitForViewer(game.viewer)
            setRuntimeHierarchy(readRuntimeHierarchy(game))
        }
    }, [saveScene])

    const performBake = useCallback(async (nodeName: string) => {
        if (!gameRef.current) await play()
        const game = gameRef.current
        if (!game) throw new Error('The game could not be started for baking')
        const matches: Array<ReturnType<typeof game.viewer.scene.modelRoot.getObjectByName>> = []
        game.viewer.scene.modelRoot.traverse((object) => {
            if (object.name === nodeName) matches.push(object)
        })
        if (matches.length !== 1 || !matches[0]) throw new Error(`Generator node is not unique: ${nodeName}`)
        const node = matches[0]
        const component = EntityComponentPlugin.GetComponent(node, GeneratorComponent)
        if (!component) throw new Error(`Generator component not found on ${nodeName}`)
        await component.run()
        await GeneratorComponent.waitForViewer(game.viewer)
        const generated = node.children.filter((child) => child.userData.blitzGenerated === true)
        const bakedFrom = {
            module: component.module,
            params: JSON.parse(JSON.stringify(component.params)) as Record<string, unknown>,
            ts: new Date().toISOString(),
        }
        for (const child of generated) {
            child.traverse((descendant) => {
                delete descendant.userData.blitzGenerated
                delete descendant.userData.excludeFromExport
            })
        }
        game.viewer.getPlugin(EntityComponentPlugin)?.removeComponent(node, component.uuid)
        node.userData.blitzBakedFrom = bakedFrom
        node._sChildren = [...node.children]
        node.setDirty?.({change: 'userData.blitzBakedFrom', source: 'blitz bake'})

        const serialized = await serializeSceneGltf(game.viewer, {scenePath})
        await writeSerializedScene(serialized)
        setRuntimeHierarchy(readRuntimeHierarchy(game))
        setStatus(`Baked ${nodeName}`)
        return {ok: true, nodeName, children: generated.length}
    }, [play, scenePath, writeSerializedScene])

    const requestBake = useCallback(async (nodeName: string, force = false) => {
        if (!source.bake) throw new Error('Bake is not supported by this project source')
        setStatus(`Baking ${nodeName}…`)
        await source.bake(nodeName, force)
    }, [source])

    const onProjectEvent = useCallback(async (event: ProjectEvent) => {
        if (event.type === 'command' && event.command === 'bake' && typeof event.id === 'string' && typeof event.nodeName === 'string') {
            try {
                const result = await performBake(event.nodeName)
                await source.commandResult?.(event.id, result)
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                await source.commandResult?.(event.id, {ok: false, error: message})
                await reportError(error)
            }
            return
        }
        if (event.client === source.clientId || !event.path) return
        if (event.sha256 && hashes.current.get(event.path) === event.sha256) return
        if (event.sha256) hashes.current.set(event.path, event.sha256)
        else hashes.current.delete(event.path)
        const entries = await source.list()
        setManifest(entries)
        const generatorModuleChanged = readGeneratorStates(scenePath, sceneTextRef.current)
            .some(({module}) => normalizeModulePath(module) === event.path)
        if (event.path.endsWith('.script.js') || event.path.endsWith('.plugin.js')) {
            await loadScriptTypes(entries)
            if (gameRef.current) await play()
            setStatus(`${event.path} reloaded`)
        } else if (generatorModuleChanged) {
            if (gameRef.current) await play()
            setStatus(`${event.path} regenerated`)
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
    }, [dirty, loadScriptTypes, performBake, play, readProject, reportError, scenePath, source])

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

    return <main data-asset-library-proxy-url={serverState?.asset_library_proxy_url}>
        <header>
            <img src="/logo.svg" alt="Blitz"/>
            <div><h1>{serverState?.name || 'Blitz'}</h1><p>{status}</p></div>
            <button data-testid="play" onClick={() => void (playing ? stop() : play())}>{playing ? 'Stop' : 'Play'}</button>
            <button data-testid="save-scene" disabled={!sceneText} onClick={() => void saveScene()}>Save scene</button>
            <button data-testid="open-game" onClick={() => setPublishDialogOpen(true)}>Open game</button>
        </header>
        <section className="workspace">
            <aside>
                <h2>Project files</h2>
                <ul data-testid="project-files">{manifest.map((entry) => <li key={entry.path}>{entry.path}</li>)}</ul>
                <h2>Component types</h2>
                <ul data-testid="component-types">{components.map((name) => <li key={name}>{name}</li>)}</ul>
                <h2>Scene hierarchy</h2>
                <ul data-testid="scene-hierarchy">
                    {[...sourceHierarchy, ...runtimeHierarchy].map((entry, index) => <li key={`${entry.name}-${index}`}>
                        {entry.name} {entry.generated && <span className="generated-badge">generated</span>}
                    </li>)}
                </ul>
                <h2>Generators</h2>
                <div data-testid="generator-inspector">{generatorStates.map((generator) => <fieldset key={`${generator.nodeIndex}-${generator.componentId}`}>
                    <legend>{generator.nodeName}</legend>
                    <label>Module <input
                        data-testid={`generator-module-${generator.nodeIndex}`}
                        defaultValue={generator.module}
                        onBlur={(event) => void updateGeneratorState(generator, {module: event.target.value}).catch(reportError)}
                    /></label>
                    <label>Params <textarea
                        data-testid={`generator-params-${generator.nodeIndex}`}
                        defaultValue={JSON.stringify(generator.params, null, 2)}
                        onBlur={(event) => {
                            try {
                                const params = JSON.parse(event.target.value) as Record<string, unknown>
                                void updateGeneratorState(generator, {params}).catch(reportError)
                            } catch (error) {
                                void reportError(error)
                            }
                        }}
                    /></label>
                    <button data-testid={`bake-${generator.nodeIndex}`} onClick={() => void requestBake(generator.nodeName).catch(reportError)}>Bake</button>
                    <button data-testid={`force-bake-${generator.nodeIndex}`} onClick={() => {
                        if (window.confirm(`Force bake ${generator.nodeName}? Existing children or human edits may be replaced.`)) {
                            void requestBake(generator.nodeName, true).catch(reportError)
                        }
                    }}>Force bake</button>
                </fieldset>)}</div>
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
        <PublishDialog
            isOpen={publishDialogOpen}
            name={serverState?.name || 'Blitz game'}
            source={source}
            onClose={() => setPublishDialogOpen(false)}
        />
    </main>
}

async function serializeScene(path: string, text: string) {
    if (!path.toLowerCase().endsWith('.gltf')) {
        return {document: {}, gltf: encode(text), files: []}
    }
    return serializeSceneGltfDocument(JSON.parse(text), {scenePath: path})
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

function readGeneratorStates(path: string, text: string): GeneratorEditorState[] {
    if (!path.toLowerCase().endsWith('.gltf')) return []
    try {
        const document = JSON.parse(text) as {
            nodes?: Array<{
                name?: unknown
                extras?: {EntityComponentPlugin?: Record<string, {type?: unknown, state?: unknown}>}
            }>
        }
        const generators: GeneratorEditorState[] = []
        for (const [nodeIndex, node] of (document.nodes || []).entries()) {
            for (const [componentId, component] of Object.entries(node.extras?.EntityComponentPlugin || {})) {
                if (component.type !== GeneratorComponent.ComponentType || !isRecord(component.state)) continue
                generators.push({
                    componentId,
                    module: typeof component.state.module === 'string' ? component.state.module : '',
                    nodeIndex,
                    nodeName: typeof node.name === 'string' ? node.name : `Node ${nodeIndex}`,
                    params: isRecord(component.state.params) ? component.state.params : {},
                })
            }
        }
        return generators
    } catch {
        return []
    }
}

function readRuntimeHierarchy(game: CreatedGame): HierarchyEntry[] {
    const entries: HierarchyEntry[] = []
    game.viewer.scene.modelRoot.traverse((object) => {
        if (object.userData.blitzGenerated === true) {
            entries.push({name: object.name || object.uuid, generated: true})
        }
    })
    return entries
}

function normalizeModulePath(path: string): string {
    return path.replace(/^\.\//, '').replace(/\\/g, '/')
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
