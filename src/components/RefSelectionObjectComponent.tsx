import {IGeometry, IMaterial, IObject3D, ITexture, PickingPlugin, SelectionObject} from "threepipe";
import {ItemPredicate, ItemRenderer, Select} from "@blueprintjs/select";
import {Button, ButtonGroup, Icon, InputGroup, MenuItem} from "@blueprintjs/core";
import type {IconName} from "@blueprintjs/icons";
import {MaybeElement} from "@blueprintjs/core/src/common/props.ts";
import {CSSProperties, useRef} from "react";
import {useManager} from "../utils/ViewerInstanceManager.ts";
import {FormGroupComponent} from "uiconfig-blueprint/lib/esm/lib";
import {FileComponentProps} from "uiconfig-blueprint/lib/esm/lib";
import {SelectedInspectorItem} from "../utils/AssetsProvider.ts";

type FilterItem = Pick<Exclude<SelectionObject, null>, 'uuid'|'name'>

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
        />
    );
};

export function iconForSelectionObject(object?: SelectedInspectorItem[number]): IconName | MaybeElement{
    if(!object) return 'circle'
    if((object as IObject3D).isObject3D){
        return 'cube'
    }
    if((object as IMaterial).isMaterial){
        return 'style'
    }
    if((object as ITexture).isTexture){
        return 'image-rotate-left'
    }
    if((object as IGeometry).isBufferGeometry){
        return 'grid-view'
    }
    return 'help'
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
    object: SelectionObject,
    disabled: boolean, allowNone: boolean,
    onChange?: (selected: SelectionObject, e: any) => void
        className?: string, style?: CSSProperties
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

    const selectItem = picking ? (o: SelectionObject)=>{
        console.log('selecting', o)
        picking?.setSelectedObject(o)
    } : null

    const inputGroupRef = useRef<InputGroup>(null)
    inputGroupRef.current

    const selectItems = []
    if(props.allowNone){
        selectItems.push(noneSelItem)
    }
    if(props.object){
        selectItems.push(props.object)
    }

    // todo
    //  populate items based on type and context
    //  ability to create new items from the list (there is prop in bp for this)
    // console.log(props.object)

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
        <InputGroup
            ref={inputGroupRef}
            className={props.className}
            style={{
                flexGrow: "1", flexShrink: "1",
                fontSize: "var(--pt-font-size-small)",
                cursor: "default",
                ...props.style,
            }}
            fill={true}
            value={props.object ? props.object.name || `Unnamed ${props.objectTypeLabel}` : ""}
            // onDoubleClick={(_e)=>{
            //     if(selectItem && props.object) selectItem(props.object)
            // }}
            rightElement={(
                <ButtonGroup>
                    {!!props.onChange && <Select<FilterItem>
                        items={selectItems}
                        key={'select-item'}
                        scrollToActiveItem={true}
                        disabled={props.disabled}
                        itemPredicate={filterSelItems}
                        itemRenderer={renderFilterItem}
                        noResults={<MenuItem disabled={true} text="No results." roleStructure="listoption" />}
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
                    </Select>}
                    <Button variant={"minimal"} title={"Select"} icon={<Icon size={12} icon={"select"}/>}
                            disabled={false}
                        // loading={loadingState}
                        // onClick={() => updateLoading(onChange({value: null}))}
                            onClick={() => {
                                // todo canSelect
                                if(selectItem && props.object) selectItem(props.object)
                            }}
                    ></Button>
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

export function RefSelectionObjectComponent(props: RefSelectionObjectComponentProps) {
    const objectTypeLabel = props.object ? (
        (props.object as IObject3D).isObject3D ? 'Object' :
            (props.object as IMaterial).isMaterial ? 'Material' :
                (props.object as ITexture).isTexture ? 'Texture' :
                    (props.object as IGeometry).isBufferGeometry ? 'Geometry' :
                        'Unknown'
    ) : 'None'
    const objectTypeIcon = iconForSelectionObject(props.object)

    // todo
    //  populate items based on type and context
    //  ability to create new items from the list (there is prop in bp for this)

    return <FormGroupComponent
        label={<>
            <Icon icon={objectTypeIcon} style={{marginRight: "7px"}}/>
            <span style={{color: "var(--pt-text-color)"}}
                  className={"folder-trigger-text"}
                  title={objectTypeLabel}>{objectTypeLabel}
            </span>
        </>}
        style={{marginLeft: 0}}
        disabled={false}
        flexBasis={"100%"}
    >
        {/*<Button text={selectedFilterItem?.title ?? "Select a film"} endIcon="double-caret-vertical" />*/}
        <RefSelectionObjectComponentInput {...props} objectTypeLabel={objectTypeLabel}/>
    </FormGroupComponent>;
}

export const RefSelectionObjectComponentTex: FileComponentProps['AssetPicker'] = ({
    state, onChange, className, style,
})=> {
    const manager = useManager()
    const viewer = manager.get()
    const uuid = typeof state.value === 'string' && state.value.startsWith('texture://') ? state.value.substring('texture://'.length) : null
    const texture = uuid ? viewer.object3dManager.getTextures().find(f=>f.uuid === uuid) : undefined
    // console.log('finding texture', state.value, uuid, texture, viewer.object3dManager.getTextures())
    return <RefSelectionObjectComponentInput
        object={texture ?? null}
        disabled={!!state.disabled}
        allowNone={!state.disabled && !state.readOnly}
        onChange={(selected, _e)=>{
            onChange({mode: 'asset', value: selected?.uuid??null})
        }}
        className={className} style={style}
        objectTypeLabel={"Texture"}
    />
}
