import {useManager} from "../utils/UseManager.ts";
import {CanvasFileDropHandler} from "../utils/CanvasFileDropHandler.tsx";
import React, {useEffect, useRef} from "react";
import {ButtonGroup} from "@blueprintjs/core";
import {FileButton} from "./FilesPanel.tsx";
import {useVirtualizer} from '@tanstack/react-virtual';
import {TExternalFile} from "./ExternalFilesPanel.tsx";
import {FileManifestEntry} from "../utils/AssetsProvider.ts";

export function ExternalFilesGrid({group}: {
    group: TExternalFile
}) {
    const manager = useManager()
    const dragger = manager.get().getPlugin(CanvasFileDropHandler)

    // Reference to the scrollable container
    const parentRef = useRef<HTMLDivElement>(null)

    // clear dragged on unmount
    useEffect(() => {
        return () => {
            dragger?.handleDragEnd()
        };
    }, [dragger]);

    const items = group.children || []
    const onClick = (f: FileManifestEntry | TExternalFile, e: React.MouseEvent) => {

    }
    const onDoubleClick = async (f: FileManifestEntry | TExternalFile, e: React.MouseEvent) => {
        if(!dragger) return
        const item = await manager.getAssetFromEntry(f)
        if(!item) return

        const clone = dragger.cloneItem(item)
        if(!clone) return
        const final = true
        const r = dragger.dropAction(clone, null, final, {})
        if(r){
            const {usedItem, clearPrev, cmd} = r
            // if(dragger.previousCommand) {
            //     dragger.undoPrevCommand()
            // }
            if(cmd) {
                dragger.execCommand(cmd, final)
            }
            // if(clearPrev) {
            //     dragger.previousCommand = null
            // }
            // if(usedItem) {
            //     dragger.clearDraggedItem(true);
            // }
            return true
        }
    }

    const cssVar = (varName: string, defaultValue: string) => {
        return getComputedStyle(parentRef.current||document.documentElement).getPropertyValue(varName) || defaultValue
    }

    // calc(28px + var(--file-item-button-size, 32px) + var(--pt-grid-size))
    const buttonWidth = 28 +
        parseInt(cssVar('--file-item-button-size', '32')) +
        parseInt(cssVar('--pt-grid-size', '10'))
    const containerWidth = parentRef.current?.clientWidth || 300
    const itemsPerRow = Math.max(1, Math.floor(containerWidth / buttonWidth))

    // calc(var(--file-item-button-size, 32px) + var(--pt-grid-size))
    const buttonIconHeight =
        parseInt(cssVar('--file-item-button-size', '32')) +
        parseInt(cssVar('--pt-grid-size', '10'))

    const buttonHeight = buttonIconHeight +
        1.5 * parseInt(cssVar('--pt-grid-size', '10'))
        + parseInt(cssVar('--file-item-button-text-height', '14'))

    // console.log('a', buttonHeight)
    // Setup the virtualizer
    const rowVirtualizer = useVirtualizer({
        count: Math.ceil(items.length / itemsPerRow),
        getScrollElement: () => parentRef.current,
        estimateSize: () => {
            // todo force refresh on button height change - https://discord.com/channels/719702312431386674/1003325490687385693/1447854889072988170
            // console.log('b', buttonHeight)
            return buttonHeight
        }, // Estimated height for each file button item
        overscan: 5, // Render 5 extra items above and below viewport for smoother scrolling
    })

    return <div
        ref={parentRef}
        className={"files-panel-grid"}
        style={{
            height: '100%',
            width: '100%',
            overflow: 'auto',
        }}
    >
        <div
            style={{
                position: 'relative',
                height: `${rowVirtualizer.getTotalSize()}px`,
                width: '100%',
            }}
        >
            {rowVirtualizer.getVirtualItems().map((virtualItem) => {
                const files = items.slice(
                    virtualItem.index * itemsPerRow,
                    Math.min((virtualItem.index + 1) * itemsPerRow, items.length)
                )

                return <ButtonGroup
                    className="file-item-button-group"
                    key={virtualItem.key}
                    style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: `${virtualItem.size}px`,
                        transform: `translateY(${virtualItem.start}px)`,
                        minHeight: 'unset',
                    }}
                >
                    {files.map((f) => (
                        <FileButton
                            key={f.path}
                            fileEntry={f}
                            disabled={f.type === 'directory'}
                            onClick={(e) => onClick(f, e)}
                            onDoubleClick={(e) => onDoubleClick(f, e)}
                            draggable={dragger?.canDragFile(f)}
                            onDragStart={(e) => dragger?.handleDragStart(e, f)}
                            onDragEnd={dragger?.handleDragEnd}
                        />
                    ))}
                </ButtonGroup>
            })}
        </div>
    </div>
}
