import {IGeometry, IMaterial, IObject3D, ITexture, PickingPlugin, SelectionObject, toTitleCase} from "threepipe";
import {ItemPredicate, ItemRenderer, Select} from "@blueprintjs/select";
import {Button, ButtonGroup, Icon, MenuItem} from "@blueprintjs/core";
import type {IconName} from "@blueprintjs/icons";
import {MaybeElement} from "@blueprintjs/core/src/common/props.ts";
import {CSSProperties, ReactNode, useMemo, useRef} from "react";
import {SelectFileRef, SelObjectType, useManager, useProject} from "../utils/ViewerInstanceManager.ts";
import {FileComponentProps, FormGroupComponent, InputGroup2} from "uiconfig-blueprint/lib/esm/lib";
import {FileManifestEntry, SelectedInspectorItem, traverseFiles, useAssets} from "../utils/AssetsProvider.ts";
import {assetUrlPrefix, settingsKey} from "../utils/project.ts";

type FilterItem = SelectedInspectorItem|SelectFileRef

const renderFilterItem: ItemRenderer<FilterItem> = (item, { handleClick, handleFocus, modifiers, query }) => {
    if (!modifiers.matchesPredicate) {
        return null;
    }
    return (
        <MenuItem
            active={modifiers.active}
            disabled={modifiers.disabled}
            key={item.uuid}
            // label={item.name || 'Unnamed'}
            onClick={handleClick}
            onFocus={handleFocus}
            roleStructure="listoption"
            text={item.name || 'Unnamed'}
            style={{fontSize: 'var(--pt-font-size-small)', paddingLeft: '5px'}}
            icon={<Icon size={12} icon={(item as SelectFileRef).entry?.path ? 'document' : 'link'}/>}
        />
    );
};

export function iconForSelectionObject(object?: SelectedInspectorItem|SelectFileRef|null): IconName | MaybeElement{
    const type = objectToType(object)
    return iconForSelectionObjectType(type)
}

export function iconForSelectionObjectType(type: SelObjectType|'image'|'script'): IconName | MaybeElement{
    switch(type){
        case 'none': return 'circle'
        case 'object': return 'cube'
        case 'material': return 'style'
        case 'texture': return 'image-rotate-left'
        case 'image': return 'image-rotate-right'
        case 'geometry': return 'grid-view'
        case 'plugin': return 'document-code'
        case 'script': return 'code'
        default: return 'help'
    }
}

const filterSelItems: ItemPredicate<FilterItem> = (query, object, _index, exactMatch) => {
    const normalizedName = object.name.toLowerCase();
    const normalizedQuery = query.toLowerCase();

    if (exactMatch) {
        return normalizedName === normalizedQuery;
    } else {
        return `${normalizedName} ${object.uuid}`.indexOf(normalizedQuery) >= 0;
    }
};

const noneSelItem = {uuid: 'none', name: 'None'}


type RefSelectionObjectComponentProps = {
    object: SelectedInspectorItem|SelectFileRef|null,
    extraItems?: (SelectedInspectorItem|SelectFileRef)[],
    objectType?: SelObjectType|'image'|'script',
    disabled: boolean, allowNone: boolean,
    onChange?: (selected: SelectedInspectorItem|SelectFileRef|null, e: any) => void
    className?: string, style?: CSSProperties
    children?: ReactNode|ReactNode[]
    /**
     * @default true
     */
    canSelect?: boolean
}

