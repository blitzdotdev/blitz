import {
    Event2,
    IObject3D,
    ISceneEventMap,
    ObjectPickerEventMap,
    PickingPlugin,
    RootScene,
    ThreeViewer
} from "threepipe";
import {bpUiConfigIcons, UiConfigRendererContextType} from 'uiconfig-blueprint/lib/esm/lib'
import {VisibilityIcon} from "./VisibilityIcon";
import React from "react";
import {canMakeAsset, isExternalObject} from "../utils/projectUtils.ts";
import {HandleContextMenuCallback, MenuItem2} from "../utils/ContextMenuUtils.ts";
import {Intent} from "@blueprintjs/core";
import {BPTreeComponent} from "./BPTreeComponent.tsx";
import {TreeNodeInfo} from "./treeTypes.ts";
import {canDropNode, CanvasFileDropHandler, isDraggableDroppableNode} from "../utils/CanvasFileDropHandler.tsx";
import {uiConfigToMenuItem} from "../utils/ContextMenuUtils.ts";
import {EditModePlugin} from "../utils/EditModePlugin.ts";

interface BPHierarchyComponentPropsExtras extends HandleContextMenuCallback<IObject3D>{
}
export class BPHierarchyComponent<T extends IObject3D = IObject3D> extends BPTreeComponent<T, IObject3D, BPHierarchyComponentPropsExtras> {
    declare context: UiConfigRendererContextType&{viewer: ThreeViewer}

