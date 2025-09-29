import {
    Event2,
    IGeometry,
    IMaterial,
    IObject3D,
    ISceneEventMap,
    ITexture,
    PickingPlugin,
    ThreeViewer,
    UiObjectConfig
} from "threepipe";
import {BPTreeComponent, TreeNodeInfo, UiConfigRendererContextType} from 'uiconfig-blueprint/lib/esm/lib'
import {filterObjectsInSceneRoot} from "../utils/tp-utils.ts";
import React, {useMemo} from "react";
import {useObjContextMenu} from "./UseObjContextMenu.tsx";
import {MenuItem2} from "./ContextMenuUtils.tsx";

interface BPTexturesTreeComponentPropsExtras{
    handleContextMenu?: (e: React.MouseEvent<HTMLElement, MouseEvent>, menuItems: MenuItem2[]) => void
}
export class BPTexturesTreeComponent<T extends ITexture = ITexture> extends BPTreeComponent<T, IObject3D, BPTexturesTreeComponentPropsExtras> {
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
        // if(obj.isPhysicalTexture){
        //     node.icon = bpUiConfigIcons['shape-sphere-filled-1']({style: {color: 'transparent'}, className: 'bp5-tree-node-icon-svg'})
        // }
        // if(obj.isUnlitTexture){
        //     node.icon = 'full-circle'
        // }
        return node;
    }
    //
    // // todo use from material manager in next version
    // static GetMapsForMaterial(material: IMaterial) {
    //     const maps = new Set<ITexture>()
    //     // todo use MaterialProperties or similar to find the maps in the material. This is a bit hacky
    //     for (const val of Object.values(material)) {
    //         if (val && val.isTexture) {
    //             maps.add(val)
    //         }
    //     }
    //     for (const val of Object.values(material.userData ?? {})) {
    //         if (val && (val as any).isTexture) {
    //             maps.add(val as ITexture)
    //         }
    //     }
    //     return maps
    // }

    protected _getRootNodes(): T[] {
        // const v = this.context.methods.getRawValue(this.props.config)
        // return v?.children as any || [] // todo as any
        const showAll = false
        if(showAll) {
            let mats =
                showAll ?
                    this.context.viewer.materialManager.getAllMaterials() || [] :
                    this.context.viewer.object3dManager.getMaterials() // only materials in scene
            if(!showAll)
                mats = Array.from(filterObjectsInSceneRoot(mats))

            const textures = new Set<ITexture>()
            mats.forEach((m: IMaterial) => {
                const maps = m._mapRefs || []
                maps.forEach((t: ITexture) => {
                    if (t && t.isTexture) {
                        textures.add(t)
                    }
                })
            })
            return Array.from(textures) as T[]
        }else {
            return this.context.viewer.object3dManager.getTextures() as T[]
        }
        // return getValue(this.props.config)
        // return (this.props.config.children || []).map(c => getOrCall(c) || {}).flat(2)
    }

    protected async _onNodeClick(_id: string) {
        const node = this._infoMap.get(_id)
        if(!node) return
        const value = node.isSelected ? null : node.nodeData! // unselect if already selected
        // node.nodeData!.dispatchEvent({type: 'select', value: value ?? null, texture: node.nodeData!, ui: true, bubbleToMaterial: true, bubbleToObject: true, bubbleToParent: true})
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
        // const obj = node.nodeData!

        // if(canMakeAsset(obj)){
        //     items.push(<MakeAssetMenuItem obj={obj}/>)
        // }

        this.props.handleContextMenu?.(_e, items)


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
            this.props.config.uiRefresh?.(true, 'postFrame', 1)
            // @ts-ignore
            // hierarchyConfig.children![0]!.uiRefresh?.()
        }
    }

    private textureUpdate = (e: Event2<'textureUpdate'|'texturesChanged', ISceneEventMap, IObject3D>) => {
        // private textureUpdate = (e: any) => {
        // if (e.refreshUi !== false && (e.change === 'name' || e.key === 'name')) {
        //     this.props.config.uiRefresh?.(true, 'postFrame')
        //     // @ts-ignore
        //     // hierarchyConfig.children![0]!.uiRefresh?.()
        // }
        this.props.config.uiRefresh?.(true, 'postFrame', 1)
        // console.log('texture updated', e)
    }

    componentDidMount() {
        super.componentDidMount();
        const viewer = this.context.viewer
        if(!viewer) {
            console.error('BPTexturesTreeComponent: viewer not found in context', this.context)
            return
        }
        viewer.getPlugin(PickingPlugin)?.addEventListener('selectedObjectChanged', this.selectedObjectChanged)
        viewer.scene.addEventListener('sceneUpdate', this.sceneUpdate) // todo: subscribe only to the texture in the config instead of the whole scene
        viewer.scene.addEventListener('textureUpdate', this.textureUpdate) // todo: subscribe only to the texture in the config instead of the whole scene
        viewer.scene.addEventListener('texturesChanged', this.textureUpdate) // todo: subscribe only to the texture in the config instead of the whole scene
    }

    componentWillUnmount() {
        const viewer = this.context.viewer
        if(!viewer) {
            console.error('BPTexturesTreeComponent Unmount: viewer not found in context', this.context)
            return
        }
        viewer.getPlugin(PickingPlugin)?.removeEventListener('selectedObjectChanged', this.selectedObjectChanged)
        viewer.scene.removeEventListener('sceneUpdate', this.sceneUpdate)
        viewer.scene.removeEventListener('textureUpdate', this.textureUpdate)
        viewer.scene.removeEventListener('texturesChanged', this.textureUpdate)
        super.componentWillUnmount();
    }

}

export function TextureHierarchyComponent({className, root}: {className: string, root: IObject3D|null}){
    const {handleContextMenu} = useObjContextMenu()
    const config: UiObjectConfig = useMemo(()=>({
        type: 'hierarchy',
        uuid: Math.random().toString(36).substring(2, 15),
        value: root
    }), [root])

    return <BPTexturesTreeComponent config={config} handleContextMenu={handleContextMenu} className={className}/>
}