export function isSelectionObject(obj: SelectedInspectorItem|SelectFileRef|null){
    return obj && ((obj as IObject3D).isObject3D || (obj as IMaterial).isMaterial || (obj as ITexture).isTexture || (obj as IGeometry).isBufferGeometry)
}
export function RefSelectionObjectComponentInput(props: RefSelectionObjectComponentProps & {
    objectTypeLabel: string
}) {
    // const [ selectedFilterItem, setSelectedFilterItem ] = useState<FilterItem | null>(null);
    // const [ filterQuery, setFilterQuery ] = useState('');
    // const filterFilterItem: ItemPredicate<FilterItem> = (query, item) => {
    //     return item.name.toLowerCase().indexOf(query.toLowerCase()) >= 0;
    // };
    const manager = useManager()
    const viewer = manager.get()
    const picking = viewer.getPlugin(PickingPlugin)

    const {fileManifest} = useAssets()
    const assetManifest = manager.assetManifest

    const object = props.object
    const selectItem = props.canSelect !== false && picking && object && isSelectionObject(object) ? ()=>{
        // console.log('selecting', object)
        picking?.setSelectedObject(object as SelectionObject)
    } : undefined

    const inputGroupRef = useRef<InputGroup2>(null)
    inputGroupRef.current

    const selectItems: (SelectedInspectorItem|SelectFileRef)[] = []
    if(props.allowNone){
        selectItems.push(noneSelItem)
    }
    if(object){
        selectItems.push(object)
    }
    if(props.extraItems){
        selectItems.push(...props.extraItems)
    }

    const typesExts: Partial<Record<SelObjectType|'image'|'script', string[]>> = {
        'plugin': ['.plugin.js', '.plugin.ts'],
        'script': ['.script.js', '.script.ts'],
        'material': ['.mat', '.mat.json'],
        'image': ['.png', '.jpeg', '.jpg', '.gif', '.bmp', '.tiff', '.webp', '.hdr', '.exr'],
        // 'texture': ['.png', '.jpeg', '.jpg', '.gif', '.bmp', '.tiff', '.webp', '.tex.json'],
        // 'geometry': ['.glb', '.gltf', '.obj', '.fbx', '.ply', '.stl', '.geom.json'],
        // 'object': ['.glb', '.gltf', '.obj', '.fbx', '.ply', '.stl', '.geom.json'],
    }
    function pathToSelctFileRef(e: FileManifestEntry, type: SelectFileRef['type']){
        return {
            name: (e.path.split('/').pop() || e.path),
            uuid: e.path,
            // path: 'asset://' + e.path,
            entry: e,
            type: type,
        } as SelectFileRef
    }
    const manifestFilesByType = useMemo(() => {
        const objType = props.objectType
        const fileType = objType === 'texture' ? 'image' : objType
        if (!fileType || !typesExts[fileType]) return {};

        // const pluginE = new Set<string>();
        const filesByType: Partial<Record<SelObjectType|'image'|'script', SelectFileRef[]>> = {}
        traverseFiles((e) => {
            if(e.path.startsWith('.'+settingsKey+'/')) return
            // if (e.path.match(/\.plugin\.(ts|js)$/)) pluginE.add(e.path);
            const exts = typesExts[fileType]
            if(exts?.some(ext => e.path.endsWith(ext))) {
                if(!filesByType[fileType]) filesByType[fileType] = []
                if(!filesByType[fileType].find(f=>f.uuid === e.path || f.entry === e))
                    filesByType[fileType].push(pathToSelctFileRef(e, fileType))
            }
        }, fileManifest);

        // Object.values(assetManifest.files).forEach(path => {
        //     // if (path.match(/\.plugin\.(ts|js)$/)) pluginE.add(path);
        //     const exts = typesExts[objType]
        //     if(exts?.some(ext => path.endsWith(ext))) {
        //         if(!filesByType[objType]) filesByType[objType] = []
        //         if(!filesByType[objType].find(f=>f.uuid === path))
        //         filesByType[objType].push(pathToSelctFileRef(path, objType))
        //     }
        // });

        return filesByType
    }, [props.objectType, fileManifest, assetManifest]);

    if (props.objectType === 'plugin') {
        selectItems.push(...manifestFilesByType.plugin||[]);
    }
    if (props.objectType === 'material') {
        // materials in the scene that do not belong to an asset (or belong to the loaded main asset)
        viewer.object3dManager.getMaterials().forEach(m=>{
            if(m._tpRootPath && m._tpRootPath !== manager.loadedPath) return // skip materials that belong to other assets
            if(!m.appliedMeshes.size) return
            if(!m.assetType) return // if IMaterial
            if(!m.name) return // todo unnamed / internal
            if(m.userData.runtimeMaterial) return // todo set in widgets and other plugins (like GroundPlugin)
            if(!selectItems.find(i=>i.uuid === m.uuid))
                selectItems.push(m)
        })

        selectItems.push(...manifestFilesByType.material||[]);
    }
    if (props.objectType === 'texture') {
        // textures in the scene that do not belong to an asset (or belong to the loaded main asset)
        viewer.object3dManager.getTextures().forEach(m=>{
            if(m._tpRootPath && m._tpRootPath !== manager.loadedPath) return // skip textures that belong to other assets
            if(m._tpRootPath && m._tpRootPath !== manager.loadedAssetId) return // skip textures that belong to other assets
            if(!m.appliedObjects?.size) return
            if(!m.assetType) return // if ITexture
            if(!m.name) return // todo unnamed / internal
            if(m.userData.runtimeMaterial) return // todo set in widgets and other plugins (like GroundPlugin)
            // todo ignore textures that belong to the scene and not a scene is loaded
            if(!selectItems.find(i=>i.uuid === m.uuid))
                selectItems.push(m)
        })

        // console.log(manifestFilesByType.image)
        selectItems.push(...manifestFilesByType.image||[]);
    }

    // todo
    //  populate items based on type and context
    //  ability to create new items from the list (there is prop in bp for this)
    // console.log(object)

    const topButtons = [
        !!props.onChange && <Select<FilterItem>
            items={selectItems}
            key={'edit-item'}
            scrollToActiveItem={true}
            activeItem={!object && props.allowNone ? noneSelItem : object}
            disabled={props.disabled}
            itemPredicate={filterSelItems}
            itemRenderer={renderFilterItem}
            noResults={<MenuItem
                disabled={true} text="No results." roleStructure="listoption"
                style={{fontSize: 'var(--pt-font-size-small)', paddingLeft: '5px'}}
                icon={<Icon size={12} icon={"search"}/>}
            />}
            onItemSelect={(item, e)=>{
                if(item === noneSelItem && !props.allowNone) return
                props.onChange && props.onChange(item === noneSelItem ? null : item as SelectionObject, e)
            }}
            popoverProps={{
                openOnTargetFocus: false,
                onOpening: ()=>{
                    console.log('opening')
                },
                onOpened: ()=>{
                    console.log('opened')
                },
                onClosing: ()=>{
                    console.log('closing')
                },
                onClosed: ()=>{
                    console.log('closed')
                },
                minimal: true,
            }}
        >
            <Button variant={"minimal"} title={"Edit"} icon={<Icon size={12} icon={"edit"}/>}
                    disabled={props.disabled}
                // loading={loadingState}
                // onClick={() => updateLoading(onChange({value: null}))}
            ></Button>
        </Select>,
        selectItem && <Button variant={"minimal"} key={'select-item'} title={"Select"} icon={<Icon size={12} icon={"select"}/>}
            disabled={false}
        // loading={loadingState}
        // onClick={() => updateLoading(onChange({value: null}))}
            onClick={selectItem}
    ></Button>
    ].filter(b=>!!b)

    return (
    // <FormGroupComponent
    //     label={<>
    //         <Icon icon={objectTypeIcon} style={{marginRight: "7px"}}/>
    //         <span style={{color: "var(--pt-text-color)"}}
    //               className={"folder-trigger-text"}
    //               title={objectTypeLabel}>{objectTypeLabel}
    //         </span>
    //     </>}
    //     style={{marginLeft: 0, ...props.style}}
    //     disabled={false}
    //     flexBasis={"100%"}
    // >
        <InputGroup2
            ref={inputGroupRef}
            className={props.className}
            style={{
                flexGrow: "1", flexShrink: "1",
                fontSize: "var(--pt-font-size-small)",
                cursor: "default",
                ...props.style,
            }}
            rightElementWidth={`calc(${3 * topButtons.length} * var(--pt-grid-size))`}
            fill={true}
            value={object ? object.name || `Unnamed ${props.objectTypeLabel}` : ""}
            // onDoubleClick={(_e)=>{
            //     if(selectItem && object) selectItem(object)
            // }}
            rightElement={(
                <ButtonGroup>
                    {topButtons}
                    {props.children}
                    {/*<Button variant={"minimal"} title={"Remove"} icon="small-cross"*/}
                    {/*        disabled={false}*/}
                    {/*    // loading={loadingState}*/}
                    {/*    // onClick={() => updateLoading(onChange({value: null}))}*/}
                    {/*></Button>*/}
                </ButtonGroup>
            )}
            disabled={props.disabled} readOnly={false}
            onChange={(_e)=>{
                // do nothing
            }} placeholder="Nothing Selected"/>)
    // </FormGroupComponent>;
}

