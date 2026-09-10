import {isExternalObject} from "../utils/projectUtils.ts";
import {useContextMenu} from "./ContextMenuProvider.tsx";
import {IObject3D, UiObjectConfig} from "threepipe";
import React, {useEffect, useMemo, useState} from "react";
import {BPHierarchyComponent} from "./BPHierarchyComponent.tsx";
import {useOnObjectCreate} from "./UseOnObjectCreate.tsx";
import {Object3DGenerationMenu} from "./Object3DGenerationMenu.tsx";
import {useManager} from "../utils/UseManager.ts";
import {useMakeAsset} from "../utils/UseMakeAsset.ts";

export function ExtraMenuItems(props: {
    event: React.MouseEvent<HTMLElement>,
    object: IObject3D
}) {
    const obj = props.object
    const onObjectCreate = useOnObjectCreate();
    // todo after onObjectCreate is done, expand the current object if a child is added

    if(!obj?.isObject3D) return null
    // AGREED-4: the registered transport identity does not change the local
    // import's reference object-menu presentation.
    const isComponent = !obj.userData.blitzImportedInstance && obj.userData.rootPath && (obj.userData.sProperties || obj._sChildren)
    const isExternal = isExternalObject(obj)
    const isGroup = !obj.isMesh && !obj.material && !obj.isLine && !obj.isPoints && !obj.isCamera // groups, lights, cameras, helpers, etc
    const canCreate = !isExternal && !isComponent && isGroup
    return canCreate && onObjectCreate ? <>
        <Object3DGenerationMenu onGenerate={(child)=>onObjectCreate(child, obj)}/>
    </> : null
}


export function ObjectHierarchyComponent({className}: { className: string }) {
    const manager = useManager()
    const viewer = manager.get()

    const {makeAsset} = useMakeAsset()
    const actions = {makeAsset,
        moveInParent: (data: { obj: IObject3D, delta: number }) => {
            const parent = data.obj.parent
            if (!parent) return
            const index = parent.children.indexOf(data.obj)
            if (index === -1) return
            let newIndex = index + data.delta
            newIndex = Math.max(0, Math.min(parent.children.length - 1, newIndex))
            if (newIndex === index) return
            parent.children.splice(index, 1)
            parent.children.splice(newIndex, 0, data.obj)
            data.obj?.setDirty && data.obj?.setDirty({change: 'indexInParent'})
    }}

    // const {handleContextMenu} = useObjContextMenu(actions, (ev)=>{
    //     return onObjectCreate ? <>
    //         <MenuDivider title="Create" className={"context-menu-divider"} />
    //         <Object3DGenerationMenu onGenerate={(obj)=>onObjectCreate(obj, ev.object)}/>
    //     </> : null
    // })

    const contextMenu = useContextMenu()

    const config: UiObjectConfig = useMemo(() => ({
        type: 'hierarchy',
        uuid: Math.random().toString(36).substring(2, 15),
        value: viewer.scene.modelRoot,
    }), [viewer])

    // const children = [...manager?.get().scene.modelRoot.children]

    return <div data-testid="scene-hierarchy" style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
    }}>
        <GeneratedObjectNames viewer={viewer}/>
        <BPHierarchyComponent
            config={config}
            key={viewer.scene.modelRoot.uuid} // this is required because viewer can be destroyed and recreated
            handleContextMenu={(e, items, obj) => {
                contextMenu.handleContextMenu({
                    event: e,
                    actionItems: items,
                    actions: actions,
                    obj: obj,
                    Items: ExtraMenuItems,
                })
            }}
            className={className}/>
    </div>
}

function GeneratedObjectNames({viewer}: {viewer: ReturnType<ReturnType<typeof useManager>['get']>}) {
    const readNames = () => {
        const names: string[] = []
        viewer.scene.modelRoot.traverse((object) => {
            if (object.userData.blitzGenerated === true) names.push(`${object.name} generated`)
        })
        return names.join('\n')
    }
    const [names, setNames] = useState(readNames)
    useEffect(() => {
        // AGREED-4: preserve the dev-server generator status exposed by the prior
        // hierarchy without changing the reference tree's visible expansion state.
        const timer = window.setInterval(() => {
            const next = readNames()
            setNames((current) => current === next ? current : next)
        }, 100)
        return () => window.clearInterval(timer)
    }, [viewer])
    return <span className="blitz-semantic-hook">{names}</span>
}
