import {FC, useCallback, useState} from "react";
import {Button, ButtonGroup, IconName, Intent, Position, Tooltip} from "@blueprintjs/core";
import {InteractionIconButton} from "./InteractionIconButton.tsx";
import {useListenProperty} from "./UseListenProperty.tsx";
import {useManager} from "../utils/UseManager.ts";

let changingPlayState = false
export const PlayModeButtonGroup: FC<{}> = ({}) => {
    const manager = useManager()
    const [isPlaying, setIsPlaying1] = useState(manager.isRunningMode)
    const isPausedRunning = useListenProperty(manager, 'isPausedRunning', 'runModePauseChange')

    // todo listed to isRunningMode change from outside?
    const setIsPlaying = useCallback(async (val: boolean) => {
        if (changingPlayState) return
        changingPlayState = true
        if (val === manager.isRunningMode && !manager.isPausedRunning) {
            setIsPlaying1(val)
        }
        else {
            if (val) {
                await manager.startRunMode().catch(e => {
                    console.error('Could not start run mode:', e) // todo show toast
                    return false
                })
            } else {
                await manager.stopRunMode().catch(e => {
                    console.error('Could not stop run mode:', e) // todo show toast
                    return false
                })
            }
            setIsPlaying1(manager.isRunningMode)
        }
        changingPlayState = false
    }, [manager])

    // todo on playing change
    //  set picking enabled
    //  set playing in viewer
    //  disable save button
    //  disable loading another file
    //  when playing stopped, reload scene
    //  dont track object/material updates when playing

    return (
        <div className="isPlayingContainer">
            <ButtonGroup
                onContextMenu={e=> e.preventDefault()}
                vertical={false} style={{width: "max-content"}}>
                {([{
                    key: 'edit',
                    label: 'Edit',
                    icon: 'edit' as IconName,
                    value: false,
                }, {
                    key: 'pause',
                    label: 'Pause',
                    icon: 'pause' as IconName,
                    value: null,
                }, {
                    key: 'play',
                    label: 'Run',
                    icon: 'play' as IconName,
                    value: true,
                }]).map((v) => {
                    const active = v.value === isPlaying || (isPausedRunning && v.value === null)
                    return (
                        <Tooltip
                            content={v.label}
                            key={v.key}
                            intent={Intent.PRIMARY}
                            position={Position.BOTTOM}
                            usePortal={true}
                            // disabled={isPopoverOpen}
                            // openOnTargetFocus={false}
                        >
                            <InteractionIconButton
                                disabled={v.key === 'pause' && !isPlaying}
                                intent={active ? Intent.PRIMARY : Intent.NONE}
                                endIcon={v.icon}
                                active={active}
                                onClick={() => {
                                    typeof v.value === 'boolean' ? setIsPlaying(v.value) : manager.isPausedRunning ? manager.unpauseRunMode() : manager.pauseRunMode()
                                }}/>
                        </Tooltip>

                    );
                })}
            </ButtonGroup>
        </div>
    )
}
