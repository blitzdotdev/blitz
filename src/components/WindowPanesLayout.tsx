import {Panel, PanelGroup, PanelResizeHandle, ImperativePanelHandle} from "react-resizable-panels";
import {CSSProperties, ReactNode, useRef, useState, useEffect} from "react";
import {Card, Tab, Tabs} from "@blueprintjs/core";
import {toTitleCase} from "threepipe";
import {EditPreviewButtonGroup} from "./EditPreviewButtonGroup.tsx";
import {InteractionControlsButtonGroup} from "./InteractionControlsButtonGroup.tsx";

export interface WindowPanel{
    title: string
    content: ReactNode
    style?: CSSProperties
    key?: string
    className?: string
}
export interface WindowPanesLayoutProps{
    panels: {
        left: (WindowPanel|null)[]
        right: (WindowPanel|null)[]
        bottom: null | (WindowPanel|null)[]
        center: (WindowPanel|null)[]
    }
}

export function WindowPanesLayout({ panels }: WindowPanesLayoutProps){
    const leftPanelRef = useRef<ImperativePanelHandle>(null);
    const rightPanelRef = useRef<ImperativePanelHandle>(null);
    const bottomPanelRef = useRef<ImperativePanelHandle>(null);
    const [isExpanded, setIsExpanded] = useState(false);

    const toggleExpand = () => {
        if (isExpanded) {
            // Restore panels
            leftPanelRef.current?.expand();
            rightPanelRef.current?.expand();
            if (bottomPanelRef.current) {
                bottomPanelRef.current.expand();
            }
        } else {
            // Collapse all panels
            leftPanelRef.current?.collapse();
            rightPanelRef.current?.collapse();
            if (bottomPanelRef.current) {
                bottomPanelRef.current.collapse();
            }
        }
        setIsExpanded(!isExpanded);
    };

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.shiftKey && event.code === 'Space') {
                event.preventDefault();
                toggleExpand();
            }
        };

        window.addEventListener('keydown', handleKeyDown, true);
        return () => {
            window.removeEventListener('keydown', handleKeyDown, true);
        };
    }, [isExpanded]);

    const renderPanel  = (panel: WindowPanel, index = 0)=> {
        return <Card key={panel.key ?? index} style={{
            width: "100%",
            height: "100%",
            padding: "0",
            background: 'transparent',
            position: "relative",
            // display: "flex",
            // flexDirection: "column",
            borderRadius: 0,
            margin: 0,
            boxShadow: 'none',
            ...panel.style,
        }} className={panel.className}>
            {/*<div style={{fontWeight: 'bold', marginBottom: '4px'}}>{panel.title}</div>*/}
            {/*<div></div>*/}
            {panel.content}
        </Card>
    }

    const renderPanels  = (p0: (WindowPanel|null)[], vertical = false)=> {
        const p = p0.filter(p=>!!p)
        if(p.length > 1){
            return <Tabs
                vertical={vertical}
                animate={false}
                renderActiveTabPanelOnly={true}
                size={"medium"}
                className={"window-panels-tabs"}
            >
                {p.map(({className, ...panel}, i)=>(
                    <Tab id={panel.key || `tab-${i}`} key={panel.key || i} panel={
                        renderPanel(panel, i)
                    } panelClassName={className} title={toTitleCase(panel.title)} />
                ))}
            </Tabs>
        }else if(p.length){
            return renderPanel(p[0])
        }
    }
    return  <PanelGroup className={"editorSplitContainer"} direction="horizontal" autoSaveId={"tpEditorWindowPanelsRoot"}>
        <Panel
            ref={leftPanelRef}
            defaultSize={20}
            collapsible={true}
            minSize={10}
            maxSize={50}
            id={"left-panel"}
            order={-1}
        >
            {renderPanels(panels.left)}
        </Panel>
        <PanelResizeHandle className={"window-panes-separator"} />
        <Panel
            id={"center-panel"}
            order={0}
        >
                <PanelGroup direction="vertical" autoSaveId={"tpEditorWindowPanelsCenter"}>
                    <Panel
                        id={"center-top-panel"}
                        order={0}
                        style={{position: 'relative'}}
                    >
                        {renderPanels(panels.center)}
                        <InteractionControlsButtonGroup key="interaction-controls" />
                        <EditPreviewButtonGroup key="editpreview" isExpanded={isExpanded} toggleExpand={toggleExpand} />
                    </Panel>
                    {panels.bottom && <>
                    <PanelResizeHandle className={"window-panes-separator"} />
                    <Panel
                        ref={bottomPanelRef}
                        defaultSize={10}
                        collapsible={true}
                        minSize={10}
                        maxSize={50}
                        id={"center-bottom-panel"}
                        order={1}
                    >
                        {renderPanels(panels.bottom, true)}
                    </Panel>
                    </>}
                </PanelGroup>
        </Panel>
        <PanelResizeHandle className={"window-panes-separator"} />
        <Panel
            ref={rightPanelRef}
            defaultSize={20}
            collapsible={true}
            minSize={10}
            maxSize={50}
            id={"right-panel"}
            order={1}
        >
            {renderPanels(panels.right)}
        </Panel>
    </PanelGroup>
}
