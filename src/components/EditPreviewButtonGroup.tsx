import {FC, useCallback, useEffect, useState} from "react";
import {ButtonGroup, Icon, IconName, Intent, Position, Tooltip} from "@blueprintjs/core";
import {InteractionIconButton} from "./InteractionIconButton.tsx";
import {useManager} from "../utils/UseManager.ts";

export const EditPreviewButtonGroup: FC<{
    isExpanded?: boolean;
    toggleExpand?: () => void;
}> = ({isExpanded, toggleExpand}) => {
    const manager = useManager()
    const {editPreview} = manager
    const [isPlaying, setIsPlaying1] = useState(editPreview.enabled)
    useEffect(()=>{
        const l = ()=> setIsPlaying1(editPreview.enabled)
        editPreview.addEventListener('editPreviewChange', l)
        return () => {
            editPreview.removeEventListener('editPreviewChange', l)
        }
    })

    const setIsPlaying = useCallback(async (val: boolean) => {
        if (val === editPreview.enabled) setIsPlaying1(val)
        else {
            if (val) {
                await editPreview.start().catch(e => {
                    console.error('Could not start editor preview:', e) // todo show toast
                    return false
                })
            } else {
                await editPreview.stop().catch(e => {
                    console.error('Could not stop editor preview:', e) // todo show toast
                    return false
                })
            }
        }
    }, [editPreview])

    return /*editPreview.isRunningMode ? null : */(
        <div className="interactionControlsButtonContainer" style={{right: 'var(--pt-grid-size)', left: 'unset'}}>
            <ButtonGroup
                onContextMenu={e=> e.preventDefault()}
                vertical={false} style={{width: "max-content"}}>
                {([{
                    key: 'edit',
                    label: 'Edit',
                    icon: 'bullseye' as IconName,
                    value: false,
                }, {
                    key: 'view',
                    label: 'View',
                    icon: 'camera' as IconName,
                    value: true,
                }]).map((v) => (
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
                            intent={v.value === isPlaying ? Intent.PRIMARY : Intent.NONE}
                            // to prevent focus away from canvas on click
                            onMouseDown={(e) => e.preventDefault()}
                            endIcon={v.icon} active={isPlaying === v.value}
                            onClick={() => setIsPlaying(v.value)}
                        />
                    </Tooltip>
                ))}
                {toggleExpand && (
                    <Tooltip
                        content={isExpanded ? "Restore (⇧␣)" : "Expand (⇧␣)"}
                        intent={Intent.PRIMARY}
                        position={Position.BOTTOM}
                        usePortal={true}
                    >
                        <InteractionIconButton
                            onClick={toggleExpand}
                            // to prevent focus away from canvas on click
                            onMouseDown={(e) => e.preventDefault()}
                            active={isExpanded}
                            intent={isExpanded ? Intent.PRIMARY : Intent.NONE}
                            endIcon={<Icon icon={isExpanded ? "minimize" : "maximize"} style={{
                                // @ts-ignore
                                '--pt-font-size': '12px',
                            }} />}
                        />
                    </Tooltip>
                )}
            </ButtonGroup>
        </div>
    )
}
