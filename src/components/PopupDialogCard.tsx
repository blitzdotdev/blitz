import React, {ReactNode, useEffect, useRef, useState} from "react";
import {Card} from "@blueprintjs/core";

export function PopupDialogCard() {
    const [dialogContent, setDialogContent] = useState<ReactNode>(null);
    const dialogCardRef = useRef<HTMLDivElement>(null);

    // Handle click outside to dismiss popup
    useEffect(() => {
        ;(window as any).setPopupDialogContent = setDialogContent

        const handleClickOutside = (event: MouseEvent) => {
            // todo issues with dropdowns etc using portal
            // if (dialogCardRef.current && !dialogCardRef.current.contains(event.target as Node)) {
            //     setDialogContent(null);
            // }
            if((event.target as HTMLElement).tagName === 'CANVAS'){
                setDialogContent(null);
            }
        };
        window.addEventListener('mousedown', handleClickOutside);
        return () => {
            window.removeEventListener('mousedown', handleClickOutside);
            ;(window as any).setPopupDialogContent = undefined
        };
    }, []);

    return !!dialogContent && <Card
        ref={dialogCardRef}
        className="bpInspectorCard window-panel-center-overlay-card"
        style={{
            // pointerEvents: 'none',
            position: 'absolute',
            bottom: '10px',
            left: '10px',
            height: '300px',
            // width: '250px',
            maxWidth: '300px',
            backgroundColor: 'hsla(var(--main-app-background-hsl), 0.95)',
        }}
    >
        {dialogContent}
    </Card>
}

export const dialogPopupCard = {
    setDialogContent: (cmd:{ dialogContent: React.ReactNode | undefined, timeoutId: number | undefined, }, gen: ()=>ReactNode) => {
        if(!cmd.dialogContent)
            cmd.dialogContent = gen()
            ;(window as any).setPopupDialogContent?.(cmd.dialogContent)
        // Auto-dismiss after 500 seconds
        if (cmd.timeoutId !== undefined) clearTimeout(cmd.timeoutId);
        cmd.timeoutId = setTimeout(() => dialogPopupCard.resetDialogContent(cmd), 500000) as any;
    },
    resetDialogContent: (cmd: { dialogContent: React.ReactNode | undefined, timeoutId: number | undefined, }) => {
        if (cmd.timeoutId !== undefined) clearTimeout(cmd.timeoutId);
        cmd.timeoutId = undefined;
        if(!cmd.dialogContent) return
        ;(window as any).setPopupDialogContent?.((current: any) => {
            // Only clear if it's still showing this command's content
            const res = (current === cmd.dialogContent ? null : current);
            // cmd.dialogContent = null; // todo uncomment later
            return res;
        })
    },
}
