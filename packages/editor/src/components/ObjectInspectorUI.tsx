// @ts-nocheck -- reference inspector supports legacy asset metadata carried at runtime.
import {
    EntityComponentPlugin, generateUUID,
    IMaterial, ImportResult,
    IObject3D, ITexture,
    Object3DComponent,
    PickingPlugin,
    RootScene, TObject3DComponent,
    UiObjectConfig, UndoManagerPlugin
} from "threepipe";
import {PanelActions} from "@blueprintjs/core/lib/esnext/components/panel-stack2/panelTypes";
import {useManager} from "../utils/UseManager.ts";
import {useProject} from "../utils/UseProject.ts";
import React, {FC, useEffect, useMemo, useState} from "react";
import {isExternalObject, isPackageProject, SelectFileRef} from "../utils/projectUtils.ts";
import {ContextMenuItemsProps, useContextMenu} from "./ContextMenuProvider.tsx";
import {Button, Divider, Icon, MenuDivider, MenuItem} from "@blueprintjs/core";
import {AppToaster, ConfigObject, FolderHeadCard, useLoadingState} from "uiconfig-blueprint/lib/esm/lib";
import {iconForSelectionObject} from "../utils/icons.tsx";
import {isGeomEditable, isMatEditable} from "../utils/three/assetEditorChecks.ts";
import {RefSelectionObjectComponent} from "./RefSelectionObjectComponent.tsx";
import {showSuccessErrorToast} from "../utils/Toaster.tsx";
import {assetUrlPrefix, LoadedProject, SavedSceneFile, settingsKey} from "../utils/project.ts";
import {
    InspectorPanelProps,
} from "./InspectorPanelComponent.tsx";
import {ButtonWithTooltip} from "./ButtonWithTooltip.tsx";
import {UnkObjComponent} from "./UnkObjComponent.tsx";
import {SelectedInspectorItem} from "../utils/AssetsProvider.ts";
import {addProjectScript} from "./AddProjectScript.tsx";
import {refreshProjectQueryState} from "../utils/refreshProjectQueryState.ts";
import {ViewerInstanceManager} from "../utils/ViewerInstanceManager.ts";

function filterTopLevelPropUiConfig(obj: IObject3D|IMaterial, sProps: string[], disabledProps: string[]) {
    const config = useMemo(() => {
        if (!obj.uiConfig?.children) return null
        const children: UiObjectConfig[] = obj.uiConfig.children.filter(c => {
            if (typeof c !== 'object') return
            const prop = Array.isArray(c.property) ? c.property : null
            return prop && prop[0] === obj && (sProps.includes(prop[1] as string) ||
                (disabledProps.includes(prop[1] as string) && (c.readOnly === true || c.disabled === true)) // todo use uiconfig methods or getOrCall to check for readonly or disabled?
            )
        }) || []
        return {
            ...obj.uiConfig,
            children,
        }
    }, [obj.uiConfig])
    return config;
}

// for root asset object instances - i.e objects that are clone of object assets. only sProperties are editable (right now fixed to name, visible and transform)
function AssetObjRootInstanceIns({obj, ...props}: {obj: IObject3D} & PanelActions & InspectorPanelProps){
    // todo only show editable properties  (that are in userData.sProperties and ways to add and remove them and deep prop access

    const sProps = [...obj.userData.sProperties||[]]
    if(sProps.includes('quaternion') && !sProps.includes('rotation'))
        sProps.push('rotation')
    const extraProps = ['uuid']

    const config = filterTopLevelPropUiConfig(obj, sProps, extraProps);
    if(!config) return null

    return <ConfigObject {...props} config={config} icon={iconForSelectionObject(obj)}/>
}

// for material instances - materials that are cloned from an asset. only overridden properties are editable
export function MaterialInstanceIns({obj, ...props}: {obj: IMaterial} & PanelActions & InspectorPanelProps){
    // todo only show editable properties  (that are in userData.sProperties and ways to add and remove them and deep prop access

    const sProps = [...obj.userData.sProperties||[]]
    const extraProps = ['uuid']
    const config = filterTopLevelPropUiConfig(obj, sProps, extraProps);

    if(!config) return null

    return <ConfigObject {...props} config={config} icon={iconForSelectionObject(obj)}/>
}

