import {
    IGeometry,
    IMaterial,
    IObject3D,
    ITexture,
    PickingPlugin,
    ReferenceManager,
    SelectionObject,
    toTitleCase,
    TypedClass,
    TypedType,
    TypeSystem
} from "threepipe";
import {ItemPredicate, ItemRenderer, Select} from "@blueprintjs/select";
import {Button, ButtonGroup, Icon, IconName, MaybeElement, MenuItem} from "@blueprintjs/core";
import {CSSProperties, ReactNode, useMemo, useRef} from "react";
import {SelectFileRef, SelObjectType} from "../utils/projectUtils.ts";
import {FileComponentProps, FormGroupComponent, InputGroup2} from "uiconfig-blueprint/lib/esm/lib";
import {FileManifestEntry, SelectedInspectorItem, traverseFiles, useAssets} from "../utils/AssetsProvider.ts";
import {assetUrlPrefix, settingsKey} from "../utils/project.ts";
import {iconForSelectionObject, iconForSelectionObjectType} from "../utils/icons.tsx";
import {useProject} from "../utils/UseProject.ts";
import {useManager} from "../utils/UseManager.ts";
import { typesExts } from "../data/fileTypes.ts";

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
            icon={<Icon size={12} icon={
                item === noneSelItem || item.userData?.isPlaceholder ? 'cross' :
                (item as SelectFileRef).entry?.path ? 'document' : iconForSelectionObject(item)}/>}
        />
    );
};

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

