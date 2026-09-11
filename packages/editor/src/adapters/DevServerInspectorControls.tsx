import {useEffect, useState} from 'react'
import {Button, InputGroup} from '@blueprintjs/core'
import {PickingPlugin, type IObject3D} from 'threepipe'
import {useAssets} from '../utils/AssetsProvider.ts'
import {useManagerVersion} from '../utils/UseManager.ts'

export function DevServerInspectorControls({placement}: {placement: 'header' | 'controls'}) {
    const manager = useManagerVersion()
    const picking = manager.get().getPlugin(PickingPlugin)
    const [, refresh] = useState(0)

    useEffect(() => {
        const changed = () => refresh((value) => value + 1)
        picking?.addEventListener('selectedObjectChanged', changed)
        return () => picking?.removeEventListener('selectedObjectChanged', changed)
    }, [picking])

    const selected = picking?.getSelectedObject()
    const object = !Array.isArray(selected) && (selected as IObject3D | undefined)?.isObject3D
        ? selected as IObject3D
        : undefined
    const generator = object
        ? manager.generatorStates.find(({nodeName}) => nodeName === object.name)
        : undefined

    if (!object) return null
    if (placement === 'header') return <SelectionHeader object={object} generator={generator}/>
    return generator ? <GeneratorInspector generator={generator} object={object}/> : null
}

function SelectionHeader({object, generator}: {
    object: IObject3D
    generator?: ReturnType<typeof useManagerVersion>['generatorStates'][number]
}) {
    const path = generator?.module || objectPath(object)
    const type = generator ? 'Generator' : object.type || 'Object'
    return <section className="kite3d-selection-header">
        <div className="kite3d-selection-name-line">
            <input
                aria-label="Object name"
                id="inspector-object-name"
                value={object.name}
                onChange={(event) => {
                    object.name = event.target.value
                    object.setDirty?.({change: 'name'})
                }}/>
            <span className="kite3d-status-chip">{type}</span>
        </div>
        {path && <code>{path}</code>}
    </section>
}

function GeneratorInspector({generator, object}: {
    generator: ReturnType<typeof useManagerVersion>['generatorStates'][number]
    object: IObject3D
}) {
    const manager = useManagerVersion()
    const {fileManifest, setSelectedFiles} = useAssets()
    const [module, setModule] = useState(generator.module)
    const [params, setParams] = useState(JSON.stringify(generator.params, null, 2))

    useEffect(() => {
        setModule(generator.module)
        setParams(JSON.stringify(generator.params, null, 2))
    }, [generator.module, generator.params])

    const apply = async () => {
        try {
            await manager.updateGenerator(generator, module, JSON.parse(params) as Record<string, unknown>)
        } catch (error) {
            await manager.reportError(error)
        }
    }
    const sourceFile = fileManifest.find(({path}) => normalizeProjectPath(module) === path)
    const previewGenerated = object.children.some(({userData}) => userData.kite3dGenerated === true)
    const openSource = () => {
        if (!sourceFile) return
        setSelectedFiles([sourceFile])
        manager.selectFile(sourceFile.path)
    }

    return <section className="kite3d-panel-section generator-inspector-card" data-testid="generator-inspector">
        <span className="kite3d-semantic-hook">Generator · {generator.nodeName}</span>
        <header className="kite3d-section-header">
            <h3>Generator</h3>
            {previewGenerated && <span className="kite3d-status-chip is-success">Preview generated</span>}
        </header>
        <label className="kite3d-control-row">
            <span>Module</span>
            <InputGroup
                data-testid={`generator-module-${generator.nodeIndex}`}
                value={module}
                onChange={(event) => setModule(event.target.value)}
                onBlur={() => void apply()}/>
        </label>
        <label className="kite3d-control-row is-textarea">
            <span>Params</span>
            <textarea
                className="bp5-input generator-params-input"
                data-testid={`generator-params-${generator.nodeIndex}`}
                value={params}
                onChange={(event) => setParams(event.target.value)}
                onBlur={() => void apply()}/>
        </label>
        <div className="kite3d-generator-actions">
            <Button
                data-testid={`bake-${generator.nodeIndex}`}
                intent="primary"
                onClick={() => void manager.requestBake(generator.nodeName)}
                text="Bake"/>
            <Button onClick={() => void apply()} text="Regenerate"/>
            {sourceFile && <Button minimal={true} onClick={openSource} text="Open source"/>}
            <Button
                data-testid={`force-bake-${generator.nodeIndex}`}
                intent="warning"
                minimal={true}
                onClick={() => {
                    if (window.confirm(`Force bake ${generator.nodeName}? Existing children or human edits may be replaced.`)) {
                        void manager.requestBake(generator.nodeName, true)
                    }
                }}
                text="Force bake"/>
        </div>
    </section>
}

function objectPath(object: IObject3D) {
    const names: string[] = []
    let current: IObject3D | null = object
    while (current?.parent) {
        if (current.name) names.unshift(current.name)
        current = current.parent as IObject3D
        if (current.userData?.rootSceneModelRoot) break
    }
    return names.join(' / ')
}

function normalizeProjectPath(path: string) {
    return path.replace(/^\.\//, '').replace(/^\//, '')
}
