import {
    Event2,
    Group,
    IObject3D,
    ISceneEventMap,
    JSUndoManagerCommand1,
    ObjectPickerEventMap,
    PickingPlugin,
    ThreeViewer,
    UiObjectConfig,
    UndoManagerPlugin
} from "threepipe";
import {AppToaster, bpUiConfigIcons, UiConfigRendererContextType} from 'uiconfig-blueprint/lib/esm/lib'
import {VisibilityIcon} from "./VisibilityIcon";
import React, {FC, useMemo} from "react";
import {canMakeAsset, isExternalObject, logAsset, useMakeAsset, useManager} from "../utils/ViewerInstanceManager.ts";
import {HandleContextMenuCallback, MenuItem2} from "./ContextMenuUtils.tsx";
import {Intent, MenuDivider} from "@blueprintjs/core";
import {BPTreeComponent} from "./BPTreeComponent.tsx";
import {TreeNodeInfo} from "./treeTypes.ts";
import {Object3DGenerationMenu, useOnObjectCreate} from "./Object3DGenerationMenu.tsx";
import {useContextMenu} from "./ContextMenuProvider.tsx";

interface BPHierarchyComponentPropsExtras extends HandleContextMenuCallback<IObject3D>{
}
export class BPHierarchyComponent<T extends IObject3D = IObject3D> extends BPTreeComponent<T, IObject3D, BPHierarchyComponentPropsExtras> {
    declare context: UiConfigRendererContextType&{viewer: ThreeViewer}

    protected _createNodeInfo(id: string, obj: T) {
        return Object.assign(super._createNodeInfo(id, obj), {
            secondaryLabel: (<VisibilityIcon obj={obj}/>),
            draggable: true,
            droppable: true,
        })
    }

    protected _getNodeId(obj: T) {
        return obj.uuid;
    }

    protected _updateNodeInfo(node: TreeNodeInfo<T>, obj: T) {
        node.label = obj.name ? obj.name : obj.type ? `(${obj.type})` : 'unnamed';
        if(!obj.isMesh && !obj.isLine && !obj.isPoints && !obj.isScene && !obj.isCamera && !obj.isLight)
            // todo _sChildren
            node.childNodes = ((obj.children as T[]) || []).reduce<any[]>((...args) => this.buildData(...args), [])
        node.isSelected = this._selectedId === node.id
        const isComponent = obj.userData.rootPath && (obj.userData.sProperties || obj._sChildren)
        const isExternal = isExternalObject(obj)
        const isGroup = obj.isGroup
        node.droppable = !isExternal && !isComponent && isGroup
        node.draggable = !isExternal
        node.intent = isComponent ? Intent.WARNING : isExternal ? Intent.PRIMARY : Intent.NONE

        // node.hasCaret = (node.childNodes?.length||0) > 0
        node.icon = undefined
        if(obj.isLight){
            if((obj as any).isAmbientLight) {
                node.icon = bpUiConfigIcons['shape-diamond-filled-mono-3']({style: {color: 'transparent'}, className: 'bp5-tree-node-icon-svg'})
                // node.icon = 'flash';
            }else if((obj as any).isPointLight) {
                // node.icon = bpUiConfigIcons['shape-diamond-filled-3']({style: {color: 'transparent'}, className: 'bp5-tree-node-icon-svg'})
                // node.icon = bpUiConfigIcons['shape-diamond-filled-3']({style: {color: 'transparent'}, className: 'bp5-tree-node-icon-svg'})
                node.icon = 'flash';
            }else if((obj as any).isDirectionalLight) {
                node.icon = 'torch';
            }else if((obj as any).isSpotLight) {
                node.icon = bpUiConfigIcons['shape-cone-filled-2']({style: {color: 'transparent'}, className: 'bp5-tree-node-icon-svg'})
            }else if((obj as any).isRectAreaLight) {
                node.icon = 'rectangle';
            }else if((obj as any).isHemisphereLight){
                node.icon = bpUiConfigIcons['shape-sphere-cut-filled-1']({style: {color: 'transparent'}, className: 'bp5-tree-node-icon-svg'})
            }
        }
        if(obj.isMesh){
            node.icon = bpUiConfigIcons['shape-cube-transparent-filled-mono']({style: {color: 'transparent'}, className: 'bp5-tree-node-icon-svg'})
        }
        if(obj.isCamera){
            node.icon = (obj as any).isPerspectiveCamera ?
                bpUiConfigIcons['shape-trapezium-filled-mono-2']({style: {color: 'transparent'}}) :
                (obj as any).isOrthographicCamera ?
                    bpUiConfigIcons['shape-cuboid-filled-mono-1']({style: {color: 'transparent'}}) :
                'camera'
        }
        if(obj.isLine){
            node.icon = 'flows'
        }
        node.hasCaret = !node.icon
        // node.icon = 'layer-outline'
        return node;
    }