export function ObjectInspectorUI({
  object,
  isAssetInstance,
  assetRootPath,
  assetRootPathCanEdit,
  ...props
}: {
    object: IObject3D,
    isAssetInstance: boolean,
    assetRootPath: string | null,
    assetRootPathCanEdit: boolean,
} & PanelActions) {

    const manager = useManager()
    const {project} = useProject()

    // for reacting to changes in object, because we are accessing object.material etc
    const [objectChangeId, setObjectChangeId] = useState(0)
    useEffect(() => {
        if (!object) return
        const l = () => {
            setObjectChangeId(id => id + 1)
            // console.log('object changed, updating inspector', object)
        }
        object.addEventListener('objectUpdate', l)
        object.addEventListener('materialChanged', l)
        return () => {
            object.removeEventListener('objectUpdate', l)
            object.removeEventListener('materialChanged', l)
        }
    }, [object])

    const objectMaterials = object && object.material ? (Array.isArray(object.material) ? object.material : [object.material]) : []
    const objectGeometry = object?.geometry?.isBufferGeometry ? object.geometry : null

    const objectIsExternal = object ? isExternalObject(object) : false
    // console.log({objectIsExternal}, object)

    // console.log(isAssetInstance, objectIsExternal)

    if (object?.uiConfig) {
        object.uiConfig.expanded = true
    }
    const contextMenu = useContextMenu()

    const isRootScene = (object as RootScene).isRootScene as boolean

    return <>
        {!!object && <>
            {/*<div>Object</div>*/}
            <Divider style={{margin: 0}}/>
            {
                // object.userData.tpAssetId ? <UnkObjComponent label={`Asset: ${object.name || 'Unnamed'}`} disabled={true} obj={object}/> :
                objectIsExternal ?
                    <UnkObjComponent key={'object'} label={`Object: ${object.name || 'Unnamed'}`} disabled={true}
                                     obj={object}/> :
                    object.uiConfig ?
                        isAssetInstance ? <AssetObjRootInstanceIns key={'objectins'} {...props} obj={object}/> :
                            <ConfigObject key={'objectc'} {...props}
                                          config={object.uiConfig}
                                          filter={isRootScene ? (c) => {
                                              return c.type !== 'folder'// todo temp, remove this line and use propertyKey check after uiconfig.js update
                                              return c?.propertyKey !== 'defaultCamera'
                                          } : undefined}
                                          icon={iconForSelectionObject(object)}/> :
                        null}
            {/*{!!objectSelUiConfig?.length && objectSelUiConfig.map((c, i)=><ConfigObject key={i} {...props} config={c}/>)}*/}
            <Divider style={{margin: 0}}/>

            {/*todo show object children to select them easily*/}

            {!!objectGeometry && <>
                {/*<div>Geometry</div>*/}
                {!!objectGeometry.uiConfig && !objectIsExternal && isGeomEditable(objectGeometry, manager) ?
                    <ConfigObject key={'geometryc'} {...props} config={objectGeometry.uiConfig}
                                  icon={iconForSelectionObject(objectGeometry)}/> :
                    <UnkObjComponent key={'geometry'} label={`Asset: ${objectGeometry.name || 'Unnamed'}`}
                                     disabled={true} obj={objectGeometry}/>
                }

                <Divider style={{margin: 0}}/>
            </>}

            {/*Components*/}
            <CompsSectionComp object={object} openPanel={props.openPanel} closePanel={props.closePanel}/>

            {/*{!!objectMatManageUiConfig?.length && objectMatManageUiConfig.map((c, i)=><ConfigObject key={i} {...props} config={c}/>)}*/}
            <Divider style={{margin: 0}}/>

            {objectMaterials.map((material, materialI) => //material && (material.userData.tpAssetId || material._tpAssetId) ? null :
                // todo send a filter into RefSelectionObjectComponent so that user cannot select any material outside the asset
                <RefSelectionObjectComponent
                    key={'objmats' + materialI}
                    objectType={"material"}
                    disabled={objectIsExternal}
                    allowNone={true} object={material}
                    onChange={async (_selected, _e) => {
                        //todo loading while await
                        showSuccessErrorToast('', '', await changeMaterialForObject(manager, object, material, _selected, project))
                    }}
                >
                    {!!material.userData.isPlaceholder ?
                        <ButtonWithTooltip tooltip={'New Material'} text={""} icon={"plus"} onClick={(e) => {
                            contextMenu.handleContextMenu({
                                event: e,
                                obj: object,
                                Items: (p) => (<NewMaterialContextMenu {...p} onClick={async (newm) => {
                                    //todo loading while await
                                    showSuccessErrorToast('', '', await changeMaterialForObject(manager, object, material, newm, project))
                                }}/>),
                                actions: {},
                            })
                        }}/> :
                        <ButtonWithTooltip tooltip={'Remove Material'} text={""} icon={"cross"} onClick={async () => {
                            //todo loading while await
                            showSuccessErrorToast('', '', await changeMaterialForObject(manager, object, material, null, project))
                        }}/>
                    }
                </RefSelectionObjectComponent>
            )}

            {objectMaterials.map((material, i) =>
                material?.uiConfig &&  // material has a UI
                !objectIsExternal &&  // object is not external (i.e we can edit the current object and it will be saved)
                isMatEditable(material, manager) && // material is not an asset or placeholder itselft
                (!material._tpRootPath || // not part of an asset, or part of the asset we are editing in inspector
                    (assetRootPathCanEdit && (material._tpRootPath === assetUrlPrefix + assetRootPath))
                ) ? (<ConfigObject key={'mats' + material.uuid + i} {...props} config={material.uiConfig}
                                   icon={iconForSelectionObject(material)}/>) :
                    material.userData.isPlaceholder ? null : <UnkObjComponent key={'matsunk' + material.uuid + i}
                                                                              label={`Material: ${material.name || 'Unnamed'}`}
                                                                              disabled={true} obj={material}/>
            )}

            {/*{!!objectMatManageUiConfig?.length && objectMatManageUiConfig.map((c, i)=><ConfigObject key={i} {...props} config={c}/>)}*/}
            <Divider style={{margin: 0}}/>

        </>}
    </>
}

