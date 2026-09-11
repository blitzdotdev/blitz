import {useEffect, useState} from 'react'
import {Button, ButtonGroup, Card, FormGroup, InputGroup} from '@blueprintjs/core'
import {PickingPlugin, type IObject3D} from 'threepipe'
import {useManagerVersion} from '../utils/UseManager.ts'

export function DevServerInspectorControls() {
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

    return <>
        {object && <input
            id="inspector-object-name"
            className="kite3d-semantic-hook"
            value={object.name}
            onChange={(event) => {
                object.name = event.target.value
                object.setDirty?.({change: 'name'})
            }}/>} 
        {generator && <GeneratorInspector generator={generator}/>} 
    </>
}

function GeneratorInspector({generator}: {
    generator: ReturnType<typeof useManagerVersion>['generatorStates'][number]
}) {
    const manager = useManagerVersion()
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

    return <Card className="generator-inspector-card" data-testid="generator-inspector" compact>
        <h3>Generator · {generator.nodeName}</h3>
        <FormGroup label="Module">
            <InputGroup
                data-testid={`generator-module-${generator.nodeIndex}`}
                value={module}
                onChange={(event) => setModule(event.target.value)}
                onBlur={() => void apply()}/>
        </FormGroup>
        <FormGroup label="Params">
            <textarea
                className="bp5-input generator-params-input"
                data-testid={`generator-params-${generator.nodeIndex}`}
                value={params}
                onChange={(event) => setParams(event.target.value)}
                onBlur={() => void apply()}/>
        </FormGroup>
        <ButtonGroup>
            <Button data-testid={`bake-${generator.nodeIndex}`} onClick={() => void manager.requestBake(generator.nodeName)}>Bake</Button>
            <Button data-testid={`force-bake-${generator.nodeIndex}`} intent="warning" onClick={() => {
                if (window.confirm(`Force bake ${generator.nodeName}? Existing children or human edits may be replaced.`)) {
                    void manager.requestBake(generator.nodeName, true)
                }
            }}>Force bake</Button>
        </ButtonGroup>
    </Card>
}
