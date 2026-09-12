import {Button, ButtonGroup, Callout, Intent, Spinner} from '@blueprintjs/core'
import {lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react'
import {ProjectConflictError, type ProjectFileEntry} from '../ProjectSource.ts'
import {useManager} from '../utils/UseManager.ts'
import {isEditableSourceFile, isTextSourcePath, maxSourceBytes} from '../utils/sourceFiles.ts'

const SourceCodeEditor = lazy(async () => {
    const module = await import('./SourceCodeEditor.tsx')
    return {default: module.SourceCodeEditor}
})

const encode = (text: string) => new TextEncoder().encode(text)

export function FileMetadataPanel({entry}: {entry: ProjectFileEntry}) {
    return <div className="file-metadata" data-testid="file-metadata">
        <h3>{entry.path}</h3>
        <dl>
            <dt>Size</dt>
            <dd>{formatBytes(entry.size)}</dd>
            <dt>Type</dt>
            <dd>{fileType(entry.path)}</dd>
        </dl>
        {isTextExtension(entry.path) && entry.size > maxSourceBytes && <Callout compact intent={Intent.WARNING}>
            This text file exceeds the 1 MiB source-editor limit.
        </Callout>}
    </div>
}

export function SourceEditorPanel({selectedFile}: {selectedFile?: ProjectFileEntry | null}) {
    const manager = useManager()
    const [activeEntry, setActiveEntry] = useState<ProjectFileEntry | null>(null)
    const [pendingEntry, setPendingEntry] = useState<ProjectFileEntry | null>(null)
    const [savedContent, setSavedContent] = useState('')
    const [draft, setDraft] = useState('')
    const [loading, setLoading] = useState(false)
    const [saving, setSaving] = useState(false)
    const [conflictHash, setConflictHash] = useState<string>()
    const [conflicted, setConflicted] = useState(false)
    const [message, setMessage] = useState<string>()
    const savedRef = useRef('')
    const draftRef = useRef('')
    const baseHashRef = useRef('')
    const activeEntryRef = useRef<ProjectFileEntry | null>(null)
    const pendingEntryRef = useRef<ProjectFileEntry | null>(null)
    const savingRef = useRef(false)
    const loadGeneration = useRef(0)
    const externalChangePending = useRef(false)
    const invalidateLoad = useCallback(() => { ++loadGeneration.current }, [])

    const setActive = useCallback((entry: ProjectFileEntry, content: string, sha256: string) => {
        activeEntryRef.current = entry
        pendingEntryRef.current = null
        savedRef.current = content
        draftRef.current = content
        baseHashRef.current = sha256
        setActiveEntry(entry)
        setPendingEntry(null)
        setSavedContent(content)
        setDraft(content)
        setConflicted(false)
        setConflictHash(undefined)
        setMessage(undefined)
    }, [])

    const load = useCallback(async (entry: ProjectFileEntry, discard = false) => {
        const generation = ++loadGeneration.current
        const active = activeEntryRef.current
        if (!discard && active?.path !== entry.path && draftRef.current !== savedRef.current) {
            pendingEntryRef.current = entry
            setPendingEntry(entry)
            setMessage(`Save the current file or discard its draft before opening ${entry.path}.`)
            setLoading(false)
            return
        }
        setLoading(true)
        setMessage(undefined)
        try {
            const result = await manager.source.read(entry.path)
            if (generation !== loadGeneration.current) return
            if (result.bytes.byteLength > maxSourceBytes) {
                throw new Error('This text file exceeds the 1 MiB source-editor limit.')
            }
            const content = decodeUtf8(result.bytes)
            setActive({...entry, size: result.bytes.byteLength, sha256: result.sha256}, content, result.sha256)
        } catch (error) {
            if (generation === loadGeneration.current) setMessage(errorMessage(error))
        } finally {
            if (generation === loadGeneration.current) setLoading(false)
        }
    }, [manager.source, setActive])

    const selectedSource = isEditableSourceFile(selectedFile) ? selectedFile : null
    const selectedPath = selectedSource?.path
    useEffect(() => {
        if (!selectedSource) {
            ++loadGeneration.current
            setLoading(false)
            return
        }
        const active = activeEntryRef.current
        if (active?.path === selectedSource.path) {
            activeEntryRef.current = selectedSource
            setActiveEntry(selectedSource)
            if (pendingEntryRef.current?.path === selectedSource.path) {
                pendingEntryRef.current = null
                setPendingEntry(null)
            }
            setLoading(false)
            return
        }
        void load(selectedSource)
        return invalidateLoad
        // File identity is its project-relative path. Manifest updates must not
        // replace a draft or turn every watcher event into a selection load.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [invalidateLoad, load, selectedPath])

    const reload = useCallback(async () => {
        const active = activeEntryRef.current
        if (active) await load(active, true)
    }, [load])

    const checkExternalChange = useCallback(async () => {
        const active = activeEntryRef.current
        if (!active) return
        const generation = ++loadGeneration.current
        try {
            const result = await manager.source.read(active.path)
            if (activeEntryRef.current?.path !== active.path) return
            if (result.sha256 === baseHashRef.current) return
            if (generation !== loadGeneration.current) {
                if (draftRef.current !== savedRef.current) {
                    setConflictHash(result.sha256)
                    setConflicted(true)
                    setMessage('This file changed on disk. Your unsaved draft has been preserved.')
                }
                return
            }
            if (draftRef.current !== savedRef.current) {
                setConflictHash(result.sha256)
                setConflicted(true)
                setMessage('This file changed on disk. Your unsaved draft has been preserved.')
                return
            }
            const content = decodeUtf8(result.bytes)
            setActive({...active, size: result.bytes.byteLength, sha256: result.sha256}, content, result.sha256)
        } catch (error) {
            if (activeEntryRef.current?.path === active.path) setMessage(errorMessage(error))
        }
    }, [manager.source, setActive])

    const save = useCallback(async (overwrite = false) => {
        const active = activeEntryRef.current
        if (!active || savingRef.current) return
        const contentToSave = draftRef.current
        const hashToMatch = overwrite ? conflictHash : baseHashRef.current
        if (!hashToMatch) {
            setMessage('Reload this file before overwriting it.')
            return
        }
        savingRef.current = true
        setSaving(true)
        setMessage(undefined)
        try {
            const result = await manager.source.write(active.path, encode(contentToSave), hashToMatch)
            savedRef.current = contentToSave
            baseHashRef.current = result.sha256
            setSavedContent(contentToSave)
            setConflicted(false)
            setConflictHash(undefined)
            const newerDraft = draftRef.current !== contentToSave
            setMessage(newerDraft ? 'Saved the earlier draft. Your newer edits are still unsaved.' : 'Saved.')
            await manager.sourceFileSaved(active.path, result.sha256)
            const pending = pendingEntryRef.current
            if (!newerDraft && pending && pending.path !== active.path) await load(pending, true)
        } catch (error) {
            if (error instanceof ProjectConflictError) {
                setConflictHash(error.sha256)
                setConflicted(true)
                setMessage('This file changed on disk. Reload it or overwrite the current disk version.')
            } else {
                setMessage(errorMessage(error))
            }
        } finally {
            savingRef.current = false
            setSaving(false)
            if (externalChangePending.current) {
                externalChangePending.current = false
                void checkExternalChange()
            }
        }
    }, [checkExternalChange, conflictHash, load, manager])

    // Subscribe before the committed editor can be observed or edited.
    useLayoutEffect(() => {
        const onProjectFileChange = (event: {path: string}) => {
            if (event.path !== activeEntryRef.current?.path) return
            if (savingRef.current) {
                externalChangePending.current = true
                return
            }
            void checkExternalChange()
        }
        manager.addEventListener('projectFileChange', onProjectFileChange)
        return () => manager.removeEventListener('projectFileChange', onProjectFileChange)
    }, [checkExternalChange, manager])

    const dirty = draft !== savedContent
    useEffect(() => {
        manager.setSourceDraftDirty(dirty)
    }, [dirty, manager])
    useEffect(() => () => manager.setSourceDraftDirty(false), [manager])

    const activePath = activeEntry?.path
    useEffect(() => {
        if (!selectedPath || !activePath) return
        const keydown = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
                event.preventDefault()
                void save()
            }
        }
        window.addEventListener('keydown', keydown)
        return () => window.removeEventListener('keydown', keydown)
    }, [activePath, save, selectedPath])

    if (!selectedSource) return null
    if (!activeEntry) return <div className="source-editor-placeholder">
        {loading && <Spinner size={24}/>}
        {message && <Callout compact intent={Intent.WARNING}>{message}</Callout>}
    </div>

    const pendingDifferentFile = pendingEntry && pendingEntry.path !== activeEntry.path
    return <div className="source-editor" data-testid="source-editor">
        <div className="source-editor-toolbar">
            <strong title={activeEntry.path}>{activeEntry.path}</strong>
            <span className="source-editor-status" data-testid="source-editor-status">{dirty ? 'Unsaved changes' : 'Saved'}</span>
            <ButtonGroup>
                <Button
                    small
                    icon="undo"
                    text="Revert"
                    disabled={!dirty || loading || saving}
                    onClick={() => {
                        ++loadGeneration.current
                        draftRef.current = savedRef.current
                        setDraft(savedRef.current)
                        setMessage(undefined)
                    }}
                />
                <Button
                    small
                    intent={Intent.PRIMARY}
                    icon="floppy-disk"
                    text="Save"
                    loading={saving}
                    disabled={!dirty || conflicted}
                    onClick={() => void save()}
                />
            </ButtonGroup>
        </div>
        {message && <Callout compact intent={conflicted || pendingDifferentFile ? Intent.WARNING : Intent.NONE}>{message}</Callout>}
        {conflicted && <ButtonGroup className="source-conflict-actions">
            <Button small icon="refresh" text="Reload" disabled={saving} onClick={() => void reload()}/>
            <Button small intent={Intent.DANGER} text="Overwrite" disabled={saving} onClick={() => void save(true)}/>
        </ButtonGroup>}
        {pendingDifferentFile && <Button
            small
            intent={Intent.WARNING}
            text="Discard & open selected"
            disabled={saving}
            onClick={() => void load(pendingEntry, true)}
        />}
        <div className="source-editor-input">
            <Suspense fallback={<div className="source-editor-loading"><Spinner size={20}/></div>}>
                <SourceCodeEditor
                    path={activeEntry.path}
                    value={draft}
                    onChange={(value) => {
                        ++loadGeneration.current
                        setLoading(false)
                        draftRef.current = value
                        setDraft(value)
                        if (!conflicted) setMessage(undefined)
                    }}
                />
            </Suspense>
        </div>
    </div>
}

function decodeUtf8(bytes: Uint8Array): string {
    try {
        return new TextDecoder('utf-8', {fatal: true}).decode(bytes)
    } catch {
        throw new Error('This file is not valid UTF-8 and cannot be edited as source text.')
    }
}

function isTextExtension(path: string): boolean {
    return isTextSourcePath(path)
}

function fileType(path: string): string {
    const extension = path.includes('.') ? path.slice(path.lastIndexOf('.') + 1).toLowerCase() : ''
    return ({
        css: 'text/css', glb: 'model/gltf-binary', gltf: 'model/gltf+json', html: 'text/html',
        jpeg: 'image/jpeg', jpg: 'image/jpeg', js: 'text/javascript', json: 'application/json',
        md: 'text/markdown', mjcf: 'application/xml', mjs: 'text/javascript', png: 'image/png',
        ts: 'text/typescript', tsx: 'text/typescript', txt: 'text/plain', xml: 'application/xml',
        webp: 'image/webp',
    } as Record<string, string>)[extension] || 'application/octet-stream'
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}
