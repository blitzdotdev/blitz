import {Event2, IGeometry, IObject3D, ISceneEventMap, PickingPlugin, ThreeViewer, UiObjectConfig} from "threepipe";
import {UiConfigRendererContextType} from 'uiconfig-blueprint/lib/esm/lib'
import {filterObjectsInSceneRoot} from "../utils/tp-utils.ts";
import React, {useMemo} from "react";
import {useObjContextMenu} from "./UseObjContextMenu.tsx";
import {HandleContextMenuCallback, MenuItem2} from "./ContextMenuUtils.tsx";
import {BPTreeComponent} from "./BPTreeComponent.tsx";
import {TreeNodeInfo} from "./treeTypes.ts";

interface BPGeometriesTreeComponentPropsExtras extends HandleContextMenuCallback<IGeometry>{
}

export class BPGeometriesTreeComponent<T extends IGeometry = IGeometry> extends BPTreeComponent<T, IObject3D, BPGeometriesTreeComponentPropsExtras> {
    declare context: UiConfigRendererContextType&{viewer: ThreeViewer}

    protected _createNodeInfo(id: string, obj: T) {
        return Object.assign(super._createNodeInfo(id, obj), {
            // secondaryLabel: (<VisibilityIcon obj={obj}/>),
            draggable: false,
            droppable: false,
            hasCaret: false,
        } as Partial<TreeNodeInfo<T>>);
    }

    protected _getNodeId(obj: T) {
        return obj.uuid;
    }

    protected _updateNodeInfo(node: TreeNodeInfo<T>, obj: T) {
        node.label = obj.name ? obj.name : obj.type ? `(${obj.type})` : 'unnamed';
        // if(!obj.isMesh && !obj.isLine && !obj.isPoints && !obj.isScene && !obj.isCamera && !obj.isLight)
        //     node.childNodes = ((obj.children as T[]) || []).reduce<any[]>((...args) => this.buildData(...args), [])
        node.isSelected = this._selectedIds?.includes(node.id as string) ?? false
        // if(obj.isPhysicalMaterial){
        //     node.icon = bpUiConfigIcons['shape-sphere-filled-1']({style: {color: 'transparent'}, className: 'bp5-tree-node-icon-svg'})
        // }
        // if(obj.isUnlitMaterial){
        //     node.icon = 'full-circle'
        // }
        // todo set icon based on if its generated or not and its type?
        return node;
    }

    protected _getRootNodes(): T[] {
        const showAll = false // todo param in ui
        const geoms = this.context.viewer.object3dManager.getGeometries()
        if(showAll)
            return Array.from(geoms) as T[]
        const inRoot = filterObjectsInSceneRoot(geoms);
        return Array.from(inRoot) as T[] // only return geometries that are in the root scene model root
    }

    protected async _onNodeClick(_id: string) {
        const node = this._infoMap.get(_id)
        if(!node) return
        const value = node.isSelected ? null : node.nodeData! // unselect if already selected
        // node.nodeData!.dispatchEvent({type: 'select', value: value ?? null, material: node.nodeData!, ui: true, bubbleToObject: true, bubbleToParent: true})
        this.context.viewer.getPlugin(PickingPlugin)?.setSelectedObject(value)
    }

    protected async _onNodeDoubleClick(_id: string) {
        const node = this._infoMap.get(_id)
        if(!node) return
        // node.nodeData!.dispatchEvent({
        //     type: 'select',
        //     value: node.nodeData!,
        //     material: node.nodeData!,
        //     ui: true,
        //     focusCamera: true
        // })
    }

    protected async _onNodeContextMenu(_id:string | number, _e: React.MouseEvent<HTMLElement, MouseEvent>){
        console.log(_id, _e)

        const items: MenuItem2[] = []
        const node = this._infoMap.get(_id)
        if(!node) return
        const obj = node.nodeData!

        // if(canMakeAsset(obj)){
        //     items.push(<MakeAssetMenuItem obj={obj}/>)
        // }

        this.props.handleContextMenu?.(_e, items, obj)

    }
    // refreshSelected(){
    //     if(!this.context.viewer) this.setSelected(undefined)
    //     this.context.viewer?.doOnce('postFrame', () => {
    //         const selected = this.context.viewer?.getPlugin(PickingPlugin)?.getSelectedObject()
    //         // source?.dispatchEvent({type: 'select', value: source, object: source, ui: true})
    //         this.setSelected(selected?.uuid, true)
    //     })
    // }

    private _selectedIds: string[] = []
    private selectedObjectChanged = (e: any) => {
        const geoms = e.value ? Array.isArray(e.value) ? e.value : [e.value] : /*e.object?.materials ||*/ []
        this._selectedIds = geoms?.map((m: IGeometry) => m.uuid)
        this.setSelected(this._selectedIds, false)
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
    private geometryUpdate = (e: Event2<'geometryUpdate', ISceneEventMap, IObject3D>) => {
        // private geometryUpdate = (e: any) => {
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
            console.error('BPGeometriesTreeComponent: viewer not found in context', this.context)
            return
        }
        viewer.getPlugin(PickingPlugin)?.addEventListener('selectedObjectChanged', this.selectedObjectChanged)
        viewer.scene.addEventListener('sceneUpdate', this.sceneUpdate) // todo: subscribe only to the geometry in the config instead of the whole scene
        viewer.scene.addEventListener('geometryUpdate', this.geometryUpdate) // todo: subscribe only to the geometry in the config instead of the whole scene
    }

    componentWillUnmount() {
        const viewer = this.context.viewer
        if(!viewer) {
            console.error('BPGeometriesTreeComponent Unmount: viewer not found in context', this.context)
            return
        }
        viewer.getPlugin(PickingPlugin)?.removeEventListener('selectedObjectChanged', this.selectedObjectChanged)
        viewer.scene.removeEventListener('sceneUpdate', this.sceneUpdate)
        viewer.scene.removeEventListener('geometryUpdate', this.geometryUpdate)
        super.componentWillUnmount();
    }

}

export function GeometryHierarchyComponent({className}: {className: string}){
    const {handleContextMenu} = useObjContextMenu()
    const config: UiObjectConfig = useMemo(()=>({
        type: 'hierarchy',
        uuid: Math.random().toString(36).substring(2, 15),
        value: null
    }), [])

    return <BPGeometriesTreeComponent config={config} handleContextMenu={handleContextMenu} className={className}/>
}
