import {IObject3D, PickingPlugin, ThreeViewer} from "threepipe";
import {TreeNodeInfo} from "@blueprintjs/core";
import {BPTreeComponent, UiConfigRendererContextType} from 'uiconfig-blueprint/lib/esm/lib'
import { VisibilityIcon } from "./VisibilityIcon";

export class BPHierarchyComponent<T extends IObject3D = IObject3D> extends BPTreeComponent<T, IObject3D> {
    declare context: UiConfigRendererContextType&{viewer: ThreeViewer}

    protected _createNodeInfo(id: string, obj: T) {
        return Object.assign(super._createNodeInfo(id, obj), {
            secondaryLabel: (<VisibilityIcon obj={obj}/>),
        })
    }

    protected _getNodeId(obj: T) {
        return obj.uuid;
    }

    protected _updateNodeInfo(node: TreeNodeInfo<T>, obj: T) {
        node.label = obj.name ? obj.name : obj.type ? `(${obj.type})` : 'unnamed';
        node.childNodes = ((obj.children as T[]) || []).reduce<any[]>((...args) => this.buildData(...args), [])
        return node;
    }

    protected _getRootNodes(): T[] {
        const v = this.context.methods.getValue(this.props.config)
        return v?.children as any || [] // todo as any
        // return getValue(this.props.config)
        // return (this.props.config.children || []).map(c => getOrCall(c) || {}).flat(2)
    }

    protected async _onNodeClick(_id: string) {
        const node = this._infoMap.get(_id)
        if(!node) return
        const value = node.isSelected ? null : node.nodeData! // unselect if already selected
        node.nodeData!.dispatchEvent({type: 'select', value, ui: true})
    }

    protected async _onNodeDoubleClick(_id: string) {
        const node = this._infoMap.get(_id)
        if(!node) return
        node.nodeData!.dispatchEvent({
            type: 'select',
            value: node.nodeData!,
            ui: true,
            focusCamera: true
        })
    }

    private selectedObjectChanged = (e: any) => {
        this.setSelected(e.object?.uuid)
    }
    private sceneUpdate = (e: any) => {
        if (e.hierarchyChanged) {
            this.props.config.uiRefresh?.()
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
    }

    componentWillUnmount() {
        const viewer = this.context.viewer
        if(!viewer) {
            console.error('BPHierarchyComponent Unmount: viewer not found in context', this.context)
            return
        }
        viewer.getPlugin(PickingPlugin)?.removeEventListener('selectedObjectChanged', this.selectedObjectChanged)
        viewer.scene.removeEventListener('sceneUpdate', this.sceneUpdate)
        super.componentWillUnmount();
    }

}
