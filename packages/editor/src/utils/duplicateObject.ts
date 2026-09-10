import {
    EntityComponentPlugin,
    generateUUID,
    IObject3D,
    iObjectCommons,
    ThreeViewer,
} from 'threepipe'

/**
 * Duplicate an editor object while preserving component state and assigning
 * every cloned component a new identity. Threepipe's object clone already
 * regenerates object UUIDs, but its serialized component-map keys are userData
 * and otherwise remain shared with the source object.
 */
export async function duplicateObjectWithUniqueComponents(
    object: IObject3D,
    event: Pick<MouseEvent, 'shiftKey'> | undefined,
    viewer: ThreeViewer,
) {
    const parent = object.parent
    const previousChildren = new Set(parent?.children || [])
    const operation = await iObjectCommons.duplicateObject(object, event)
    if (!operation) return operation

    const originalAction = operation.action
    let normalized = false
    let clone: IObject3D | undefined
    const operationWithClone = Object.assign(operation, {clone})
    operationWithClone.action = () => {
        const result = originalAction()
        clone ||= parent?.children.find(child => !previousChildren.has(child)) as IObject3D | undefined
        operationWithClone.clone = clone
        if (clone && !normalized) {
            normalizeClonedComponentIds(clone, viewer)
            normalized = true
        }
        return result
    }
    return operationWithClone
}

function normalizeClonedComponentIds(root: IObject3D, viewer: ThreeViewer) {
    const entities = viewer.getPlugin(EntityComponentPlugin)
    root.traverse(object => {
        const data = EntityComponentPlugin.GetObjectData(object)
        if (!data) return
        for (const [componentId, componentData] of Object.entries(data)) {
            const state = structuredClone(componentData.state)
            if (entities?.removeComponent(object, componentId)) {
                entities.addComponent(object, {type: componentData.type, state})
            } else {
                delete data[componentId]
                data[generateUUID()] = {type: componentData.type, state}
            }
        }
        object.setDirty?.({
            change: `userData.${EntityComponentPlugin.UserDataKey}`,
            source: 'duplicateObjectWithUniqueComponents',
        })
    })
}