export const NewMaterialContextMenu: FC<ContextMenuItemsProps<IObject3D>&{
    onClick?: (mat: IMaterial)=>void
}> = (props)=>{
    const manager = useManager()
    const picking = manager.get().getPlugin(PickingPlugin)
    const obj = props.object
    const types = picking?.materialTypes.map(matType=>({
        label: `New ${matType.name} Material`,
        type: 'button',
        hidden: matType.line ?
            // ()=>(!obj.isLineSegments2 && !obj.isLine && !obj.isLineSegments) || !(!obj.materials?.length || obj.materials.length === 1 && obj.materials[0].userData?.isPlaceholder) :
            !obj.isLineSegments2 && !obj.isLine && !obj.isLineSegments && !obj.isWireframe || !(!obj.materials?.length || obj.materials.length === 1 && obj.materials[0] === matType.def) :
            !(!obj.materials?.length || obj.materials.length === 1 && obj.materials[0].userData?.isPlaceholder) || !obj.isMesh,
        value: ()=>{
            return new matType.cls() as any
        },
    })) || []
    return <>
        <MenuDivider title="Create a Material" className={"context-menu-divider"} />
        {types.map((t, i)=>!t.hidden && <MenuItem key={i} text={t.label} onClick={()=>{
            const mat = t.value() as IMaterial
            props.onClick?.(mat)
        }}/>)}
    </>

}

