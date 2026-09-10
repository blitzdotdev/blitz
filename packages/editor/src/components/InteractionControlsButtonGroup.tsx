import {ButtonGroup, Intent, Menu, Popover, Tooltip} from "@blueprintjs/core";
import {FC, useCallback, useEffect, useReducer, useState} from 'react'
import {editorFeatures} from '../utils/EditorFeatures.ts'
import {Object3DGenerationMenu} from './Object3DGenerationMenu.tsx'
import {EditModePlugin} from "../utils/EditModePlugin.ts";
import {useListenProperty} from "./UseListenProperty.tsx";
import {useOnObjectCreate} from "./UseOnObjectCreate.tsx";
import {InteractionIconButton} from "./InteractionIconButton.tsx";
import {TransformControlsPlugin} from "threepipe";
import {TransformControlsSettingsMenu} from "./TransformControlsSettingsMenu.tsx";
import {SceneOverrideMaterialMenu} from "./SceneOverrideMaterialMenu.tsx";
import {CameraSelectionMenu} from "./CameraSelectionMenu.tsx";
import {useManager} from "../utils/UseManager.ts";
import {OverrideLightingType, OverrideMaterialType} from "../utils/three/LightMaterialOverrider.ts";

type SetKeys = 'transform-controls' | 'post-processing' | 'widgets' | 'grid' | 'backgroundColor' | 'cameraMode' | 'overrideMaterial'

type CameraType = 'perspective' | 'orthographic' | 'default';