    protected _createNodeInfo(id: string, obj: T) {
        return Object.assign(super._createNodeInfo(id, obj), {
            secondaryLabel: (<HierarchyStatus obj={obj}/>),
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
            node.icon = /*(obj as any).isPerspectiveCamera ?
                bpUiConfigIcons['shape-trapezium-filled-mono-2']({style: {color: 'transparent'}}) :
                (obj as any).isOrthographicCamera ?
                    bpUiConfigIcons['shape-cuboid-filled-mono-1']({style: {color: 'transparent'}}) :*/
                'camera'
        }
        if(obj.isLine){
            node.icon = 'flows'
        }
        if(obj.isScene){
            node.icon = 'cubes'
        }
        // node.icon = 'layer-outline'

        if((obj as any as RootScene).isRootScene){
            node.icon = 'layers'
            node.label = 'Scene'
            node.intent = 'none'
            node.hasCaret = false
            node.droppable = false
            node.draggable = false
        }else {
            const {isComponent, isExternal, draggable, droppable} = isDraggableDroppableNode(obj)
            node.droppable = droppable
            node.draggable = draggable
            node.intent = isComponent ? Intent.WARNING : isExternal ? Intent.PRIMARY : Intent.NONE
            node.hasCaret = !node.icon
        }

        return node;
    }

    protected _getRootNodes(): T[] {
        const root = this.context.viewer.scene.modelRoot
        const scene = this.context.viewer.scene
        const camera = this.context.viewer.scene.defaultCamera
        return [scene, camera, ...root.children] as T[]
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
        let isScene = node.nodeData! === this.context.viewer.scene as any
        let obj = node.nodeData!
        node.nodeData!.dispatchEvent({
            type: 'select',
            value: node.nodeData!,
            object: node.nodeData!,
            ui: true,
            focusCamera: !isScene,
            bubbleToParent: true,
        })
        if(isScene){
            this.context.viewer.getPlugin(PickingPlugin)?.focusObject(this.context.viewer.scene.modelRoot)
        }
    }

    protected async _onNodeContextMenu(_id:string | number, _e: React.MouseEvent<HTMLElement, MouseEvent>){
        // console.log(_id, _e)
        _e.preventDefault()
        _e.stopPropagation()

        const items: MenuItem2[] = []
        const node = this._infoMap.get(_id)
        if(!node) return
        const obj = node.nodeData!
        const editMode = this.context.viewer.getPlugin(EditModePlugin)
        const selected = this.context.viewer.getPlugin(PickingPlugin)?.getSelectedObjects<IObject3D>() ?? []
        const isolateObjects = selected.includes(obj) ? [...selected] : [obj]

        if (editMode?.isIsolated || isolateObjects.some(object => {
            for (let current = object.parent; current; current = current.parent) {
                if (current === this.context.viewer.scene.modelRoot) return true
            }
            return false
        })) {
            items.push({
                props: {text: editMode?.isIsolated ? 'Exit Isolate' : 'Isolate'},
                key: 'isolate',
                action: () => editMode?.toggleIsolate(isolateObjects),
            })
        }

        // todo disable only editable options for external objects(using some uiconfig tags.), right now its all.
        const isExternal = isExternalObject(obj)

        if(!isExternal) {

            if (canMakeAsset(obj)) {
                items.push({
                    props: {
                        text: 'Make Asset',
                    },
                    key: 'makeAsset',
                    action: 'makeAsset',
                    data: {obj}
                })
            }

            items.push({
                props: {
                    text: 'Move Up',
                },
                key: 'moveUp',
                action: 'moveInParent',
                data: {obj, delta: -1}
            }, {
                props: {
                    text: 'Move Down',
                },
                key: 'moveDown',
                action: 'moveInParent',
                data: {obj, delta: 1}
            })

            // todo use uiconfig methods to find buttons
            obj.uiConfig?.children
                ?.filter(c => typeof c === 'object' && c.tags?.includes('context-menu'))
                .map(btn => uiConfigToMenuItem(btn, this.context))
                .forEach(menuItem => {
                    if (menuItem) items.push(menuItem)
                })

        }

        this.props.handleContextMenu?.(_e, items, obj)

        return this._onNodeClick(_id as string) // select on right click
    }

    protected _canDropNode(sourceNode: TreeNodeInfo<T>, _sourcePath: number[], targetNode: TreeNodeInfo<T>, _targetPath: number[], index?: number) {
        const source = sourceNode.nodeData
        const target = targetNode.nodeData
        if (!target || !source) return false
        if (sourceNode.id === targetNode.id) return false

        // const drop = this.context.viewer?.getPlugin(CanvasFileDropHandler)
        return canDropNode(source, target, index) ?? false
    }

    protected _onDropNode(sourceNode: TreeNodeInfo<T>, _sourcePath: number[], targetNode: TreeNodeInfo<T>, _targetPath: number[], _e?: React.DragEvent, index?: number) {
        if(!targetNode.nodeData || !sourceNode.nodeData) return
        const source = sourceNode.nodeData
        const target = targetNode.nodeData
        if(source === target || sourceNode.id === targetNode.id) return // same object
        const drop = this.context.viewer?.getPlugin(CanvasFileDropHandler)
        drop?.setDraggedItem(source)
        drop?.setDropTarget(target, true, {index})
        return
    }

    protected _onNodeDragStart(sourceNode: TreeNodeInfo<T>, _sourcePath: number[], e?: React.DragEvent) {
        if(!sourceNode.nodeData) return
        const source = sourceNode.nodeData
        const drop = this.context.viewer?.getPlugin(CanvasFileDropHandler)
        drop?.setDraggedItem(source)

        if(e) {
            try {
                e.dataTransfer.clearData();
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('application/json', JSON.stringify({uuid: source.uuid, name: source.name})); // todo put the json of obj or file blob here
            } catch {
                // ignore
            }
        }
        return
    }

    protected _onNodeDragEnd(sourceNode: TreeNodeInfo<T>, _sourcePath: number[], e?: React.DragEvent) {
        if(!sourceNode.nodeData) return
        const source = sourceNode.nodeData
        const drop = this.context.viewer?.getPlugin(CanvasFileDropHandler)
        drop?.clearDraggedItem(false, source)
        e?.dataTransfer.clearData();
        return
    }

    protected _onNodeDragOver(targetNode: TreeNodeInfo<T>, _targetPath: number[], e?: React.DragEvent, index?: number) {
        if(!targetNode.nodeData) return
        const target = targetNode.nodeData
        const drop = this.context.viewer?.getPlugin(CanvasFileDropHandler)
        drop?.setDropTarget(target, false, {index})
        e?.dataTransfer.clearData();
        return
    }

    protected _onNodeDragLeave(targetNode: TreeNodeInfo<T>, _targetPath: number[], e?: React.DragEvent, index?: number) {
        if(!targetNode.nodeData) return
        const target = targetNode.nodeData
        const drop = this.context.viewer?.getPlugin(CanvasFileDropHandler)
        if(target === drop?.dropTarget)
            drop?.setDropTarget(null, false, {index})
        e?.dataTransfer.clearData();
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
        if (e.refreshUi !== false && (e.change === 'name' || e.key === 'name' || e.change === 'indexInParent')) {
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

function HierarchyStatus({obj}: {obj: IObject3D}) {
    const components = obj.userData?.EntityComponentPlugin
    const removed = obj.userData?.kite3dRemovedGenerator === true
        || components && typeof components === 'object' && !Array.isArray(components)
        && Object.values(components).some((component) => (
            component && typeof component === 'object' && !Array.isArray(component)
            && (component as {type?: unknown}).type === 'Generator'
        ))
    return <span className="kite3d-hierarchy-status">
        {removed && <span className="kite3d-status-chip is-warning" data-testid="removed-generator-chip">Generator removed</span>}
        <VisibilityIcon obj={obj}/>
    </span>
}