export function objectToType(object?: SelectedInspectorItem | SelectFileRef | null) {
    if(!object) return 'none'
    if((object as IObject3D).isObject3D){
        return 'object'
    }
    if((object as IMaterial).isMaterial){
        return 'material'
    }
    if((object as ITexture).isTexture){
        return 'texture'
    }
    if((object as IGeometry).isBufferGeometry){
        return 'geometry'
    }
    if((object as SelectFileRef).type) return (object as SelectFileRef).type
    // todo
    // if((object as SelectFileRef)._isViewerPlugin){
    //     return 'plugin'
    // }
    return 'unknown'
}

// only controlled usage for props.object
export function RefSelectionObjectComponent({label, ...props}: RefSelectionObjectComponentProps & {label?: string}) {
    const objectType = props.objectType ?? objectToType(props.object)
    const objectTypeLabel = toTitleCase(objectType)
    const objectTypeIcon = iconForSelectionObjectType(objectType)
    label = label || objectTypeLabel

    // todo
    //  populate items based on type and context
    //  ability to create new items from the list (there is prop in bp for this)

    return <FormGroupComponent
        label={<>
            <Icon icon={objectTypeIcon} style={{marginRight: "7px"}}/>
            <span style={{color: "var(--pt-text-color)"}}
                  className={"folder-trigger-text"}
                  title={label}>{label}
            </span>
        </>}
        style={{marginLeft: 0}}
        disabled={false}
        flexBasis={"100%"}
    >
        {/*<Button text={selectedFilterItem?.title ?? "Select a film"} endIcon="double-caret-vertical" />*/}
        <RefSelectionObjectComponentInput {...props} objectType={objectType} objectTypeLabel={objectTypeLabel}/>
    </FormGroupComponent>;
}