    protected _getRootNodes(): T[] {
        // @ts-expect-error config type?
        const v = this.context.methods.getRawValue<T>(this.props.config)
        return v?.children as any || [] // todo as any
        // return getValue(this.props.config)
        // return (this.props.config.children || []).map(c => getOrCall(c) || {}).flat(2)
    }

    protected async _onNodeClick(_id: string) {
        const node = this._infoMap.get(_id)
        if(!node) return
        const value = node.isSelected ? null : node.nodeData! // unselect if already selected
        node.nodeData!.dispatchEvent({type: 'select', value: value ?? null, object: node.nodeData!, ui: true, bubbleToParent: true})
    }

    protected async _onNodeDoubleClick(_id: string) {
        const node = this._infoMap.get(_id)
        if(!node) return
        node.nodeData!.dispatchEvent({
            type: 'select',
            value: node.nodeData!,
            object: node.nodeData!,
            ui: true,
            focusCamera: true,
            bubbleToParent: true,
        })
    }

    protected async _onNodeContextMenu(_id:string | number, _e: React.MouseEvent<HTMLElement, MouseEvent>){
        // console.log(_id, _e)
        _e.preventDefault()
        _e.stopPropagation()

        const items: MenuItem2[] = []
        const node = this._infoMap.get(_id)
        if(!node) return
        const obj = node.nodeData!

        if(canMakeAsset(obj)){
            items.push({
                props: {
                    text: 'Make Asset',
                },
                key: 'makeAsset',
                action: 'makeAsset',
                data: {obj}
            })
        }

        // todo use uiconfig methods to find buttons
        obj.uiConfig?.children?.filter(c=>typeof c === 'object' && c.tags?.includes('context-menu')).map(btn=>{
            if (!btn || typeof btn !== 'object') return;
            const label = this.context.methods.getLabel(btn)
            items.push({
                props: {
                    text: this.context.methods.getLabel(btn),
                },
                key: btn.key  || label,
                action: (data, obj, e) => {
                    this.context.methods.clickButton(btn, {args: [e]})
                },
                data: {}
            })
        })

        this.props.handleContextMenu?.(_e, items, obj)

        return this._onNodeClick(_id as string) // select on right click
    }

    protected _canDropNode(sourceNode: TreeNodeInfo<T>, _sourcePath: number[], targetNode: TreeNodeInfo<T>, _targetPath: number[], index?: number) {
        const source = sourceNode.nodeData
        const target = targetNode.nodeData
        if (!target || !source) return false
        if (sourceNode.id === targetNode.id) return false

        const noTypes = [ 'Mesh', 'Line', 'Points' ]
        if (noTypes.includes(target.type)) return false
        let compatible = true
        target.traverseAncestors(c=>c.id === source!.id && (compatible = false))
        if(!compatible) return false // source is an ancestor of target

        // target ancestor of source
        // source.traverseAncestors(c=>c.id === target!.id && (compatible = false))
        if(source.parent === target){
            if(index !== undefined && target.children.indexOf(source) !== index) return true
            else return false
        }else if(index === undefined) {
            // if no index is given, we can drop it anywhere
            return true
        }
        return true
    }

    protected _onDropNode(sourceNode: TreeNodeInfo<T>, _sourcePath: number[], targetNode: TreeNodeInfo<T>, _targetPath: number[], _e?: React.DragEvent, index?: number) {
        if(!targetNode.nodeData || !sourceNode.nodeData) return
        const source = sourceNode.nodeData
        const target = targetNode.nodeData
        if(source === target || source.id === target.id) return // same object
        const viewer = this.context.viewer
        if(!viewer) {
            console.error('BPHierarchyComponent: viewer not found in context', this.context)
            return
        }
        const lastParent = source.parent
        const lastIndex = lastParent?.children.indexOf(source) ?? -1
        let newIndex = index ?? -1
        const undoManager = viewer.getPlugin(UndoManagerPlugin)?.undoManager

        function addAtIndex(target: IObject3D, newIndex: number = -1) {
            // todo check if target is parent of source, in case only reordering (but that wont fire events like setDirty?)
            target.add(source)
            const newIndex2 = target.children.indexOf(source)
            if (newIndex >= 0 && newIndex2 >= 0 && newIndex !== newIndex2) {
                target.children.splice(newIndex2, 1)
                target.children.splice(newIndex, 0, source) // add at new index
                return newIndex
            }
            return newIndex2;
        }

        const cmd = {
            redo: () => {
                // todo use attach if e?.shiftKey
                newIndex = addAtIndex(target, newIndex);
            },
            undo: () => {
                if (lastParent) {
                    addAtIndex(lastParent, lastIndex);
                    // source!.dispatchEvent({type: 'select', value: source, object: source, ui: true})
                }
            },
        } as JSUndoManagerCommand1
        undoManager?.record(cmd)
        cmd.redo() // apply the command immediately
        return
    }

