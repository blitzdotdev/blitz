import {PanelActions} from "@blueprintjs/core/lib/esnext/components/panel-stack2/panelTypes";
import {manifestEntryToFile, useAssets} from "../utils/AssetsProvider.ts";
import {IGeometry, IMaterial, IObject3D, ITexture, SelectionObject} from "threepipe";
import {useManager, useProject} from "../utils/ViewerInstanceManager.ts";
import {ConfigObject, useLoadingState} from "uiconfig-blueprint/lib/esm/lib";
import {Button, ButtonGroup, Divider, Icon, Intent} from "@blueprintjs/core";
import {iconForSelectionObject, RefSelectionObjectComponent} from "./RefSelectionObjectComponent.tsx";
import type {IconName} from "@blueprintjs/icons";
import {MaybeElement} from "@blueprintjs/core/src/common/props.ts";
import {DependencyList, useCallback, useEffect, useState} from "react";
import {refreshTexturePreview, TexturePreview} from "./BPTextureFileComponent.tsx";

export function useAsyncMemo<T>(
    factory: () => Promise<T>,
    deps: DependencyList
): T | undefined {
    const [result, setResult] = useState<T>();

    useEffect(() => {
        let cancelled = false;

        factory().then((value) => {
            if (!cancelled) {
                setResult(value);
            }
        });

        return () => {
            cancelled = true;
        };
    }, deps);

    return result;
}

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

