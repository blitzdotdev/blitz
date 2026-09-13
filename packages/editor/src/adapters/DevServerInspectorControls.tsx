import {useEffect, useState} from 'react'
import {PickingPlugin, type IObject3D} from 'threepipe'
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
    if (!object) return null
    if (placement === 'header') return <SelectionHeader object={object}/>
    return null
}

function SelectionHeader({object}: {object: IObject3D}) {
    const path = objectPath(object)
    const type = object.type || 'Object'
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