export function CompsSectionComp({object, ...panelProps}: {object: IObject3D} & PanelActions){
    const manager = useManager()

    const ecs = manager.get().getPlugin(EntityComponentPlugin)
    const [comps, setComps] = useState<Object3DComponent[]>([...EntityComponentPlugin.ObjectToComponents.get(object) || []])

    // for reacting to changes in object, because we are accessing object.material etc
    // const [objectChangeId, setObjectChangeId] = useState(0)
    // useEffect(()=>{
    //     if(!object) return
    //     const l = (e: any)=>{
    //         if(!e.refreshUi) return
    //         setObjectChangeId(id=>id+1)
    //     }
    //     object.addEventListener('objectUpdate', l)
    //     return ()=>{
    //         object.removeEventListener('objectUpdate', l)
    //     }
    // }, [object])

    useEffect(()=>{
        if(!ecs) return
        const l = (ev: {object: IObject3D})=>{
            if(ev.object !== object) return
            setComps([...EntityComponentPlugin.ObjectToComponents.get(object) || []])
        }
        setComps([...EntityComponentPlugin.ObjectToComponents.get(object) || []])
        ecs.addEventListener('registerComponent', l)
        ecs.addEventListener('unregisterComponent', l)
        return ()=>{
            if(!ecs) return
            ecs.removeEventListener('registerComponent', l)
            ecs.removeEventListener('unregisterComponent', l)
        }
    }, [ecs, object])

    // const viewer = manager.get()
    // const picking = viewer?.getPlugin(PickingPlugin)
    // const availablePlugins = picking?.availablePlugins() || []
    const {loadingState, updateLoading} = useLoadingState()

    const {project} = useProject()
    // const removeProjectComp = async (p: ExternalComp)=>{
    //     if(!project) return false
    //     // todo confirm dialog
    //     const res = await manager.removeProjectComp(p).then(()=>({error: null})).catch(e=>{
    //         return {error: e?.message ?? 'Unknown error'}
    //     })
    //     const r = showSuccessErrorToast(res ? `Removed ${project.path}${p.import} successfully` : 'Unknown Error', 'Unable to remove plugin', res)
    //     return r
    // }

    // const extComps = useListenProperty(manager.scriptUtil, 'extComps', 'extCompsChange', (v)=>([...v||[]]))

    return <FolderHeadCard open={true} label={"Components"} minimal={true} level={0} onClick={()=>{}} icon={"stacked-chart"}>
        {/*todo listen to extComps change*/}
        {comps.map(comp=>{
            if(!comp.uiConfig) return null
            return [
                <ConfigObject key={comp.uuid} config={comp.uiConfig} icon={"package"} {...panelProps}/>,
                <Divider key={comp.uuid+'div'} style={{margin: 0}}/>
            ]
        }).flat()}

        <AddCompComp object={object} {...panelProps}/>
    </FolderHeadCard>

}

