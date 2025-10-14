import {PanelActions} from "@blueprintjs/core/lib/esnext/components/panel-stack2/panelTypes";
import {getFileByPath, SelectedInspectorItem, useAssets} from "../utils/AssetsProvider.ts";
import {
    EntityComponentPlugin,
    generateUUID,
    getOrCall,
    IGeometry,
    IMaterial,
    IObject3D,
    ITexture,
    Object3DComponent,
    PickingPlugin,
    TObject3DComponent,
    UiObjectConfig,
    UndoManagerPlugin
} from "threepipe";
import {
    isExternalGeometry,
    isExternalMaterial,
    isExternalObject,
    isExternalTexture,
    isGeomEditable,
    isMatEditable,
    isTexEditable,
    SelectFileRef,
    useManager,
    useProject,
    ViewerInstanceManager,
} from "../utils/ViewerInstanceManager.ts";
import {AppToaster, ConfigObject, FolderHeadCard, useLoadingState} from "uiconfig-blueprint/lib/esm/lib";
import {Button, ButtonGroup, ButtonProps, Divider, Icon, Intent, Tooltip} from "@blueprintjs/core";
import {iconForSelectionObject, RefSelectionObjectComponent} from "./RefSelectionObjectComponent.tsx";
import type {IconName} from "@blueprintjs/icons";
import {MaybeElement} from "@blueprintjs/core/src/common/props.ts";
import {ReactElement, useCallback, useEffect, useMemo, useState} from "react";
import {refreshTexturePreview, TexturePreview} from "./BPTextureFileComponent.tsx";
import {showSuccessErrorToast} from "../utils/Toaster.tsx";
import {assetUrlPrefix, ExternalPlugin, ExternalScript} from "../utils/project.ts";
import {useListenProperty} from "./UseListenProperty.tsx";
import {useAsyncMemo} from "./UseAsyncMemo.tsx";

function UnkObjComponent({obj, ...props}: {obj: any,
    onClick?: (event: React.MouseEvent) => void,
    open?: boolean,
    label?: string,
    minimal?: boolean,
    level?: number,
    disabled?: boolean,
    icon?: IconName | MaybeElement
}){
    return <Button
        className={"folder-trigger-button folder-trigger-text " + (props.open ? "folder-trigger-button-expanded" : "")}
        // fill={!props.minimal}
        fill={true}
        onClick={props.onClick}
        variant={"minimal"}
        disabled={props.disabled}
        size={props.minimal ? 'small':"medium"}
        style={props.level ? {marginLeft: "6px"} : {fontSize: "0.95rem", paddingTop: "8px", paddingBottom: "8px"}}
        // intent={props.open ? Intent.PRIMARY : Intent.NONE}
        intent={Intent.NONE}
        // icon={props.enabled !== undefined  && <span style={{minWidth: '20px'}}></span>} // adding a span here will center the text in the button
        icon={props.icon ?? iconForSelectionObject(obj) ?? (
            <Icon icon="caret-right" style={{
                rotate: props.open ? "90deg" : "0deg",
                transition: "rotate 0.25s ease-in-out"
            }}/>
        )}
    >{(props.label ?? obj?.name) || "Unnamed Object"}
    </Button>
}

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

