import {useEffect, useState} from 'react'
import {Button} from '@blueprintjs/core'
import {useAssets} from '../utils/AssetsProvider.ts'
import {useManagerVersion} from '../utils/UseManager.ts'

export function DevServerSceneSummary() {
    const manager = useManagerVersion()
    const {fileManifest, setSelectedFiles} = useAssets()
    const sceneFile = fileManifest.find(({path}) => path === manager.scenePath)
    const cameraName = findSceneCameraName(manager.sceneText)
    const objectCount = countObjects(manager.get().scene.modelRoot)
    const lastSave = useRelativeTime(sceneFile?.mtime)
    const check = manager.checkResult
    const openScene = () => {
        if (!sceneFile) return
        setSelectedFiles([sceneFile])
        manager.selectFile(sceneFile.path)
    }

    return <div className="kite3d-inspector-empty">
        <div className="kite3d-empty-prompt">
            <strong>Nothing selected</strong>
            <span>Click an object in the viewport or the Objects list. Pick a file below to edit it.</span>
        </div>
        <section className="kite3d-panel-section kite3d-scene-summary" data-testid="scene-summary">
            <header className="kite3d-section-header">
                <h3>Scene</h3>
                {sceneFile && <Button minimal={true} onClick={openScene} text="Open file"/>}
            </header>
            <SummaryRow label="File" value={manager.scenePath}/>
            {cameraName && <SummaryRow label="Camera" value={cameraName}/>}
            <SummaryRow label="Objects" value={String(objectCount)}/>
            {lastSave && <SummaryRow label="Last save" value={lastSave}/>}
            {check && <div className="kite3d-summary-row">
                <span>Check</span>
                <span className={`kite3d-status-chip ${check.ok ? 'is-success' : 'is-danger'}`}>
                    {check.ok ? 'Passed' : 'Failed'}
                </span>
            </div>}
        </section>
    </div>
}

function SummaryRow({label, value}: {label: string, value: string}) {
    return <div className="kite3d-summary-row">
        <span>{label}</span>
        <code>{value}</code>
    </div>
}

function countObjects(root: {traverse(callback: (object: unknown) => void): void}) {
    let count = -1
    root.traverse(() => { count += 1 })
    return Math.max(0, count)
}

function findSceneCameraName(sceneText: string) {
    try {
        const document = JSON.parse(sceneText) as {
            scene?: number
            scenes?: Array<{nodes?: number[]}>
            nodes?: Array<{camera?: number, children?: number[], name?: string}>
            cameras?: Array<{name?: string}>
        }
        const nodes = document.nodes || []
        const roots = document.scenes?.[document.scene || 0]?.nodes || []
        const pending = [...roots]
        const visited = new Set<number>()
        while (pending.length > 0) {
            const index = pending.shift()!
            if (visited.has(index)) continue
            visited.add(index)
            const node = nodes[index]
            if (!node) continue
            if (typeof node.camera === 'number') {
                return node.name?.trim() || document.cameras?.[node.camera]?.name?.trim() || 'Camera'
            }
            pending.push(...node.children || [])
        }
    } catch { /* the load error is reported by the project manager */ }
    return ''
}

function useRelativeTime(timestamp?: number) {
    const [now, setNow] = useState(() => Date.now())
    useEffect(() => {
        if (!timestamp) return
        const timer = window.setInterval(() => setNow(Date.now()), 30_000)
        return () => window.clearInterval(timer)
    }, [timestamp])
    if (!timestamp) return undefined
    const seconds = Math.max(0, Math.floor((now - timestamp) / 1000))
    if (seconds < 5) return 'just now'
    if (seconds < 60) return `${seconds} seconds ago`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
    const days = Math.floor(hours / 24)
    return `${days} day${days === 1 ? '' : 's'} ago`
}
