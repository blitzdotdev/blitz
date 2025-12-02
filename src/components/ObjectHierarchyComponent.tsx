import {isExternalObject, useMakeAsset, useManager} from "../utils/ViewerInstanceManager.ts";
import {useContextMenu} from "./ContextMenuProvider.tsx";
import {IObject3D, UiObjectConfig} from "threepipe";
import React, {useMemo} from "react";
import {BPHierarchyComponent} from "./BPHierarchyComponent.tsx";
import {useOnObjectCreate} from "./UseOnObjectCreate.tsx";
import {MenuDivider} from "@blueprintjs/core";
import {Object3DGenerationMenu} from "./Object3DGenerationMenu.tsx";

export function ExtraMenuItems(props: {
    event: React.MouseEvent<HTMLElement>,
    object: IObject3D
}) {
    const obj = props.object
    const onObjectCreate = useOnObjectCreate();
    // todo after onObjectCreate is done, expand the current object if a child is added

    if(!obj?.isObject3D) return null
    const isComponent = obj.userData.rootPath && (obj.userData.sProperties || obj._sChildren)
    const isExternal = isExternalObject(obj)
    const isGroup = !obj.isMesh && !obj.material && !obj.isLine && !obj.isPoints && !obj.isCamera // groups, lights, cameras, helpers, etc
    const canCreate = !isExternal && !isComponent && isGroup
    return canCreate && onObjectCreate ? <>
        <MenuDivider title="Create" className={"context-menu-divider"} />
        <Object3DGenerationMenu onGenerate={(child)=>onObjectCreate(child, obj)}/>
    </> : null
}


export function ObjectHierarchyComponent({className}: { className: string }) {
    const manager = useManager()
    const viewer = manager.get()

    const {makeAsset} = useMakeAsset()
    const actions = {makeAsset}

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

    return <div style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
    }}>
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
