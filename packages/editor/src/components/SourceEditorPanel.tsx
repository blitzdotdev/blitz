import {Button, Callout, Spinner} from '@blueprintjs/core'
import {useCallback, useEffect, useRef, useState} from 'react'
import {FileManifestEntry, useAssets} from '../utils/AssetsProvider.ts'
import {MCPBridgeClient} from '../utils/ai'
import {useManager} from '../utils/UseManager.ts'

const editableExtensions = new Set([
    '.cjs', '.css', '.html', '.js', '.json', '.jsonc', '.jsx', '.md', '.mjs',
    '.scss', '.ts', '.tsx', '.txt', '.toml', '.yaml', '.yml',
])
const editableNames = new Set(['.gitignore', '.prettierignore', '.prettierrc', 'AGENTS.md', 'README.md'])
const excludedRoots = new Set(['.git', '.kite', 'dist', 'node_modules', 'runtime'])
const maxSourceBytes = 1024 * 1024

export function isEditableSourceFile(entry?: FileManifestEntry | null) {
    if (!entry || entry.type !== 'file' || excludedRoots.has(entry.path.split('/')[0])) return false
    const dot = entry.name.lastIndexOf('.')
    const extension = dot >= 0 ? entry.name.slice(dot).toLowerCase() : ''
    return editableExtensions.has(extension) || editableNames.has(entry.name)
}

async function readSource(entry: FileManifestEntry, mcpBridge?: MCPBridgeClient): Promise<{content: string; fileRevision?: number}> {
    if (mcpBridge?.isConnected) {
        const result = await mcpBridge.requestProject('project.readFile', {path: entry.path}) as {
            contentBase64: string
            fileRevision: number
        }
        const binary = atob(result.contentBase64)
        const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
        if (bytes.byteLength > maxSourceBytes) throw new Error('This file is larger than the 1 MB alpha source-editor limit.')
        return {content: new TextDecoder().decode(bytes), fileRevision: result.fileRevision}
    }
    const file = await (entry.handle as FileSystemFileHandle).getFile()
    if (file.size > maxSourceBytes) throw new Error('This file is larger than the 1 MB alpha source-editor limit.')
    return {content: await file.text()}
}