export type InspectorPanelProps = {}
export function InspectorPanelComponent({props}: {props: PanelActions & InspectorPanelProps}){
    const {selectedInspectorItem, selectedFiles} = useAssets()
    let selObject = !selectedFiles.length && selectedInspectorItem.length === 1 ? selectedInspectorItem[0] : null
    const selFile = selectedFiles.length === 1 ? selectedFiles[0] : null
    const manager = useManager()
    const viewer = manager.get()
    // const picking = viewer?.getPlugin(PickingPlugin)
    // const objectSelUiConfig = useMemo<UiObjectConfig[]|undefined>(()=>object ? picking?.objectSelectionUiConfig(object) : undefined, [object])
    // const objectMatManageUiConfig = useMemo<UiObjectConfig[]|undefined>(()=>object ? picking?.objectMaterialManageUiConfig(object) : undefined, [object])

    const loadableFiles = ['.mat']
    const reloadAsset = useCallback(async ()=>{
        if(!selFile) return null
        if(!viewer) return null
        if(!project) return null

        // if(!selFile.path.endsWith('.mat')) return null
        if(!loadableFiles.some(ext=>selFile.path.endsWith(ext))) return null

        const fi = await manifestEntryToFile(selFile)
        const r = await manager.getLoadedFile(project, selFile.path, fi || undefined)
        if(!r) return null

        const res = await manager.loadImport(r, project, false).catch(e=>{
            console.error(e)
            return null
        })
        if(!res) return null
        return res

    }, [selFile])
    const loadedObject = useAsyncMemo(reloadAsset, [reloadAsset])

    const loadedAssetMain = manager.loadedAssetObj
    let selObjectPath: string | null = null
    if(loadedAssetMain){
        selObject = loadedAssetMain as any
        selObjectPath = manager.loadedProjectFile?.path || null
    }
    else if(loadedObject){
        selObject = loadedObject as any
        selObjectPath = selFile?.path || null
    }

    let object = (selObject as IObject3D)?.isObject3D ? selObject as IObject3D : null
    // if(object?.userData.tpAssetId) object = null
    // else if(object?._tpAssetId) object = null
    const material_s = (selObject as IMaterial)?.isMaterial ? selObject as IMaterial : object?.material
    const materials = material_s ? (Array.isArray(material_s) ? material_s : [material_s]) : []
    let geometry = (selObject as IGeometry)?.isBufferGeometry ? selObject as IGeometry : object?.geometry
    let texture = (selObject as ITexture)?.isTexture ? selObject as ITexture : null

    const isAsset = !!(selObject?.userData?.tpAssetId && selObject?.userData?.rootPath?.startsWith('asset://'))
    const isLoadedAsset = isAsset && selObject === loadedObject
    const isLoadedAssetMain = isAsset && selObject === loadedAssetMain

    const {loadingState, updateLoading} = useLoadingState()

    const {project, projectFile} = useProject()

    // console.log(object, materials, material_s)
    // todo
    //  unselect button
    //  lock button

    const [needsSave, setNeedsSave] = useState(false)

    const isPackageJson = selFile?.path === 'package.json'
    const loadedPackageJson = useAsyncMemo(async ()=>{
        if(selFile?.path !== 'package.json' || !project || selFile.handle.kind !== 'file') return null
        if(!viewer) return null
        let json: any = {}
        const file = await (selFile.handle?.getFile()/* ?? manager.getProjectFile(project, selFile.path)*/)
        try {
            const text = await file.text()
            json = JSON.parse(text)
        } catch (e) {
            console.error('Error parsing package.json', e)
            return null
        }
        // const deps = {
        //     ...json['dependencies'] ?? {},
        //     // ...json['peerDependencies'] ?? {},
        //     // ...json['optionalDependencies'] ?? {},
        // }

        return {
            json, file, selFile,
        }
    }, [selFile, project])
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

    const isMatFile = isLoadedAsset && selObject && selObjectPath && (selObject as IMaterial).isMaterial
    useEffect(()=>{
        if(isMatFile){
            const listener = ()=>{
                setNeedsSave(true)
            }
            const mat = selObject as IMaterial
            mat.addEventListener('materialUpdate', listener)
            return ()=>{
                mat.removeEventListener('materialUpdate', listener)
            }
        } else {
            setNeedsSave(false)
        }
    }, [selObject, isMatFile])

    // todo autosave on needssave
    const saveAsset = async ()=>{
        if(!isLoadedAsset || !selObject || !selObjectPath || !project) return
        if(!isMatFile) return // todo other types
        const res = await manager.saveProjectAsset(project, projectFile, selObject as IObject3D|IMaterial, selObjectPath)
        if(res.error){
            // todo apptoaster
            return
        }
        setNeedsSave(false)
        return res
    }

    return !selectedInspectorItem ? null : <>
        {/*{v && (<ConfigObject {...props}/>)}*/}
        {/*{!selectedFiles.length ? null : <>*/}
        {/*    <div>Files</div>*/}
        {/*    <div>{selectedFiles.map(item=>{*/}
        {/*        return <div key={item.path}>{item.name}</div>*/}
        {/*    })}</div>*/}
        {/*</>}*/}
        {!!selFile && <>
            {/*<div>File</div>*/}
            <div className={"xPaddedContent folderContent folder-trigger-text"}
                 style={{marginLeft: 0, color: "var(--pt-text-color)"}}
            >{selFile.path}</div>
            {/*{selFile.uiConfig && (<ConfigObject {...props} config={selFile.uiConfig}/>)}*/}
        </>}
        {!!selObject?.uiConfig && (isLoadedAsset || isLoadedAssetMain) && <>
            {/*todo
                test save button for objects, materials, textures
            */}
            <ButtonGroup style={{
                position: "absolute",
                top: "0",
                right: "0",
                zIndex: 1,
                height: "30px",
                padding: "3px",
            }}>
                {isLoadedAsset && selObject && selObjectPath && reloadAsset &&
                    <Button key={"resetButton"} icon={<Icon icon={"reset"} size={14}/>}
                            size={"small"} variant={"minimal"}
                            title={"Reload Asset"} intent={Intent.NONE}
                            loading={loadingState['resetAsset']}
                        //todo handle error from fn return
                            onClick={() => updateLoading('resetAsset', reloadAsset())}
                    />}
                {isLoadedAsset && selObject && selObjectPath &&
                <Button key={"saveButton"} icon={<Icon icon={"floppy-disk"} size={14}/>}
                        size={"small"} variant={"minimal"}
                        title={"Save Asset"} intent={Intent.SUCCESS}
                        loading={loadingState['saveAsset']}
                        disabled={!needsSave}
                        //todo handle error from fn return
                        onClick={() => selObject && selObjectPath && updateLoading('saveAsset', saveAsset())}
                />}
            </ButtonGroup>
            {/*<div>Selected</div>*/}
            {/*<div>Name - {selObject.name}</div>*/}
            {selObject.uiConfig && (<ConfigObject {...props} config={selObject.uiConfig} icon={iconForSelectionObject(selObject)}/>)}
        </>}
        {!!object && <>
            {/*<div>Object</div>*/}
            {
            // object.userData.tpAssetId ? <UnkObjComponent label={`Asset: ${object.name || 'Unnamed'}`} disabled={true} obj={object}/> :
                object._tpAssetId ? <UnkObjComponent label={`Object: ${object.name || 'Unnamed'}`} disabled={true} obj={object}/> :
                    !!object.uiConfig && (<ConfigObject {...props} config={object.uiConfig} icon={iconForSelectionObject(object)}/>)}
            {/*{!!objectSelUiConfig?.length && objectSelUiConfig.map((c, i)=><ConfigObject key={i} {...props} config={c}/>)}*/}
            <Divider style={{margin: 0}}/>
        </>}
        {!!geometry && <>
            {/*<div>Geometry</div>*/}
            {geometry.userData.tpAssetId ? <UnkObjComponent label={`Asset: ${geometry.name || 'Unnamed'}`} disabled={true} obj={geometry}/> :
                geometry._tpAssetId ? <UnkObjComponent label={`Geometry: ${geometry.name || 'Unnamed'}`} disabled={true} obj={geometry}/> :
                    !!geometry.uiConfig && (<ConfigObject {...props} config={geometry.uiConfig} icon={iconForSelectionObject(geometry)}/>)}

            <Divider style={{margin: 0}}/>
        </>}
        {!!object && materials.map((material, materialI)=> //material && (material.userData.tpAssetId || material._tpAssetId) ? null :
            <RefSelectionObjectComponent
                key={materialI}
                disabled={object?.userData.tpAssetId || object?._tpAssetId}
                allowNone={false} object={material} onChange={(_selected: SelectionObject, _e) => {
                // todo set material
            }}/>
        )}
        {!!materials?.length && !isLoadedAsset && !isLoadedAssetMain && <>
            {/*<div>*/}
            {/*    <div>Materials</div>*/}
            {/*</div>*/}

            {materials.map(material=>
                (material.userData.tpAssetId || material._tpAssetId) && material !== selObject ? null :
                    // material.userData.tpAssetId ? <UnkObjComponent key={material.uuid} label={`Asset: ${material.name || 'Unnamed'}`} disabled={true} obj={material}/> :
                        (material.userData.tpAssetId || material._tpAssetId) /*&& material !== loadedObject*/ ? <UnkObjComponent key={material.uuid} label={`Material: ${material.name || 'Unnamed'}`} disabled={true} obj={material}/> :
                            material?.uiConfig && !material.userData?.isPlaceholder ? (<ConfigObject key={material.uuid} {...props} config={material.uiConfig}  icon={iconForSelectionObject(material)}/>) :
                                <UnkObjComponent disabled={true} key={material.uuid} obj={material}/>
            )}
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
                objectFit={"contain"}
            />}
            {texture.userData.tpAssetId ? <UnkObjComponent label={`Asset: ${texture.name || 'Unnamed'}`} disabled={true} obj={texture}/> :
                texture._tpAssetId ? <UnkObjComponent label={`Texture: ${texture.name || 'Unnamed'}`} disabled={true} obj={texture}/> :
                    !!texture.uiConfig && (<ConfigObject {...props} config={texture.uiConfig} icon={iconForSelectionObject(texture)}/>)}

            <Divider style={{margin: 0}}/>
        </>}

        {isPackageJson && loadedPackageJson && <>

        </>}
    </>

}