// for material instances - materials that are cloned from an asset. only overridden properties are editable
function MaterialInstanceIns({obj, ...props}: {obj: IMaterial} & PanelActions & InspectorPanelProps){
    // todo only show editable properties  (that are in userData.sProperties and ways to add and remove them and deep prop access

    const sProps = [...obj.userData.sProperties||[]]
    const extraProps = ['uuid']
    const config = filterTopLevelPropUiConfig(obj, sProps, extraProps);

    if(!config) return null

    return <ConfigObject {...props} config={config} icon={iconForSelectionObject(obj)}/>
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


export type InspectorPanelProps = {}

export function InsSectionTitle({title, icon}: { title: string, icon?: IconName | MaybeElement }) {
    return <div className={"xPaddedContent folderContent folder-trigger-text"}
                style={{
                    marginLeft: 0,
                    color: "var(--pt-text-color)",
                    flex: "1 1 auto",
                    width: "100%",
                    textAlign: "left",
                    alignContent: "center",
                    gap: "var(--pt-grid-size)",
                    display: "flex",
                    alignItems: "center",

                }}
    >
        {icon && (typeof icon === 'string' ? <Icon icon={icon} style={{}} size={12}/> : icon)}

        {title}
    </div>;
}

export function InspectorPanelComponent({...props}: PanelActions & InspectorPanelProps){
    // useEffect(()=>{
    //     console.log('mount inspector')
    //     return ()=>{
    //         console.log('unmount inspector')
    //     }
    // }, [])

    const {selectedInspectorItems, selectedFiles, fileManifest} = useAssets()
    // console.log({selectedInspectorItems})
    let selObject = selectedInspectorItems.length === 1 ? selectedInspectorItems[0] : null
    const selFile = !selObject && selectedFiles.length === 1 ? selectedFiles[0] : null
    const manager = useManager()
    const viewer = manager.get()
    const picking = manager.get()?.getPlugin(PickingPlugin)
    // const picking = viewer?.getPlugin(PickingPlugin)
    // const objectSelUiConfig = useMemo<UiObjectConfig[]|undefined>(()=>object ? picking?.objectSelectionUiConfig(object) : undefined, [object])
    // const objectMatManageUiConfig = useMemo<UiObjectConfig[]|undefined>(()=>object ? picking?.objectMaterialManageUiConfig(object) : undefined, [object])
    const {project} = useProject()

    const selectedFileLoaded = useAsyncMemo(async ()=>project && selFile ? manager.loadAsset(selFile, project) : null, [manager, selFile, project])

    // useEffect(()=>{
    //     if(!selObject && selectedFileLoaded && picking && !picking.getSelectedObject() && (selectedFileLoaded.isObject3D || selectedFileLoaded.isMaterial || selectedFileLoaded.isTexture || selectedFileLoaded.isBufferGeometry)){
    //         picking.setSelectedObject(selectedFileLoaded as any)
    //     }
    // }, [selObject, selectedFileLoaded, picking])

    const loadedAssetMain = manager.loadedAssetObj
    // let selObjectPath: string | null = null
    if(loadedAssetMain && !(loadedAssetMain as IObject3D).isObject3D){
        selObject = loadedAssetMain as any
        // selObjectPath = manager.loadedProjectFile?.path || null
    }

    let object = (selObject as IObject3D)?.isObject3D ? selObject as IObject3D : null

    // if(object?.userData.tpAssetId) object = null
    // else if(object?._tpAssetId) object = null
    const material = (selObject as IMaterial)?.isMaterial ? selObject as IMaterial : null//object?.material
    // const materials = material_s ? (Array.isArray(material_s) ? material_s : [material_s]) : []
    let geometry = (selObject as IGeometry)?.isBufferGeometry ? selObject as IGeometry : null//object?.geometry
    let texture = (selObject as ITexture)?.isTexture ? selObject as ITexture : null

    // const isAsset = !!selObject?.userData?.rootPath?.startsWith(assetUrlPrefix)
    // const isLoadedAsset = isAsset && selObject === loadedObject // its an .glb or .mat file with asset id set
    // const canConvertToAsset = selObject === loadedObject && !isAsset && selFile?.path.endsWith('.glb')
    // const isLoadedAssetMain = isAsset && selObject === loadedAssetMain // main loaded scene/asset

    // const isAssetChild = object?._tpAssetId && !isAsset // child of an asset
    // const isLoadedAssetChild = isAssetChild && object?._tpAssetId === manager.loadedAssetId

    const {loadingState, updateLoading} = useLoadingState()

    // console.log(object, materials, material_s)
    // todo
    //  unselect button
    //  lock button

    const [needsSave, setNeedsSave] = useState(false)

    const isPackageJson = selFile?.path === 'package.json'
    // console.log(loadedPackageJson)


    // const texturePreview = texture ? refreshTexturePreview(texture, viewer, (p)=>{
    //     console.log('todo refresh')
    // }) : undefined
    const [texturePreview, setTexturePreview] = useState('')
    const refreshTexPreview = useCallback(()=>{
        if(!texture || !viewer) {
            setTexturePreview('')
            return
        }
        let cancelled = false
        const preview = refreshTexturePreview(texture, viewer, (p1)=>{
            if(!cancelled) setTexturePreview(p1)
        })
        setTexturePreview(preview)
        return ()=>{
            cancelled = true
        }
    }, [texture, viewer])

    useEffect(()=>{
        refreshTexPreview()
    }, [refreshTexPreview])

    // const isMatFile = isLoadedAsset && selObject && selObjectPath && (selObject as IMaterial).isMaterial
    // useEffect(()=>{
    //     if(isMatFile){
    //         const listener = ()=>{
    //             setNeedsSave(true)
    //         }
    //         const mat = selObject as IMaterial
    //         mat.addEventListener('materialUpdate', listener)
    //         return ()=>{
    //             mat.removeEventListener('materialUpdate', listener)
    //         }
    //     } else {
    //         setNeedsSave(false)
    //     }
    // }, [selObject, isMatFile])

    // todo autosave on needssave

    const inspectingScene = manager.loadedScene && !selObject && !selFile


    let assetRootPath = (selObject as IObject3D|IMaterial|ITexture|IGeometry)?._tpRootPath || null
    let assetRootUid = (selObject as IObject3D)?._tpRootUid || null // if this is set, this object is a clone of a child of an asset

    const instanceRootPath = !assetRootPath ? selObject?.userData?.rootPath : null
    const isAssetInstance = instanceRootPath && selObject?.userData?.rootPath?.startsWith(assetUrlPrefix)

    if(assetRootPath && !assetRootPath.startsWith(assetUrlPrefix)) assetRootPath = null

    const assetRootPathAsset = useAsyncMemo(async ()=>assetRootPath ? manager.getAssetFromPath(assetRootPath) : null, [manager, assetRootPath])
    const instanceRootPathAsset = useAsyncMemo(async ()=>instanceRootPath ? manager.getAssetFromPath(instanceRootPath) : null, [manager, instanceRootPath])

    if(assetRootPath) assetRootPath = assetRootPath.replace(assetUrlPrefix, '')

    const assetRootPathCanEdit = !!assetRootPathAsset && !assetRootUid && manager.loadedAssetObj !== assetRootPathAsset
    const buttons: ReactElement[] = []

    // saves selObject

    if(selObject && assetRootPathAsset && assetRootPathCanEdit) {
        const resetAsset = async ()=>{
            if(!assetRootPath || !project || !assetRootPathAsset) return
            const entry = getFileByPath(assetRootPath, fileManifest)
            if(!entry) {
                console.error('Could not find file in manifest: ' + assetRootPath, fileManifest)
                return
            }
            return await manager.loadAsset(entry, project) // this will refresh the same loaded asset
        }

        const saveAsset = async ()=>{
            if(!selObject || !project || !assetRootPathAsset || !assetRootPathCanEdit || !assetRootPath) return

            if(!assetRootPathAsset.isObject3D && !assetRootPathAsset.isMaterial){
                console.error('Asset is not an object3D or material', assetRootPathAsset, assetRootPath)
                return
            }
            const res = await manager.saveProjectAsset(project, manager.loadedProjectFile, assetRootPathAsset as IObject3D|IMaterial, assetRootPath)
            const r = showSuccessErrorToast(res ? `Saved ${project.path}${assetRootPath} successfully` : 'Unknown Error', 'Unable to save asset', res)
            if(r)
                setNeedsSave(false) // todo get needs save based on object
            return res

            // if(!isLoadedAsset || !selObject || !selObjectPath || !project) return
            // if(!isMatFile) return // todo other types
            // const res = await manager.saveProjectAsset(project, manager.loadedProjectFile, selObject as IObject3D|IMaterial, selObjectPath)
            // if(res.error){
            //     // todo apptoaster
            //     return
            // }
            // setNeedsSave(false)
            // return res
        }

        buttons.push(
            <Button key={"resetButton"} icon={<Icon icon={"reset"} size={14}/>}
                    size={"small"} variant={"minimal"}
                    title={"Reload Asset"} intent={Intent.NONE}
                    loading={loadingState['resetAsset']}
                //todo handle error/null from fn return
                    onClick={() => updateLoading('resetAsset', resetAsset())}
            />
        )
        buttons.push(
            <Button key={"saveButton"} icon={<Icon icon={"floppy-disk"} size={14}/>}
                    size={"small"} variant={"minimal"}
                    title={"Save Asset"} intent={Intent.SUCCESS}
                    loading={loadingState['saveAsset']}
                // disabled={!needsSave} // todo needssave based on whats being edited
                    onClick={() => selObject && updateLoading('saveAsset', saveAsset())}
            />
        )
    }

    // if its a child of an asset component, show edit to go to the source, and reset to reset the source asset(everything)
    if(selObject && assetRootPathAsset && assetRootUid) {
        const editAsset = async ()=>{
            if(!selObject || !project || !assetRootPathAsset || assetRootPathCanEdit || !assetRootPath) return

            if(!assetRootPathAsset.isObject3D && !assetRootPathAsset.isMaterial){
                console.error('Asset is not an object3D or material', assetRootPathAsset, assetRootPath)
                return
            }
            let obj: IObject3D | IMaterial | undefined
            if(!assetRootUid){
                obj = assetRootPathAsset as IObject3D | IMaterial
            }else {
                if(assetRootPathAsset.isObject3D) {
                    // todo traverse schildren?
                    assetRootPathAsset.traverse((s: IObject3D) => {
                        if (!obj && s.uuid === assetRootUid) {
                            obj = s
                        }
                    })
                }else {
                    console.error('Cannot edit child of non-object asset')
                }
            }
            // if(!obj) {
            //     console.error('Could not find object in asset to edit', assetRootUid, assetRootPathAsset)
            // }
            if(obj) {
                picking?.setSelectedObject(obj || null, false)
            }

            return obj
        }

        buttons.push(
            <Button key={"editButton"} icon={<Icon icon={"edit"} size={14}/>}
                    size={"small"} variant={"minimal"}
                    title={"Edit Asset"} intent={Intent.WARNING}
                    loading={loadingState['editAsset']}
                //todo handle error/null from fn return
                    onClick={() => updateLoading('editAsset', editAsset())}
            />
        )

    }


    // if its instance of an asset, show edit to go to the source asset
    if(selObject && isAssetInstance && instanceRootPath) {
        const editAssetFromInstance = async ()=>{
            if(!selObject || !project || !instanceRootPathAsset) return
            if(!instanceRootPathAsset.isObject3D && !instanceRootPathAsset.isMaterial){
                console.error('Asset is not an object3D or material', instanceRootPathAsset, instanceRootPath)
                return
            }
            let obj: IObject3D | IMaterial | undefined
            obj = instanceRootPathAsset as IObject3D | IMaterial
            if(obj) {
                const picking = manager.get()?.getPlugin(PickingPlugin)
                picking?.setSelectedObject(obj || null, false)
            }
            return obj
        }

        buttons.push(
            <Button key={"editButton"} icon={<Icon icon={"edit"} size={14}/>}
                    size={"small"} variant={"minimal"}
                    title={"Edit Asset"} intent={Intent.WARNING}
                    loading={loadingState['editAsset']}
                    //todo handle error/null from fn return
                    onClick={() => updateLoading('editAsset', editAssetFromInstance())}
            />
        )

    }

    let title = ''
    let icon: IconName|MaybeElement = 'cog'
    if(selFile?.path) {
        title = selFile.path
        icon = 'document'
    }
    else if(inspectingScene) title = 'Global Settings'
    else if(assetRootPathAsset && assetRootPath) {
        const editing = assetRootPathCanEdit ? 'Editing: ' : ''
        title = editing + assetRootPath + (selObject !== assetRootPathAsset ? ' ⮕ ' + selObject!.name : '')
        icon = iconForSelectionObject(assetRootPathAsset)
    }else if(isAssetInstance){
        title = 'Instance: ' + instanceRootPath.replace(assetUrlPrefix, '')
        icon = iconForSelectionObject(selObject)
    }else if(instanceRootPath){
        title = 'Instance: ' + instanceRootPath
        icon = iconForSelectionObject(selObject)
    }

    // todo if isAssetInstance only allow editing sproperties

    // console.log(selFile, object, selectedInspectorItems)

    // useEffect(()=>{
    //     console.log('mount inspector')
    //     return ()=>{
    //         console.log('unmount inspector')
    //     }
    // }, [])

    // for reacting to changes in object, because we are accessing object.material etc
    const [objectChangeId, setObjectChangeId] = useState(0)
    useEffect(()=>{
        if(!object) return
        const l = ()=>{
            setObjectChangeId(id=>id+1)
        }
        object.addEventListener('objectUpdate', l)
        object.addEventListener('materialChanged', l)
        return ()=>{
            object.removeEventListener('objectUpdate', l)
            object.removeEventListener('materialChanged', l)
        }
    }, [object])

    const objectMaterials = object && object.material ? (Array.isArray(object.material) ? object.material : [object.material]) : []
    const objectGeometry = object?.geometry?.isBufferGeometry ? object.geometry : null

    const objectIsExternal = object ? isExternalObject(object) : false
    // console.log({objectIsExternal}, object)

    // console.log({material, assetRootPath, assetRootPathAsset, assetRootPathCanEdit})
    // console.log({selObject}, isLoadedAsset, isLoadedAssetMain, object)
    return !selectedInspectorItems ? null : <div style={{
        listStyleType: "none",
        paddingLeft: "0", margin: "0",
        paddingBottom: "500px",
        overflowAnchor: "none",
    }}>
        {/*{v && (<ConfigObject {...props}/>)}*/}
        {/*{!selectedFiles.length ? null : <>*/}
        {/*    <div>Files</div>*/}
        {/*    <div>{selectedFiles.map(item=>{*/}
        {/*        return <div key={item.path}>{item.name}</div>*/}
        {/*    })}</div>*/}
        {/*</>}*/}
        <ButtonGroup style={{
            position: "absolute",
            top: "0",
            right: "0",
            zIndex: 1,
            height: "30px",
            padding: "3px",
            width: "100%",
        }}>
                {/*<div>File</div>*/}
            <InsSectionTitle title={title||'Selection'} icon={icon} />
                {/*{selFile.uiConfig && (<ConfigObject {...props} config={selFile.uiConfig}/>)}*/}
            {...buttons}
        </ButtonGroup>
        {/*{!!selObject?.uiConfig && (isLoadedAssetMain) && !object && <>*/}
        {/*    /!*<div>Selected</div>*!/*/}
        {/*    /!*<div>Name - {selObject.name}</div>*!/*/}
        {/*    {selObject.uiConfig && (<ConfigObject key={'selObject'} {...props} config={selObject.uiConfig} icon={iconForSelectionObject(selObject)}/>)}*/}
        {/*</>}*/}
        {!!object && <>
            {/*<div>Object</div>*/}
            {
                // object.userData.tpAssetId ? <UnkObjComponent label={`Asset: ${object.name || 'Unnamed'}`} disabled={true} obj={object}/> :
                objectIsExternal ? <UnkObjComponent key={'object'} label={`Object: ${object.name || 'Unnamed'}`} disabled={true} obj={object}/> :
                    object.uiConfig ?
                        isAssetInstance ? <AssetObjRootInstanceIns key={'objectins'} {...props} obj={object}/> :
                        <ConfigObject key={'objectc'}  {...props} config={object.uiConfig} icon={iconForSelectionObject(object)}/> :
                        null}
            {/*{!!objectSelUiConfig?.length && objectSelUiConfig.map((c, i)=><ConfigObject key={i} {...props} config={c}/>)}*/}
            <Divider style={{margin: 0}}/>

            {/*todo show object children to select them easily*/}

            {!!objectGeometry && <>
                {/*<div>Geometry</div>*/}
                {!!objectGeometry.uiConfig && !objectIsExternal && isGeomEditable(objectGeometry, manager) ?
                    <ConfigObject key={'geometryc'} {...props} config={objectGeometry.uiConfig} icon={iconForSelectionObject(objectGeometry)}/> :
                    <UnkObjComponent key={'geometry'} label={`Asset: ${objectGeometry.name || 'Unnamed'}`} disabled={true} obj={objectGeometry}/>
                }

                <Divider style={{margin: 0}}/>
            </>}

            {objectMaterials.map((material, materialI)=> //material && (material.userData.tpAssetId || material._tpAssetId) ? null :
            // todo send a filter into RefSelectionObjectComponent so that user cannot select any material outside the asset
                <RefSelectionObjectComponent
                    key={'objmats'+materialI}
                    objectType={"material"}
                    disabled={objectIsExternal}
                    allowNone={false} object={material}
                    onChange={(_selected, _e) => {
                        //todo handle error/null from fn return
                        manager.changeMaterialForObject(object, material, _selected, project)
                    }}/>
            )}

            {objectMaterials.map((material,i)=>
                material?.uiConfig &&  // material has a UI
                !objectIsExternal &&  // object is not external (i.e we can edit the current object and it will be saved)
                isMatEditable(material, manager) && // material is not an asset or placeholder itselft
                (!material._tpRootPath || // not part of an asset, or part of the asset we are editing in inspector
                    (assetRootPathCanEdit && (material._tpRootPath === assetUrlPrefix + assetRootPath))
                ) ? (<ConfigObject key={'mats' + material.uuid + i} {...props} config={material.uiConfig}
                                   icon={iconForSelectionObject(material)}/>) :
                    <UnkObjComponent key={'matsunk' + material.uuid + i}
                                     label={`Material: ${material.name || 'Unnamed'}`} disabled={true} obj={material}/>
            )}

            {/*Components*/}
            <CompsSectionComp object={object} openPanel={props.openPanel} closePanel={props.closePanel}/>

            {/*{!!objectMatManageUiConfig?.length && objectMatManageUiConfig.map((c, i)=><ConfigObject key={i} {...props} config={c}/>)}*/}
            <Divider style={{margin: 0}}/>

        </>}
        {!!geometry && <>
            {/*<div>Geometry</div>*/}
            {!!geometry.uiConfig && isGeomEditable(geometry, manager) && (assetRootPathCanEdit || !isExternalGeometry(geometry) )?
                <ConfigObject key={'geometryc'} {...props} config={geometry.uiConfig} icon={iconForSelectionObject(geometry)}/> :
                    <UnkObjComponent key={'geometry'} label={`Geometry: ${geometry.name || 'Unnamed'}`} disabled={true} obj={geometry}/>
            }
            <Divider style={{margin: 0}}/>
        </>}
        {!!material && <>
            {/*<div>*/}
            {/*    <div>Materials</div>*/}
            {/*</div>*/}
            {/*{materials.map((material,i)=>*/}
            {material.uiConfig && (assetRootPathCanEdit || !isExternalMaterial(material)) ?
                isAssetInstance ? <MaterialInstanceIns key={'matsin'+material.uuid} {...props} obj={material}/> :
                <ConfigObject key={'mats'+material.uuid} {...props} config={material.uiConfig} icon={iconForSelectionObject(material)}/> :
                <UnkObjComponent key={'matsunk'+material.uuid} label={`Material: ${material.name || 'Unnamed'}`} disabled={true} obj={material}/>}
            {/*)}*/}
            {/*{!!objectMatManageUiConfig?.length && objectMatManageUiConfig.map((c, i)=><ConfigObject key={i} {...props} config={c}/>)}*/}
            <Divider style={{margin: 0}}/>
        </>}
        {!!texture && <>
            {/*<div>Texture</div>*/}
            {texturePreview && <TexturePreview
                preview={texturePreview}
                refreshPreview={()=>refreshTexPreview()}
                height={"240px"}
                width={"100%"}
                key={'texpreview'}
                objectFit={"contain"}
            />}
            {/*{texture.userData.tpAssetId ? <UnkObjComponent label={`Asset: ${texture.name || 'Unnamed'}`} disabled={true} obj={texture}/> :*/}
            {/*    texture._tpAssetId ? <UnkObjComponent label={`Texture: ${texture.name || 'Unnamed'}`} disabled={true} obj={texture}/> :*/}
            {/*        !!texture.uiConfig && (<ConfigObject {...props} config={texture.uiConfig} icon={iconForSelectionObject(texture)}/>)}*/}

            {/*{isExternalTexture}*/}
            {!!texture.uiConfig && isTexEditable(texture, manager) && !isExternalTexture(texture) ?
                <ConfigObject key={'texturec'} {...props} config={texture.uiConfig} icon={iconForSelectionObject(texture)}/> :
                <UnkObjComponent key={'texture'} label={`Asset: ${texture.name || 'Unnamed'}`} disabled={true} obj={texture}/>
            }

            <Divider style={{margin: 0}}/>
        </>}

        {isPackageJson && <>
            <PluginsSectionComp/>
            <Divider style={{margin: 0}}/>
            <ScriptsSectionComp/>
        </>}
        {inspectingScene && <>
            {viewer.uiConfig.children?.map((c, i)=>{
                const uiConfig: UiObjectConfig|undefined = getOrCall(c) // todo use uiconfigmethods
                return uiConfig && typeof uiConfig === 'object' && (<ConfigObject key={uiConfig.uuid ?? ('scn'+i)} {...props} config={uiConfig} icon={iconForSelectionObject(selObject)}/>)
            })}

        </>}
    </div>

}

export function InsSectionItem(props: {
    text: string,
    icon?: IconName | MaybeElement,
    info?: {text: string, icon: IconName|MaybeElement}
    buttons?: ({key: string, text: string, showText?: boolean} & ButtonProps)[]
}) {
    return <div
        className={"xPaddedContent folderContent folder-trigger-text"}
        style={{
            marginLeft: 0, height: "30px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "10px"
        }}
    >
        {props.icon && (typeof props.icon === 'string' ? <Icon icon={props.icon} style={{marginRight: "0"}} size={12}/> : props.icon)}
        <div style={{
            maxWidth: "100%",
            overflow: "scroll",
            flexGrow: "1",
            scrollbarWidth: "none",
        }}>
            {props.text}
        </div>
        {props.info && <Tooltip
            content={props.info.text}
            // position={"top"}
            hoverOpenDelay={150}
            hoverCloseDelay={300}
        >
            {typeof props.info.icon === 'string' ? <Icon icon={props.info.icon} style={{marginLeft: "6px"}} size={12}/> : props.info.icon}
        </Tooltip>}
        {props.buttons?.map(({key, text, showText, ...b})=><Tooltip
            key={key}
            content={text}
            hoverOpenDelay={150}
            hoverCloseDelay={300}
        >
            <Button
                variant={"minimal"} size={"small"}
                // icon="trash"
                title={text}
                {...b}
                text={showText ? text : undefined}
                // intent={"warning"}
            />
        </Tooltip>)}
    </div>
}

export function PluginsSectionComp(){
    const manager = useManager()
    // const viewer = manager.get()
    // const picking = viewer?.getPlugin(PickingPlugin)
    // const availablePlugins = picking?.availablePlugins() || []
    const {loadingState, updateLoading} = useLoadingState()

    const {project} = useProject()
    const removeProjectPlugin = async (p: ExternalPlugin)=>{
        if(!project) return false
        // todo confirm dialog
        const res = await manager.removeProjectPlugin(p).then(()=>({error: null})).catch(e=>{
            return {error: e?.message ?? 'Unknown error'}
        })
        const r = showSuccessErrorToast(res ? `Removed ${project.path}${p.import} successfully` : 'Unknown Error', 'Unable to remove plugin', res)
        return r
    }

    // const [extPlugins, setExtPlugins] = useState<ExternalPlugin[]>(manager.extPlugins)
    // useEffect(()=>{
    //     const l = ()=>{
    //         setExtPlugins([...manager.extPlugins||[]])
    //     }
    //     manager.addEventListener('extPluginsChange', l)
    //     return ()=>{
    //         manager.removeEventListener('extPluginsChange', l)
    //     }
    // }, [manager.extPlugins])
    let extPlugins = useListenProperty(manager, 'extPlugins', 'extPluginsChange', (v)=>([...v||[]]))

    extPlugins = extPlugins.sort((a, b)=>{
        const i1 = a.import.toLowerCase().replace(/^\@/, '')
        const i2 = b.import.toLowerCase()
        if(i1 < i2) return -1
        if(i1 > i2) return 1
        const c1 = a.className?.toLowerCase() || ''
        const c2 = b.className?.toLowerCase() || ''
        if(c1 < c2) return -1
        if(c1 > c2) return 1
        return 0
    })

    return <FolderHeadCard open={true} label={"Plugins"} minimal={true} level={0} onClick={()=>{}} icon={"stacked-chart"}>
        {/*todo listen to extPlugins change*/}
        {extPlugins?.map((c, i)=>{
            // const uiConfig: UiObjectConfig|undefined = c.uiConfig // todo use uiconfigmethods
            // return uiConfig && typeof uiConfig === 'object' && (<ConfigObject key={uiConfig.uuid ?? i} {...props} config={uiConfig} icon={"code"}/>)
            return <InsSectionItem
                key={i}
                text={c.className ? `${c.className}` : `${c.import}`}
                info={!!c.className ? {text: c.import, icon: "package"} : undefined}
                buttons={[{
                    key: 'remove', text: 'Remove Plugin', icon: "trash",
                    intent: "warning",
                    // disabled={!fileNeedsSave}
                    loading: loadingState['remove-plugin'],
                    onClick: () => updateLoading('remove-plugin', removeProjectPlugin(c))
                }]}
            />
        })}

        <AddPluginComp/>

    </FolderHeadCard>

}

export function AddPluginComp(){
    const [selectedPlugin, setSelectedPlugin] = useState<SelectFileRef|null>(null)
    const manager = useManager()
    // const viewer = manager.get()
    // const picking = viewer?.getPlugin(PickingPlugin)
    // const availablePlugins = picking?.availablePlugins() || []
    const {loadingState, updateLoading} = useLoadingState()

    const {project} = useProject()
    const addProjectPlugin = async (path: string)=>{
        if(!project) return false
        const res = await manager.addProjectPlugin({import: path}).then(()=>({error: null})).catch(e=>{
            return {error: e?.message ?? 'Unknown error'}
        })
        const r = showSuccessErrorToast(res ? `Loaded ${project.path}${path} successfully` : 'Unknown Error', 'Unable to load plugin', res)
        return r
    }

    const extraPlugins = useListenProperty(manager, 'extraViewerPlugins', 'extraPluginsChange', (v)=>([...v||[]]))
    // todo usememo?
    const extraItems = extraPlugins
        .filter(p=>!manager.get().getPlugin(p.PluginType))
        .map(p=>({plugin: p, name: p.PluginType, uuid: generateUUID()}))
    // console.log(extraItems)

    return <RefSelectionObjectComponent
        label={"Add Plugin"}
        objectType={"plugin"}
        object={selectedPlugin}
        disabled={false} allowNone={true}
        extraItems={extraItems}
        onChange={(v)=>{
            setSelectedPlugin(v as SelectFileRef)
        }}
    >
        <Button variant={"minimal"} title={"Add Plugin"} icon={<Icon size={12} icon={"plus"}/>}
                disabled={!selectedPlugin?.entry.path}
                loading={loadingState['addPlugin']}
            // onClick={() => updateLoading(onChange({value: null}))}
                onClick={()=>{
                    const path = selectedPlugin?.entry.path
                    if(!path) return
                    // todo success, error toast
                    updateLoading('addPlugin', addProjectPlugin(path))
                }}
        ></Button>
    </RefSelectionObjectComponent>
}

export function ScriptsSectionComp(){
    const manager = useManager()
    // const viewer = manager.get()
    // const picking = viewer?.getPlugin(PickingPlugin)
    // const availablePlugins = picking?.availablePlugins() || []
    const {loadingState, updateLoading} = useLoadingState()

    const {project} = useProject()
    const removeProjectScript = async (p: ExternalScript)=>{
        if(!project) return false
        // todo confirm dialog
        const res = await manager.removeProjectScript(p).then(()=>({error: null})).catch(e=>{
            return {error: e?.message ?? 'Unknown error'}
        })
        const r = showSuccessErrorToast(res ? `Removed ${project.path}${p.import} successfully` : 'Unknown Error', 'Unable to remove plugin', res)
        return r
    }

    const extScripts = useListenProperty(manager, 'extScripts', 'extScriptsChange', (v)=>([...v||[]]))

    return <FolderHeadCard open={true} label={"Scripts"} minimal={true} level={0} onClick={()=>{}} icon={"stacked-chart"}>
        {/*todo listen to extScripts change*/}
        {extScripts?.map((c, i)=>{
            return <InsSectionItem
                key={i}
                icon={"package"}
                text={`${c.import}`}
                buttons={[{
                    key: 'remove', text: 'Remove Script', icon: "trash",
                    intent: "warning",
                    // disabled={!fileNeedsSave}
                    loading: loadingState['remove-script'],
                    onClick: () => updateLoading('remove-script', removeProjectScript(c))
                }]}
            />
        })}

        <AddScriptComp/>

    </FolderHeadCard>

}

export function AddScriptComp(){
    const [selectedScript, setSelectedScript] = useState<SelectFileRef|null>(null)
    const manager = useManager()
    const {loadingState, updateLoading} = useLoadingState()

    const {project} = useProject()

    return <RefSelectionObjectComponent label={"Add Script"} objectType={"script"} object={selectedScript} disabled={false} allowNone={true} onChange={(v)=>{
        setSelectedScript(v as SelectFileRef)
    }}>
        <Button variant={"minimal"} title={"Add Script"} icon={<Icon size={12} icon={"plus"}/>}
                disabled={!selectedScript?.entry.path}
                loading={loadingState['addScript']}
            // onClick={() => updateLoading(onChange({value: null}))}
                onClick={()=>{
                    const path = selectedScript?.entry.path
                    if(!path) return
                    // todo success, error toast
                    updateLoading('addScript', addProjectScript(path, manager))
                }}
        ></Button>
    </RefSelectionObjectComponent>
}

export function CompsSectionComp({object, ...panelProps}: {object: IObject3D} & PanelActions){
    const manager = useManager()

    const ecs = manager.get().getPlugin(EntityComponentPlugin)
    const [comps, setComps] = useState<Object3DComponent[]>([...EntityComponentPlugin.ObjectToComponents.get(object) || []])

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

    // const extComps = useListenProperty(manager, 'extComps', 'extCompsChange', (v)=>([...v||[]]))

    return <FolderHeadCard open={true} label={"Components"} minimal={true} level={0} onClick={()=>{}} icon={"stacked-chart"}>
        {/*todo listen to extComps change*/}
        {comps.map(comp=>{
            if(!comp.uiConfig) return null
            return [
            <ConfigObject key={comp.uuid} config={comp.uiConfig} icon={"package"} {...panelProps}/>,
            <Divider key={comp.uuid+'div'}  style={{margin: 0}}/>
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
        label={"Add"}
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

export const addProjectScript = async (path: string, manager: ViewerInstanceManager)=>{
    if(!manager.loadedProject) return false
    const res = await manager.addProjectScript({import: path}).then(()=>({error: null})).catch(e=>{
        return {error: e?.message ?? 'Unknown error'}
    })
    const r = showSuccessErrorToast(res ? `Loaded ${manager.loadedProject.path}${path} successfully` : 'Unknown Error', 'Unable to load plugin', res)
    const mod = manager.scriptModules.get(path)
    if(!mod){
        return false
    }
    return mod.components
}