export function AddCompComp({object, ...panelProps}: {object: IObject3D} & PanelActions){
    const [selectedScript, setSelectedScript] = useState<SelectFileRef|SelectedInspectorItem|null>(null)
    const manager = useManager()
    const {loadingState, updateLoading} = useLoadingState()
    const ecs = manager.get().getPlugin(EntityComponentPlugin)
    const [compTypes, setCompTypes] = useState<TObject3DComponent[]>([...ecs?.componentTypes.values()||[]])

    useEffect(()=>{
        if(!ecs) return
        const l = ()=>{
            setCompTypes([...ecs.componentTypes.values() || []])
        }
        ecs.addEventListener('addComponentType', l)
        ecs.addEventListener('removeComponentType', l)
        return ()=>{
            if(!ecs) return
            ecs.removeEventListener('addComponentType', l)
            ecs.removeEventListener('removeComponentType', l)
        }
    }, [ecs])

    const addComp = (c: TObject3DComponent)=>{
        const type = c.ComponentType
        if(!ecs) return
        const undoMan = manager.get().getPlugin(UndoManagerPlugin)
        if(!undoMan) {
            console.error('Undo manager not found')
            return
        }
        undoMan.performAction(ecs, ecs.addComponent, [object, type], 'addComponent')
    }
    const addComponent = async ()=>{
        const c = (selectedScript as any)?.ocomponent as TObject3DComponent
        if(c) {
            addComp(c)
        }else {
            const path = (selectedScript as SelectFileRef)?.entry.path
            if (!path) return
            const comps = await addProjectScript(path, manager)
            if (!comps) return
            if (!ecs) return
            if(!comps.length) {
                AppToaster().show({
                    message: `No components found in script`,
                    intent: 'warning',
                    icon: 'warning-sign',
                    timeout: 2000,
                    isCloseButtonShown: true,
                });
                return
            }
            if(comps.length > 1) {
                AppToaster().show({
                    message: `Multiple components found in script, adding first one: ${comps[0].exp.ComponentType}`,
                    intent: 'warning',
                    icon: 'warning-sign',
                    timeout: 4000,
                    isCloseButtonShown: true,
                });
            }
            addComp(comps[0].exp)
        }
    }
    return <RefSelectionObjectComponent
        label={"Add Comp"}
        objectType={"script"}
        object={selectedScript}
        disabled={false}
        extraItems={compTypes.map(c=>({name: c.ComponentType, uuid: c.ComponentType, ocomponent: c}))}
        allowNone={true} onChange={(v)=>{
        setSelectedScript(v)
    }}>
        <Button variant={"minimal"} title={"Add Component"} icon={<Icon size={12} icon={"plus"}/>}
                disabled={!selectedScript}
                loading={loadingState['addComp']}
            // onClick={() => updateLoading(onChange({value: null}))}
                onClick={()=>updateLoading('addComp', addComponent())}
        ></Button>
    </RefSelectionObjectComponent>
}

export async function changeMaterialForObject(manager: ViewerInstanceManager, object: IObject3D, material: IMaterial, _selected: SelectedInspectorItem|SelectFileRef|null, project?: LoadedProject|null){
    const isSingle = !Array.isArray(object.material)
    const materialI = isSingle ? -1 : Array.isArray(object.material) ? object.material.indexOf(material) : -1
    const isMultiple = !isSingle && materialI >= 0
    if(!isSingle && !isMultiple){
        console.warn('Material changed but material not found on object?', {material, object, materialI})
        return {
            error: 'Unknown Error changing material on object.'
        }
    }
    let selected = null
    // todo set material
    if(!_selected){
        const picking = manager.get().getPlugin(PickingPlugin)!
        // set null
        if(isMultiple){
            // remove this material
            const mats = [...(object.material as IMaterial[])]
            mats.splice(materialI, 1)
            if(mats.length === 0) {
                selected = picking.getPlaceholderMaterial(object)
            }
            else selected = mats
        }else {
            selected = picking.getPlaceholderMaterial(object)
        }
    }
    else if((_selected as IMaterial).isMaterial){
        // set material directly?
        selected = _selected as IMaterial
    }
    else if((_selected as SelectFileRef).entry?.isFSEntry){
        if(!project){
            // console.error('No project loaded, cannot import material from file', _selected)
            return {
                error: 'No project loaded, cannot import material from file.'
            }
        }
        // load and set material
        const clone = await manager.loadAssetMaterialClone((_selected as SelectFileRef).entry, project)
        if(!clone) return {
            error: 'Failed to load material from file.'
        }
        // not that not setting _tpAssetId to the asset here
        selected = clone
    }

    if(selected){
        // if(object._tpRootPath) selected._tpRootPath = object._tpRootPath // not really required here

        // if(object._tpAssetId) selected._tpAssetId = object._tpAssetId
        const action = ()=>{
            let mats = object.material
            if(isSingle || Array.isArray(selected)){
                mats = selected
            } else if(isMultiple && Array.isArray(mats)){
                mats = [...mats]
                mats[materialI] = selected
            }
            object.material = mats
        }


        const undoMan = manager.get().getPlugin(UndoManagerPlugin)
        if(!undoMan){
            console.error('UndoManagerPlugin not found.')
            action()
        }
        else{
            undoMan.performAction(undefined, ()=>{
                let current = object.material
                action()
                return ()=>{
                    object.material = current
                }
            }, [], 'Change Material on Object',)
        }
    }
}
