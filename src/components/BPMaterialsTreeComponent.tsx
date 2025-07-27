import {Event2, IMaterial, IObject3D, ISceneEventMap, PickingPlugin, ThreeViewer} from "threepipe";
import {
    BPTreeComponent,
    bpUiConfigIcons,
    TreeNodeInfo,
    UiConfigRendererContextType
} from 'uiconfig-blueprint/lib/esm/lib'

export class BPMaterialsTreeComponent<T extends IMaterial = IMaterial> extends BPTreeComponent<T, IObject3D> {
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
        if(obj.isPhysicalMaterial){
            node.icon = bpUiConfigIcons['shape-sphere-filled-1']({style: {color: 'transparent'}, className: 'bp5-tree-node-icon-svg'})
        }
        if(obj.isUnlitMaterial){
            node.icon = 'full-circle'
        }
        return node;
    }

    protected _getRootNodes(): T[] {
        const v = this.context.methods.getRawValue(this.props.config)
        const materials = new Set<IMaterial>()
        v?.traverse((obj) => {
            if (obj.material) {
                const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
                for (const mat of mats) {
                    if (mat && mat.isMaterial) {
                        materials.add(mat)
                    }
                }
            }
        })
        const uuidSet = new Set<string>()
        // log materials with duplicate uuid
        materials.forEach((m) => {
            if(!m.uuid || uuidSet.has(m.uuid)) {
                console.warn('Materials: Material with duplicate or missing uuid, ignoring', m)
                materials.delete(m)
            }else if(m.uuid)
                uuidSet.add(m.uuid)
        })
        return Array.from(materials) as T[] // todo as any
        // return v?.children as any || [] // todo as any
        // return this.context.viewer.materialManager.getAllMaterials() as any || [] // todo as any
        // return getValue(this.props.config)
        // return (this.props.config.children || []).map(c => getOrCall(c) || {}).flat(2)
    }

    protected async _onNodeClick(_id: string) {
        const node = this._infoMap.get(_id)
        if(!node) return
        const value = node.isSelected ? null : node.nodeData! // unselect if already selected
        node.nodeData!.dispatchEvent({type: 'select', value: value ?? null, material: node.nodeData!, ui: true, bubbleToObject: true, bubbleToParent: true})
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
        const mats = e.material ? Array.isArray(e.material) ? e.material : [e.material] : /*e.object?.materials ||*/ []
        this._selectedIds = mats?.map((m: IMaterial) => m.uuid)
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
    private materialUpdate = (e: Event2<'materialUpdate', ISceneEventMap, IObject3D>) => {
        // private materialUpdate = (e: any) => {
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
            console.error('BPMaterialsTreeComponent: viewer not found in context', this.context)
            return
        }
        viewer.getPlugin(PickingPlugin)?.addEventListener('selectedObjectChanged', this.selectedObjectChanged)
        viewer.scene.addEventListener('sceneUpdate', this.sceneUpdate) // todo: subscribe only to the material in the config instead of the whole scene
        viewer.scene.addEventListener('materialUpdate', this.materialUpdate) // todo: subscribe only to the material in the config instead of the whole scene
    }

    componentWillUnmount() {
        const viewer = this.context.viewer
        if(!viewer) {
            console.error('BPMaterialsTreeComponent Unmount: viewer not found in context', this.context)
            return
        }
        viewer.getPlugin(PickingPlugin)?.removeEventListener('selectedObjectChanged', this.selectedObjectChanged)
        viewer.scene.removeEventListener('sceneUpdate', this.sceneUpdate)
        viewer.scene.removeEventListener('materialUpdate', this.materialUpdate)
        super.componentWillUnmount();
    }

}