export type SelectItemRef = {
    uuid: string
    name: string
    item: any
    type: TypedType,
    cls: TypedClass,
    icon: IconName | MaybeElement
}
type RefSelectionObjectComponentProps = {
    object: SelectedInspectorItem|SelectFileRef|SelectItemRef|null,
    extraItems?: (SelectedInspectorItem|SelectFileRef|SelectItemRef)[],
    objectType?: SelObjectType|'image'|'script'|(TypedClass[]),
    disabled: boolean, allowNone: boolean,
    onChange?: (selected: SelectedInspectorItem|SelectFileRef|SelectItemRef|null, e: any) => void
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
    // const assetManifest = manager.assetManifest

    const object = props.object
    const selectItem = props.canSelect !== false && picking && object && isSelectionObject(object) ? ()=>{
        // console.log('selecting', object)
        picking?.setSelectedObject(object as SelectionObject)
    } : undefined

    const inputGroupRef = useRef<InputGroup2>(null)
    inputGroupRef.current

    const isPlaceholder = !!(object as any)?.userData?.isPlaceholder

    const selectItems: (SelectedInspectorItem|SelectFileRef|SelectItemRef)[] = []
    if(props.allowNone){
        selectItems.push(isPlaceholder && object ? object : noneSelItem)
    }
    if(object && !isPlaceholder){
        selectItems.push(object)
    }
    if(props.extraItems){
        selectItems.push(...props.extraItems)
    }

    function pathToSelectFileRef(e: FileManifestEntry, type: SelectFileRef['type']){
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
        // if(typeof objType !== 'string') return {} // todo find json files with that class type
        const fileType =typeof objType !== 'string' ? null : objType === 'texture' ? 'image' : objType
        // if (!fileType || !typesExts[fileType]) return {};

        // const pluginE = new Set<string>();
        const filesByType: Map<SelObjectType|'image'|'script'|TypedClass, SelectFileRef[]> = new Map()
        traverseFiles((e) => {
            if(e.path.startsWith('.'+settingsKey+'/')) return
            // if (e.path.match(/\.plugin\.(ts|js)$/)) pluginE.add(e.path);
            const exts = fileType ? typesExts[fileType] : null
            if(fileType && exts?.some(ext => e.path.endsWith(ext))) {
                let l = filesByType.get(fileType)
                if(!l){
                    l = []
                    filesByType.set(fileType, l)
                }
                if(!l.find(f=>f.uuid === e.path || f.entry === e))
                    l.push(pathToSelectFileRef(e, fileType))
            }else if(Array.isArray(props.objectType)){
                if(e.path.endsWith('.json')) {
                    const typ = manager.get().assetManager.tracker.getCachedFileMeta(assetUrlPrefix + e.path)?.type
                    if(typ){
                        const cls = TypeSystem.GetClass(typ)
                        const cls1 = cls ? props.objectType.find(c=>c.key === cls.key) : undefined
                        if(!cls || !cls1) return // todo parent classes, use CanAssign
                        let l = filesByType.get(cls1)
                        if(!l){
                            l = []
                            filesByType.set(cls1, l)
                        }
                        if(!l.find(f=>f.uuid === e.path || f.entry === e))
                            l.push(pathToSelectFileRef(e, [cls1]))
                    }
                }
            }
        }, fileManifest);

        // Object.values(assetManifest.files).forEach(path => {
        //     // if (path.match(/\.plugin\.(ts|js)$/)) pluginE.add(path);
        //     const exts = typesExts[objType]
        //     if(exts?.some(ext => path.endsWith(ext))) {
        //         if(!filesByType[objType]) filesByType[objType] = []
        //         if(!filesByType[objType].find(f=>f.uuid === path))
        //         filesByType[objType].push(pathToSelectFileRef(path, objType))
        //     }
        // });

        return filesByType
    }, [props.objectType, fileManifest/*, assetManifest*/]);

    if (props.objectType === 'plugin') {
        selectItems.push(...manifestFilesByType.get('plugin')||[]);
    }
    if (props.objectType === 'script') {
        selectItems.push(...manifestFilesByType.get('script')||[]);
    }
    if (props.objectType === 'material') {
        // materials in the scene that do not belong to an asset (or belong to the loaded main asset)
        viewer.object3dManager.getMaterials().forEach(m=>{
            if(m._tpRootPath && m._tpRootPath !== manager.loadedPath) return // skip materials that belong to other assets
            if(!m.appliedMeshes.size) return
            if(!m.assetType) return // if IMaterial
            if(!m.name) return // todo unnamed / internal
            if(m.userData.isPlaceholder) return
            if(m.userData.runtimeMaterial) return // todo set in widgets and other plugins (like GroundPlugin)
            if(!selectItems.find(i=>i.uuid === m.uuid))
                selectItems.push(m)
        })

        selectItems.push(...manifestFilesByType.get('material')||[]);
    }
    if (props.objectType === 'texture') {
        // textures in the scene that do not belong to an asset (or belong to the loaded main asset)
        viewer.object3dManager.getTextures().forEach(m=>{
            if(m._tpRootPath && m._tpRootPath !== manager.loadedPath) return // skip textures that belong to other assets
            // if(m._tpRootPath && m._tpRootPath !== manager.loadedAssetId) return // skip textures that belong to other assets
            if(!m.appliedObjects?.size) return
            if(!m.assetType) return // if ITexture
            if(!m.name) return // todo unnamed / internal
            if(m.userData.runtimeTexture) return // todo set in widgets and other plugins (like GroundPlugin)
            if(m.userData.isPlaceholder) return
            // todo ignore textures that belong to the scene and not a scene is loaded
            if(!selectItems.find(i=>i.uuid === m.uuid))
                selectItems.push(m)
        })

        // console.log(manifestFilesByType.image)
        selectItems.push(...manifestFilesByType.get('image')||[]);
    }

    // objects of TypedClasses type if thats specified
    const objectsOfType = useMemo(()=>{
        if(!Array.isArray(props.objectType)) return []
        const items: SelectItemRef[] = []
        ReferenceManager.Objects.forEach(obj=>{
            if(!Array.isArray(props.objectType)) return // for ts
            const objType = TypeSystem.GetType(obj.object)
            if(!objType) return
            const cls = TypeSystem.GetClass(objType)
            if(!cls) return
            if(!props.objectType.find(c=>c.key === cls.key)) return // todo parent classes, use CanAssign
            // if(!obj.object.name) return
            // if(obj.object.userData.isPlaceholder) return
            const item = objToSelectItemRef(objType, cls, obj.object)
            if(item) items.push(item)
        })
        return items
    }, [props.objectType])

    if(Array.isArray(props.objectType)) {
        selectItems.push(...objectsOfType.filter(o => {
            return !selectItems.find(i => i.uuid === o.uuid)
        }))
        selectItems.push(...props.objectType.flatMap(o => {
            return manifestFilesByType.get(o) || []
        }))
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

export function TypeFromClasses(classes: TypedClass[]|undefined)/*:TypedType*/ {
    return {oneOf: classes?.map(c=>c.key) || [], type: 'Union'} as const
}

// only controlled usage for props.object
export function RefSelectionObjectComponent({label, ...props}: RefSelectionObjectComponentProps & {label?: string}) {
    const objectType = props.objectType ?? objectToType(props.object)
    const objectTypeLabel = typeof objectType === 'string' ? toTitleCase(objectType) : TypeSystem.TypeToString(TypeFromClasses(objectType))
    const objectTypeIcon = typeof objectType === 'string' ? iconForSelectionObjectType(objectType) :
        objectType.length ===1 ? objectType[0].getIcon?.(props.object) ?? 'layer' : iconForSelectionObjectType(objectType)
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
        // todo use getFromPath to avoid reloading if already in memory
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


export function objToSelectItemRef(type: TypedType | false, cls: TypedClass | undefined, val: any): SelectItemRef | null {
    return !type || !cls ? null : {
        uuid: cls.getId(val),
        name: cls.getLabel?.(val) ?? TypeSystem.TypeToString(type),
        icon: cls.getIcon?.(val),
        item: val,
        cls: cls,
        type: type,
    } as SelectItemRef
}
