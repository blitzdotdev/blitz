import {Button, ButtonGroup, Intent, Menu, Popover, Tooltip} from "@blueprintjs/core";
import {FC, useCallback, useEffect, useReducer} from 'react'
import {bpUiConfigIcons} from 'uiconfig-blueprint/lib/esm/lib'
import {useManager} from '../utils/ViewerInstanceManager.ts'
import {editorFeatures} from '../utils/EditorFeatures.ts'
import {Object3DGenerationMenu} from './Object3DGenerationMenu.tsx'

export const InteractionControlsButtonGroup: FC<{}> = ({}) => {
    const manager = useManager()
    const set = useCallback((key: keyof typeof editorFeatures, value: boolean)=> manager.features.set(key, value, 'InteractionControlsButtonGroup'), [manager])
    const keys = ['transform-controls', 'post-processing', 'widgets'] as const
    const states =
        Object.fromEntries(keys.map(k => [k, useReducer((_: boolean, value: boolean)=> set(k, value), true)])) as Record<typeof keys[number], [boolean, (v: boolean)=>void]>

    useEffect(() => {
        states['transform-controls'][1](false)
        states['post-processing'][1](true)
        states['widgets'][1](true)

        // on unmount
        return () => {
            // we need to enable from our side
            set('transform-controls', true)
            set('post-processing', true)
            set('widgets', true)
        }
    }, [])
    return (
        <div className="interactionControlsButtonContainer">
            <ButtonGroup vertical={false} style={{width: "max-content"}} large>
                <Tooltip
                    content={(states['transform-controls'][0] ? 'Disable' : 'Enable') + ' Transform Controls'}
                    usePortal
                >
                    <Button
                        className="bpIconButton bpButtonIconLarge" large minimal
                        variant={"minimal"} size={"large"}
                        intent={!states['transform-controls'][0] ? Intent.DANGER : Intent.SUCCESS}
                        icon={bpUiConfigIcons['axes-cube']} active={states['transform-controls'][0]}
                        onClick={() => states['transform-controls'][1](!states['transform-controls'][0])}/>

                </Tooltip>
                <Tooltip
                    content={(states['post-processing'][0] ? 'Disable' : 'Enable') + ' Post Processing'}
                    usePortal
                >
                    <Button
                        className="bpIconButton" large minimal
                        variant={"minimal"} size={"large"}
                        intent={!states['post-processing'][0] ? Intent.DANGER : Intent.SUCCESS}
                        icon={'clean'} active={states['post-processing'][0]}
                        onClick={() => states['post-processing'][1](!states['post-processing'][0])}/>
                </Tooltip>
                <Tooltip
                    content={(states['widgets'][0] ? 'Disable' : 'Enable') + ' Widgets'}
                    usePortal
                >
                    <Button
                        className="bpIconButton" large minimal
                        variant={"minimal"} size={"large"}
                        intent={!states['widgets'][0] ? Intent.DANGER : Intent.SUCCESS}
                        icon={'widget'} active={states['widgets'][0]} onClick={() => states['widgets'][1](!states['widgets'][0])}/>
                </Tooltip>
                <Popover
                    targetTagName={"div"}
                    interactionKind={'hover'}
                    content={
                        <Menu >
                            <Object3DGenerationMenu/>
                        </Menu>
                    } >
                    <Button
                        className="bpIconButton" large minimal
                        variant={"minimal"} size={"large"}
                        // intent={!true ? Intent.DANGER : Intent.SUCCESS}
                        icon={'add'} active={false}/>
                </Popover>
            </ButtonGroup>
        </div>
    )
}

//sepia(1) hue-rotate(calc(-215deg + 50deg)) saturation(0.13) brightness(0.43) contrast(0.9)
//sepia(1) hue-rotate(calc(-215deg + 50deg)) saturate(0.13) brightness(0.43) contrast(0.9)
//sepia(1) hue-rotate(50deg) saturation(0.13) brightness(0.43) contrast(0.9)
