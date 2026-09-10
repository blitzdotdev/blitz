import {FC} from "react";
import {Button, ButtonGroup, IconName, Intent, Position, Tooltip} from "@blueprintjs/core";
import {InteractionIconButton} from "./InteractionIconButton.tsx";
import {useManagerVersion} from "../utils/UseManager.ts";
import {BlitzCheckButton, BlitzOpenGameButton} from "../adapters/BlitzToolbarControls.tsx";

export const PlayModeButtonGroup: FC<{
    onPlay(): void
    onStop(): void
    onOpenGame(): void
}> = ({onPlay, onStop, onOpenGame}) => {
    const manager = useManagerVersion()
    const isPlaying = manager.isPlaying || manager.isStartingPlay
    const isPausedRunning = false

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
                                data-testid={v.key === 'play' ? 'play' : undefined}
                                intent={active ? Intent.PRIMARY : Intent.NONE}
                                endIcon={v.icon}
                                active={active}
                                onClick={() => {
                                    if (v.value === true) isPlaying ? onStop() : onPlay()
                                    else if (v.value === false) onStop()
                                }}/>
                        </Tooltip>

                    );
                })}
                <BlitzOpenGameButton onOpenGame={onOpenGame}/>
                <BlitzCheckButton/>
            </ButtonGroup>
        </div>
    )
}
