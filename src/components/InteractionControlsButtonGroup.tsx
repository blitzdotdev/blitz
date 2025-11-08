import {Button, ButtonGroup, Intent, Menu, Popover, Tooltip} from "@blueprintjs/core";
import {FC, useCallback, useEffect, useReducer} from 'react'
import {AppToaster, bpUiConfigIcons} from 'uiconfig-blueprint/lib/esm/lib'
import {useManager} from '../utils/ViewerInstanceManager.ts'
import {editorFeatures} from '../utils/EditorFeatures.ts'
import {Object3DGenerationMenu} from './Object3DGenerationMenu.tsx'
import {EditModePlugin} from "../utils/EditModePlugin.ts";
import {IObject3D} from "threepipe";
import {useListenProperty} from "./UseListenProperty.tsx";
import {useOnObjectCreate} from "./UseOnObjectCreate.tsx";

type SetKeys = 'transform-controls' | 'post-processing' | 'widgets' | 'grid' | 'backgroundColor' | 'cameraMode'

export const InteractionControlsButtonGroup: FC<{}> = ({}) => {
    const manager = useManager()
    const set = useCallback((key: keyof typeof editorFeatures, value: boolean)=> manager.features.set(key, value, 'InteractionControlsButtonGroup'), [manager])
    const keys = ['transform-controls', 'post-processing', 'widgets'] as const
    const states = Object.fromEntries(keys.map(k => [k, useReducer((_: boolean, value: boolean)=> set(k, value), true)])) as Record<SetKeys, [boolean, (v: boolean)=>void]>

    const editModePlugin = manager.get().getPlugin(EditModePlugin)!
    states['grid'] = useReducer(editModePlugin.toggleGrid, false)
    states['backgroundColor'] = useReducer(editModePlugin.toggleBackgroundColor, false)
    states['cameraMode'] = useReducer(editModePlugin.toggleCameraMode, false)

    useEffect(() => {
        states['transform-controls'][1](false)
        states['post-processing'][1](true)
        states['widgets'][1](true)
        states['grid'][1](true)
        states['cameraMode'][1](false)

        // on unmount
        return () => {
            // we need to enable from our side
            set('transform-controls', true)
            set('post-processing', true)
            set('widgets', true)
            // set('grid', true)
            // set('backgroundColor', true)
            // set('cameraMode', false)
        }
    }, [])

    const onObjectCreate = useOnObjectCreate();

    return (
        <div className="interactionControlsButtonContainer">
            <ButtonGroup vertical={false} style={{width: "max-content"}}>
                <Tooltip
                    content={(states['transform-controls'][0] ? 'Disable' : 'Enable') + ' Transform Controls'}
                    usePortal
                    position={"bottom"}
                >
                    <Button
                        className="bpIconButton icon-only-tab-button"
                        variant={"minimal"} size={"medium"}
                        intent={!states['transform-controls'][0] ? Intent.PRIMARY : Intent.SUCCESS}
                        // icon={bpUiConfigIcons['axes-cube']} active={states['transform-controls'][0]}
                        icon={"move"} active={states['transform-controls'][0]}
                        onClick={() => states['transform-controls'][1](!states['transform-controls'][0])}/>
                </Tooltip>
                <Tooltip
                    content={(states['post-processing'][0] ? 'Disable' : 'Enable') + ' Post Processing'}
                    usePortal
                    position={"bottom"}
                >
                    <Button
                        className="bpIconButton icon-only-tab-button"
                        variant={"minimal"} size={"medium"}
                        intent={!states['post-processing'][0] ? Intent.PRIMARY : Intent.SUCCESS}
                        icon={'clean'} active={states['post-processing'][0]}
                        onClick={() => states['post-processing'][1](!states['post-processing'][0])}/>
                </Tooltip>
                <Tooltip
                    content={(states['widgets'][0] ? 'Disable' : 'Enable') + ' Widgets'}
                    usePortal
                    position={"bottom"}
                >
                    <Button
                        className="bpIconButton icon-only-tab-button"
                        variant={"minimal"} size={"medium"}
                        intent={!states['widgets'][0] ? Intent.PRIMARY : Intent.SUCCESS}
                        icon={'widget'} active={states['widgets'][0]} onClick={() => states['widgets'][1](!states['widgets'][0])}/>
                </Tooltip>
                <Tooltip
                    content={(states['grid'][0] ? 'Disable' : 'Enable') + ' Grid'}
                    usePortal
                    position={"bottom"}
                >
                    <Button
                        className="bpIconButton icon-only-tab-button"
                        variant={"minimal"} size={"medium"}
                        intent={!states['grid'][0] ? Intent.PRIMARY : Intent.SUCCESS}
                        icon={'grid'} active={states['grid'][0]} onClick={() => states['grid'][1](!states['grid'][0])}/>
                </Tooltip>
                <Tooltip
                    content={(states['backgroundColor'][0] ? 'Disable' : 'Enable') + ' Background'}
                    usePortal
                    position={"bottom"}
                >
                    <Button
                        className="bpIconButton icon-only-tab-button"
                        variant={"minimal"} size={"medium"}
                        intent={!states['backgroundColor'][0] ? Intent.PRIMARY : Intent.SUCCESS}
                        icon={'layers'} active={states['backgroundColor'][0]} onClick={() => states['backgroundColor'][1](!states['backgroundColor'][0])}/>
                </Tooltip>
                <Tooltip
                    content={(states['cameraMode'][0] ? 'Disable' : 'Enable') + ' Orthographic'}
                    usePortal
                    position={"bottom"}
                >
                    <Button
                        className="bpIconButton icon-only-tab-button"
                        variant={"minimal"} size={"medium"}
                        intent={!states['cameraMode'][0] ? Intent.PRIMARY : Intent.SUCCESS}
                        icon={'camera'} active={states['cameraMode'][0]} onClick={() => states['cameraMode'][1](!states['cameraMode'][0])}/>
                </Tooltip>
                {!!onObjectCreate && <Popover
                    targetTagName={"div"}
                    interactionKind={'hover'}
                    position={"bottom"}
                    content={
                        <Menu >
                            <Object3DGenerationMenu onGenerate={onObjectCreate}/>
                        </Menu>
                    } >
                    <Button
                        className="bpIconButton icon-only-tab-button"
                        variant={"minimal"} size={"medium"}
                        intent={!false ? Intent.PRIMARY : Intent.SUCCESS}
                        icon={'add'} active={false}/>
                </Popover>}
            </ButtonGroup>
        </div>
    )
}

//sepia(1) hue-rotate(calc(-215deg + 50deg)) saturation(0.13) brightness(0.43) contrast(0.9)
//sepia(1) hue-rotate(calc(-215deg + 50deg)) saturate(0.13) brightness(0.43) contrast(0.9)
//sepia(1) hue-rotate(50deg) saturation(0.13) brightness(0.43) contrast(0.9)