    // refreshSelected(){
    //     if(!this.context.viewer) this.setSelected(undefined)
    //     this.context.viewer?.doOnce('postFrame', () => {
    //         const selected = this.context.viewer?.getPlugin(PickingPlugin)?.getSelectedObject()
    //         // source?.dispatchEvent({type: 'select', value: source, object: source, ui: true})
    //         this.setSelected(selected?.uuid, true)
    //     })
    // }

    // getUpdatedState(_state: BPTreeComponentState<T>): BPTreeComponentState<T> {
    //     console.log('update', _state)
    //     return super.getUpdatedState(_state);
    // }

    private _selectedId: string|undefined = undefined
    private selectedObjectChanged = (e: ObjectPickerEventMap['selectedObjectChanged']) => {
        this._selectedId = e.object?.uuid
        this.setSelected(this._selectedId, true)
        // this.props.config.uiRefresh?.(true, 'postFrame')
        // this.refreshSelected()
    }
    private sceneUpdate = (e: any) => {
        if (e.hierarchyChanged) {
            this.props.config.uiRefresh?.(true, 'postFrame')
            // @ts-ignore
            // hierarchyConfig.children![0]!.uiRefresh?.()
        }
    }
    private objectUpdate = (e: Event2<'objectUpdate', ISceneEventMap, IObject3D>) => {
        // private objectUpdate = (e: any) => {
        if (e.refreshUi !== false && (e.change === 'name' || e.key === 'name')) {
            this.props.config.uiRefresh?.(true, 'postFrame')
            // @ts-ignore
            // hierarchyConfig.children![0]!.uiRefresh?.()
        }
    }

    componentDidMount() {
        super.componentDidMount();
        const viewer = this.context.viewer
        if(!viewer) {
            console.error('BPHierarchyComponent: viewer not found in context', this.context)
            return
        }
        viewer.getPlugin(PickingPlugin)?.addEventListener('selectedObjectChanged', this.selectedObjectChanged)
        viewer.scene.addEventListener('sceneUpdate', this.sceneUpdate) // todo: subscribe only to the object in the config instead of the whole scene
        viewer.scene.addEventListener('objectUpdate', this.objectUpdate) // todo: subscribe only to the object in the config instead of the whole scene
    }

    componentWillUnmount() {
        const viewer = this.context.viewer
        if(!viewer) {
            console.error('BPHierarchyComponent Unmount: viewer not found in context', this.context)
            return
        }
        viewer.getPlugin(PickingPlugin)?.removeEventListener('selectedObjectChanged', this.selectedObjectChanged)
        viewer.scene.removeEventListener('sceneUpdate', this.sceneUpdate)
        viewer.scene.removeEventListener('objectUpdate', this.objectUpdate)
        super.componentWillUnmount();
    }

}

function ExtraMenuItems(props: {
    event: React.MouseEvent<HTMLElement>,
    object: IObject3D
}) {
    const obj = props.object
    const onObjectCreate = useOnObjectCreate();
    // todo after onObjectCreate is done, expand the current object if a child is added

    if(!obj?.isObject3D) return null
    const isComponent = obj.userData.rootPath && (obj.userData.sProperties || obj._sChildren)
    const isExternal = isExternalObject(obj)
    const isGroup = obj.isGroup
    const canCreate = !isExternal && !isComponent && isGroup
    return canCreate && onObjectCreate ? <>
        <MenuDivider title="Create" className={"context-menu-divider"} />
        <Object3DGenerationMenu onGenerate={(child)=>onObjectCreate(child, obj)}/>
    </> : null
}

export function ObjectHierarchyComponent({className}: {className: string}){
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

    const config: UiObjectConfig = useMemo(()=>({
        type: 'hierarchy',
        uuid: Math.random().toString(36).substring(2, 15),
        value: viewer.scene.modelRoot,
    }), [viewer])

    // const children = [...manager?.get().scene.modelRoot.children]

    return <BPHierarchyComponent config={config}
                                 // key={viewer.scene.modelRoot.uuid}
                                 handleContextMenu={(e, items, obj)=>{
                                     contextMenu.handleContextMenu({
                                         event: e,
                                         actionItems: items,
                                         actions: actions,
                                         obj: obj,
                                         Items: ExtraMenuItems,
                                     })
                                 }}
                                 className={className}/>
}
