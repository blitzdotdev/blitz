import {useManager} from "../utils/UseManager.ts";
import {CanvasFileDropHandler} from "../utils/CanvasFileDropHandler.tsx";
import React, {useEffect, useRef} from "react";
import {ButtonGroup} from "@blueprintjs/core";
import {FileButton} from "./FilesPanel.tsx";
import {useVirtualizer} from '@tanstack/react-virtual';
import {TExternalFile} from "./ExternalFilesPanel.tsx";
import {FileManifestEntry} from "../utils/AssetsProvider.ts";
import type {IMaterial, ImportResult, IObject3D, ITexture} from 'threepipe'

export function ExternalFilesGrid({group}: {
    group: TExternalFile
}) {
    const manager = useManager()
    const dragger = manager.get().getPlugin(CanvasFileDropHandler)
    const parentRef = useRef<HTMLDivElement>(null)
    useEffect(() => () => dragger?.handleDragEnd(), [dragger])
    const items = group.children || []
    const onClick = (f: FileManifestEntry | TExternalFile, e: React.MouseEvent) => {
        void f
        void e
    }
    const onDoubleClick = async (f: FileManifestEntry | TExternalFile, e: React.MouseEvent) => {
        void e
        if (!dragger || f.type !== 'file') return
        const item = await manager.getAssetFromEntry(f)
        if (!item || !isDraggedItem(item)) return
        const clone = dragger.cloneItem(item)
        if (!clone) return
        const result = dragger.dropAction(clone, null, true, {})
        if (result && result.cmd) dragger.execCommand(result.cmd, true)
    }

    const cssVar = (varName: string, defaultValue: string) => {
        return getComputedStyle(parentRef.current||document.documentElement).getPropertyValue(varName) || defaultValue
    }

    const buttonWidth = 28 +
        parseInt(cssVar('--file-item-button-size', '32')) +
        parseInt(cssVar('--pt-grid-size', '10'))
    const containerWidth = parentRef.current?.clientWidth || 300
    const itemsPerRow = Math.max(1, Math.floor(containerWidth / buttonWidth))
    const buttonIconHeight =
        parseInt(cssVar('--file-item-button-size', '32')) +
        parseInt(cssVar('--pt-grid-size', '10'))
    const buttonHeight = buttonIconHeight +
        1.5 * parseInt(cssVar('--pt-grid-size', '10'))
        + parseInt(cssVar('--file-item-button-text-height', '14'))

    const rowVirtualizer = useVirtualizer({
        count: Math.ceil(items.length / itemsPerRow),
        getScrollElement: () => parentRef.current,
        estimateSize: () => buttonHeight,
        overscan: 5,
    })

    return <div
        ref={parentRef}
        className={"files-panel-grid"}
        style={{height: '100%', width: '100%', overflow: 'auto'}}
    >
        <div style={{
            position: 'relative',
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: '100%',
        }}>
            {rowVirtualizer.getVirtualItems().map((virtualItem) => {
                const files = items.slice(
                    virtualItem.index * itemsPerRow,
                    Math.min((virtualItem.index + 1) * itemsPerRow, items.length)
                )
                return <ButtonGroup
                    className="file-item-button-group"
                    key={virtualItem.key}
                    data-index={virtualItem.index}
                    ref={rowVirtualizer.measureElement}
                    style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: `${buttonHeight}px`,
                        transform: `translateY(${virtualItem.start}px)`,
                        minHeight: 'unset',
                    }}
                >
                    {files.map((f) => <FileButton
                        key={f.path}
                        data-testid="asset-library-item"
                        fileEntry={f}
                        disabled={f.type === 'directory'}
                        onClick={(e) => onClick(f, e)}
                        onDoubleClick={(e) => void onDoubleClick(f, e)}
                        draggable={dragger?.canDragFile(f)}
                        onDragStart={(e) => void dragger?.handleDragStart(e, f)}
                        onDragEnd={dragger?.handleDragEnd}
                    />)}
                </ButtonGroup>
            })}
        </div>
    </div>
}

function isDraggedItem(item: ImportResult): item is IObject3D | IMaterial | ITexture {
    return Boolean(item.isObject3D || item.isMaterial || item.isTexture)
}