export const RefSelectionObjectComponentTex: FileComponentProps<ITexture>['AssetPicker'] = ({
    state, onChange, className, style,
})=> {
    const manager = useManager()
    const viewer = manager.get()
    const uuid = typeof state.value === 'string' && state.value.startsWith('texture://') ? state.value.substring('texture://'.length) : (state.value as ITexture)?.uuid
    const texture = (state.value as ITexture)?.isTexture ? state.value as ITexture : uuid ? viewer.object3dManager.getTextures().find(f=>f.uuid === uuid) : undefined
    // console.log(uuid, texture, state.value, viewer.object3dManager)
    const {project} = useProject()

    const loadTexture = async (selected: SelectFileRef|SelectedInspectorItem|null)=>{
        if(!project) return null
        // (selected as SelectFileRef).entry?.isFSEntry ? assetUrlPrefix + (selected as SelectFileRef).entry.path : null
        const entry = (selected as SelectFileRef).entry?.isFSEntry ? (selected as SelectFileRef).entry : null
        const res = await manager.loadAsset(entry, project)
        if(!res?.isTexture) {
            console.error('RefSelectionObjectComponentTex: loaded object is not a texture', res, selected)
            return null
        }
        return res as ITexture
    }

    // console.log('finding texture', state.value, uuid, texture, viewer.object3dManager.getTextures())
    return <RefSelectionObjectComponentInput
        object={texture ?? null}
        disabled={!!state.disabled}
        allowNone={!state.disabled && !state.readOnly}
        onChange={async (selected, _e)=> {
            if(selected && !(selected as ITexture).isTexture && !(selected as SelectFileRef).entry?.isFSEntry){
                console.error('RefSelectionObjectComponentTex: selected object is not a texture or asset file', selected)
                return
            }
            let value = null
            if(selected){
                if((selected as ITexture).isTexture){
                    value = 'texture://' + (selected as ITexture).uuid
                }else if(project){
                    // todo we can also load the texture and pass value as texture:// url instead of all generic type stuff
                    value = await loadTexture(selected) // todo disable while loading using useLoadingState
                    // if(!value) return
                    // value = 'texture://' + value.uuid
                }
            }
            onChange({
                mode: 'asset', value: value as any, // ignore ts, handled in BPTextureFileComponent, BPFileComponent
            })
        }}
        className={className} style={style}
        objectType={"texture"}
        objectTypeLabel={"Texture"}
    />
}