export function SourceEditorPanel({selectedFile, mcpBridge, onDirtyChange}: {
    selectedFile?: FileManifestEntry | null
    mcpBridge?: MCPBridgeClient
    onDirtyChange?: (dirty: boolean) => void
}) {
    const manager = useManager()
    const {refreshManifest} = useAssets()
    const [activeEntry, setActiveEntry] = useState<FileManifestEntry | null>(null)
    const [pendingEntry, setPendingEntry] = useState<FileManifestEntry | null>(null)
    const [savedContent, setSavedContent] = useState('')
    const [draft, setDraft] = useState('')
    const [loading, setLoading] = useState(false)
    const [saving, setSaving] = useState(false)
    const [externalConflict, setExternalConflict] = useState(false)
    const [message, setMessage] = useState<string | null>(null)
    const savedRef = useRef(savedContent)
    const draftRef = useRef(draft)
    const saveInFlightRef = useRef(false)
    const loadGeneration = useRef(0)

    useEffect(() => { savedRef.current = savedContent }, [savedContent])
    useEffect(() => { draftRef.current = draft }, [draft])

    const load = useCallback(async (entry: FileManifestEntry, discard = false) => {
        const generation = ++loadGeneration.current
        if (!discard && activeEntry?.path !== entry.path && draftRef.current !== savedRef.current) {
            setLoading(false)
            setPendingEntry(entry)
            setMessage(`Save the current file or discard its draft before opening ${entry.path}.`)
            return
        }
        setLoading(true)
        setMessage(null)
        try {
            const {content} = await readSource(entry, mcpBridge)
            if (generation !== loadGeneration.current) return
            savedRef.current = content
            draftRef.current = content
            setActiveEntry(entry)
            setPendingEntry(null)
            setSavedContent(content)
            setDraft(content)
            setExternalConflict(false)
        } catch (error) {
            if (generation === loadGeneration.current) setMessage(error instanceof Error ? error.message : String(error))
        } finally {
            if (generation === loadGeneration.current) setLoading(false)
        }
    }, [activeEntry?.path, mcpBridge])

    const selectedSource = isEditableSourceFile(selectedFile) ? selectedFile! : null
    useEffect(() => {
        if (!selectedSource) {
            setLoading(false)
        } else if (activeEntry?.path === selectedSource.path) {
            setLoading(false)
            if (activeEntry !== selectedSource) setActiveEntry(selectedSource)
            if (pendingEntry) setPendingEntry(null)
        } else {
            void load(selectedSource)
        }
        // Invalidate reads even when selection returns to the already-open
        // file or leaves source editing, neither of which starts another load.
        return () => { ++loadGeneration.current }
    }, [activeEntry, load, pendingEntry, selectedSource])

    const reload = useCallback(async () => {
        if (activeEntry) await load(activeEntry, true)
    }, [activeEntry, load])

    const save = useCallback(async (overwrite = false) => {
        if (!activeEntry || saving) return
        setSaving(true)
        saveInFlightRef.current = true
        setMessage(null)
        try {
            const contentToSave = draftRef.current
            const {content: current, fileRevision} = await readSource(activeEntry, mcpBridge)
            if (!overwrite && current !== savedRef.current) {
                setExternalConflict(true)
                setMessage('This file changed outside the source editor. Reload it or explicitly overwrite the disk version.')
                return
            }
            if (mcpBridge?.isConnected) {
                await mcpBridge.requestProject('project.writeFiles', {
                    operationId: `source-save-${Date.now()}-${crypto.randomUUID()}`,
                    expectedFileRevision: fileRevision,
                    files: [{path: activeEntry.path, content: contentToSave}],
                })
            }
            const writable = await (activeEntry.handle as FileSystemFileHandle).createWritable()
            await writable.write(contentToSave)
            await writable.close()
            const newerDraft = draftRef.current !== contentToSave
            savedRef.current = contentToSave
            setSavedContent(contentToSave)
            setExternalConflict(false)
            setMessage(newerDraft ? 'Saved the earlier draft. Your newer edits are still unsaved.' : 'Saved.')
            await manager.refreshProjectFiles([activeEntry.path])
            await refreshManifest(true)
            if (!newerDraft && pendingEntry && pendingEntry.path !== activeEntry.path) await load(pendingEntry, true)
        } catch (error) {
            setMessage(error instanceof Error ? error.message : String(error))
        } finally {
            saveInFlightRef.current = false
            setSaving(false)
        }
    }, [activeEntry, load, manager, mcpBridge, pendingEntry, refreshManifest, saving])

    useEffect(() => {
        const onFilesChanged = async (event: {paths?: string[]}) => {
            await refreshManifest(true)
            if (!activeEntry || (event.paths?.length && !event.paths.includes(activeEntry.path) && !event.paths.includes('*'))) return
            if (saveInFlightRef.current) return
            try {
                const {content: current} = await readSource(activeEntry, mcpBridge)
                if (current === savedRef.current) return
                if (draftRef.current !== savedRef.current) {
                    setExternalConflict(true)
                    setMessage('This file changed outside the source editor. Your unsaved draft has been preserved.')
                } else {
                    savedRef.current = current
                    draftRef.current = current
                    setSavedContent(current)
                    setDraft(current)
                    setMessage('Reloaded an external change.')
                }
            } catch (error) {
                setMessage(error instanceof Error ? error.message : String(error))
            }
        }
        manager.addEventListener('projectFilesChanged', onFilesChanged)
        return () => manager.removeEventListener('projectFilesChanged', onFilesChanged)
    }, [activeEntry, manager, mcpBridge, refreshManifest])

    const dirty = draft !== savedContent
    useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
    useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

    if (!selectedSource) return null
    if (!activeEntry) return <div className="kite-source-placeholder"><Spinner size={24}/></div>

    return <div className="kite-source-editor kite-source-inspector">
        <div className="kite-source-toolbar">
            <strong title={activeEntry.path}>{activeEntry.path}</strong>
            <span className="kite-source-status">{dirty ? 'Unsaved changes' : 'Saved'}</span>
            <Button small icon="refresh" text="Reload" disabled={loading || saving} onClick={() => void reload()}/>
            {pendingEntry && <Button small intent="warning" text="Discard & open selected" disabled={saving} onClick={() => void load(pendingEntry, true)}/>}
            {externalConflict && dirty && <Button small intent="danger" text="Overwrite disk" disabled={saving} onClick={() => void save(true)}/>}
            <Button small intent="primary" icon="floppy-disk" text="Save" loading={saving} disabled={!dirty || externalConflict} onClick={() => void save()}/>
        </div>
        {message && <Callout compact intent={externalConflict || pendingEntry ? 'warning' : 'none'}>{message}</Callout>}
        <textarea
            aria-label={`Source editor: ${activeEntry.path}`}
            className="kite-source-textarea"
            value={draft}
            disabled={loading}
            spellCheck={false}
            onChange={event => {
                draftRef.current = event.target.value
                setDraft(event.target.value)
                setMessage(null)
            }}
        />
    </div>
}