export const InteractionControlsButtonGroup: FC<{}> = ({}) => {
    const manager = useManager()
    const set = useCallback((key: keyof typeof editorFeatures, value: boolean)=> manager.features.set(key, value, 'InteractionControlsButtonGroup'), [manager])
    const keys = ['transform-controls', 'post-processing', 'widgets'] as const
    const states = Object.fromEntries(keys.map(k => [k, useReducer((_: boolean, value: boolean)=> set(k, value), true)])) as Record<SetKeys, [boolean, (v: boolean)=>void]>

    const editModePlugin = manager.get().getPlugin(EditModePlugin)!
    const editEnabled = useListenProperty(editModePlugin, 'isEnabled2', 'enableChanged')

    states['grid'] = useReducer(editModePlugin.toggleGrid, false)
    states['backgroundColor'] = useReducer(editModePlugin.toggleBackgroundColor, false)
    states['cameraMode'] = useReducer(editModePlugin.toggleCameraMode, false)

    // Track actual override material state, not just toggle
    const [overrideMaterialActive, setOverrideMaterialActive] = useState<OverrideMaterialType | null>(null);
    const [overrideLightingActive, setOverrideLightingActive] = useState<OverrideLightingType | null>(null);

    // Track camera selection
    const [currentCamera, setCurrentCamera] = useState<CameraType>('perspective');

    const transformControls = manager.get().getPlugin(TransformControlsPlugin)?.transformControls
    // transformControls.mode, space, size

    useEffect(() => {
        states['transform-controls'][1](false)
        states['post-processing'][1](true)
        states['widgets'][1](true)
        states['grid'][1](editModePlugin.grid.visible)
        states['backgroundColor'][1](editModePlugin.viewer?.renderManager.renderPass.renderBackground ?? false)
        states['cameraMode'][1](editModePlugin.cameraMode === 'orthographic')
        setOverrideMaterialActive(null)
        setOverrideLightingActive(null)
        setCurrentCamera(editModePlugin.cameraMode)

        // on unmount
        return () => {
            // we need to enable from our side
            set('transform-controls', true)
            set('post-processing', true)
            set('widgets', true)
            // set('grid', true)
            // set('backgroundColor', true)
            // set('cameraMode', false)
            // setOverrideMaterialActive(null)
        }
    }, [])

    const onObjectCreate = useOnObjectCreate();
    const [tcPopoverOpen, setTcPopoverOpen] = useState(false);
    const [omPopoverOpen, setOmPopoverOpen] = useState(false);
    const [cameraPopoverOpen, setCameraPopoverOpen] = useState(false);

    return !editEnabled ? null : (
        <div className="interactionControlsButtonContainer">
            <ButtonGroup vertical={false} style={{width: "max-content"}}
                         onContextMenu={e=> e.preventDefault()}
            >
                {transformControls && <Popover
                    targetTagName={"div"}
                    interactionKind={'hover'}
                    position={"bottom"}
                    hoverOpenDelay={150}
                    hoverCloseDelay={300}
                    isOpen={tcPopoverOpen}
                    onInteraction={setTcPopoverOpen}
                    onClose={e => {
                        // setTcPopoverOpen(false)
                    }}
                    disabled={!states['transform-controls'][0]}
                    content={
                        <TransformControlsSettingsMenu transformControls={transformControls} />
                    }
                >
                    <Tooltip
                        content={(states['transform-controls'][0] ? 'Disable' : 'Enable') + ' Transform Controls'}
                        usePortal
                        position={"bottom"}
                    >
                        <InteractionIconButton
                            intent={!states['transform-controls'][0] ? Intent.NONE : Intent.SUCCESS}
                            // icon={bpUiConfigIcons['axes-cube']} active={states['transform-controls'][0]}
                            icon={"move"} active={states['transform-controls'][0]}
                            // to prevent focus away from canvas on click
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                                states['transform-controls'][1](!states['transform-controls'][0])
                                setTcPopoverOpen(true)
                            }}/>
                    </Tooltip>
                </Popover>}

                <Tooltip
                    content={(states['post-processing'][0] ? 'Disable' : 'Enable') + ' Post Processing'}
                    usePortal
                    position={"bottom"}
                >
                    <InteractionIconButton
                        intent={!states['post-processing'][0] ? Intent.NONE : Intent.SUCCESS}
                        icon={'clean'} active={states['post-processing'][0]}
                        // to prevent focus away from canvas on click
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => states['post-processing'][1](!states['post-processing'][0])}/>
                </Tooltip>
                <Tooltip
                    content={(states['widgets'][0] ? 'Disable' : 'Enable') + ' Widgets'}
                    usePortal
                    position={"bottom"}
                >
                    <InteractionIconButton
                        intent={!states['widgets'][0] ? Intent.NONE : Intent.SUCCESS}
                        // to prevent focus away from canvas on click
                        onMouseDown={(e) => e.preventDefault()}
                        icon={'widget'} active={states['widgets'][0]} onClick={() => states['widgets'][1](!states['widgets'][0])}/>
                </Tooltip>
                <Tooltip
                    content={(states['grid'][0] ? 'Disable' : 'Enable') + ' Grid'}
                    usePortal
                    position={"bottom"}
                >
                    <InteractionIconButton
                        intent={!states['grid'][0] ? Intent.NONE : Intent.SUCCESS}
                        // to prevent focus away from canvas on click
                        onMouseDown={(e) => e.preventDefault()}
                        icon={'grid'} active={states['grid'][0]} onClick={() => states['grid'][1](!states['grid'][0])}/>
                </Tooltip>
                <Tooltip
                    content={(states['backgroundColor'][0] ? 'Disable' : 'Enable') + ' Background'}
                    usePortal
                    position={"bottom"}
                >
                    <InteractionIconButton
                        intent={!states['backgroundColor'][0] ? Intent.NONE : Intent.SUCCESS}
                        // to prevent focus away from canvas on click
                        onMouseDown={(e) => e.preventDefault()}
                        icon={'layers'} active={states['backgroundColor'][0]} onClick={() => states['backgroundColor'][1](!states['backgroundColor'][0])}/>
                </Tooltip>
                <Popover
                    targetTagName={"div"}
                    interactionKind={'hover'}
                    position={"bottom"}
                    hoverOpenDelay={150}
                    hoverCloseDelay={300}
                    isOpen={cameraPopoverOpen}
                    onInteraction={setCameraPopoverOpen}
                    content={
                        <CameraSelectionMenu
                            currentCamera={currentCamera}
                            setCurrentCamera={setCurrentCamera}
                        />
                    }
                >
                    {/*<Tooltip*/}
                    {/*    content={'Select Camera'}*/}
                    {/*    usePortal*/}
                    {/*    position={"bottom"}*/}
                    {/*>*/}
                        <InteractionIconButton
                            // todo active and intent based on selected camera mode
                            intent={Intent.NONE}
                            // to prevent focus away from canvas on click
                            onMouseDown={(e) => e.preventDefault()}
                            icon={'camera'} active={false}
                            onClick={() => {
                                // Just open the popover, don't toggle the state
                                // The state is controlled by the menu selections
                                setCameraPopoverOpen(true)
                            }}/>
                    {/*</Tooltip>*/}
                </Popover>
                <Popover
                    targetTagName={"div"}
                    interactionKind={'hover'}
                    position={"bottom"}
                    hoverOpenDelay={150}
                    hoverCloseDelay={300}
                    isOpen={omPopoverOpen}
                    onInteraction={setOmPopoverOpen}
                    content={
                        <SceneOverrideMaterialMenu
                            currentMaterial={overrideMaterialActive}
                            setCurrentMaterial={setOverrideMaterialActive}
                            currentLighting={overrideLightingActive}
                            setCurrentLighting={setOverrideLightingActive}
                        />
                    }
                >
                    {/*<Tooltip*/}
                    {/*    content={(overrideMaterialActive || overrideLightingActive ? 'Disable' : 'Enable') + ' Scene Override'}*/}
                    {/*    usePortal*/}
                    {/*    position={"bottom"}*/}
                    {/*>*/}
                        <InteractionIconButton
                            intent={!overrideMaterialActive && !overrideLightingActive ? Intent.NONE : Intent.SUCCESS}
                            // to prevent focus away from canvas on click
                            onMouseDown={(e) => e.preventDefault()}
                            icon={'tint'} active={!!overrideMaterialActive || !!overrideLightingActive}
                            onClick={() => {
                                // Just open the popover, don't toggle the state
                                // The state is controlled by the menu selections
                                setOmPopoverOpen(true)
                            }}/>
                    {/*</Tooltip>*/}
                </Popover>
                {!!onObjectCreate && <Popover
                    targetTagName={"div"}
                    interactionKind={'hover'}
                    position={"bottom"}
                    content={
                        <Menu >
                            <Object3DGenerationMenu onGenerate={onObjectCreate}/>
                        </Menu>
                    } >
                    <InteractionIconButton
                        intent={Intent.NONE}
                        // to prevent focus away from canvas on click
                        onMouseDown={(e) => e.preventDefault()}
                        icon={'add'} active={false}/>
                </Popover>}
            </ButtonGroup>
        </div>
    )
}

//sepia(1) hue-rotate(calc(-215deg + 50deg)) saturation(0.13) brightness(0.43) contrast(0.9)
//sepia(1) hue-rotate(calc(-215deg + 50deg)) saturate(0.13) brightness(0.43) contrast(0.9)
//sepia(1) hue-rotate(50deg) saturation(0.13) brightness(0.43) contrast(0.9)
