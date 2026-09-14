import {ImperativePanelHandle, Panel, PanelGroup, PanelResizeHandle} from "react-resizable-panels";
import {CSSProperties, ReactNode, useEffect, useRef, useState} from "react";
import {Card, Tab, Tabs} from "@blueprintjs/core";
import {toTitleCase} from "threepipe";
import {EditPreviewButtonGroup} from "./EditPreviewButtonGroup.tsx";
import {InteractionControlsButtonGroup} from "./InteractionControlsButtonGroup.tsx";
import {WindowPanelFlap} from "./WindowPanelFlap.tsx";
import {PopupDialogCard} from "./PopupDialogCard.tsx";

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
    const panelRefs = {
        left: useRef<ImperativePanelHandle>(null),
        right: useRef<ImperativePanelHandle>(null),
        bottom: useRef<ImperativePanelHandle>(null),
    };

    const [isExpanded, setIsExpanded] = useState(false);
    const [, forceUpdate] = useState(0);

    const triggerUpdate = () => forceUpdate(prev => prev + 1);

    const togglePanel = (position: 'left' | 'right' | 'bottom') => {
        const panel = panelRefs[position].current;
        if (panel?.isCollapsed()) {
            panel.expand();
        } else {
            panel?.collapse();
        }
    };

    const toggleExpand = () => {
        if (isExpanded) {
            // Restore panels
            panelRefs.left.current?.expand();
            panelRefs.right.current?.expand();
            panelRefs.bottom.current?.expand();
        } else {
            // Collapse all panels
            panelRefs.left.current?.collapse();
            panelRefs.right.current?.collapse();
            panelRefs.bottom.current?.collapse();
        }
        setIsExpanded(!isExpanded);
    };

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement
            if(target&&['INPUT','TEXTAREA','SELECT'].includes(target.tagName)) return
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
        return <Card key={panel.key ?? index} style={panel.style} className={`window-panel-card ${panel.className || ''}`}>
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
            ref={panelRefs.left}
            defaultSize={20}
            collapsible={true}
            minSize={10}
            maxSize={50}
            id={"left-panel"}
            order={-1}
            onCollapse={triggerUpdate}
            onExpand={triggerUpdate}
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
                        className="center-top-panel"
                    >
                        {renderPanels(panels.center)}
                        <InteractionControlsButtonGroup key="interaction-controls" />
                        <EditPreviewButtonGroup key="editpreview" isExpanded={isExpanded} toggleExpand={toggleExpand} />
                        <PopupDialogCard/>
                        <WindowPanelFlap
                            isCollapsed={panelRefs.left.current?.isCollapsed() ?? false}
                            onClick={() => togglePanel('left')}
                            position="left"
                        />
                        <WindowPanelFlap
                            isCollapsed={panelRefs.right.current?.isCollapsed() ?? false}
                            onClick={() => togglePanel('right')}
                            position="right"
                        />
                        {panels.bottom && (
                            <WindowPanelFlap
                                isCollapsed={panelRefs.bottom.current?.isCollapsed() ?? false}
                                onClick={() => togglePanel('bottom')}
                                position="bottom"
                            />
                        )}
                    </Panel>
                    {panels.bottom && <>
                    <PanelResizeHandle className={"window-panes-separator"} />
                    <Panel
                        ref={panelRefs.bottom}
                        defaultSize={10}
                        collapsible={true}
                        minSize={10}
                        maxSize={50}
                        id={"center-bottom-panel"}
                        order={1}
                        onCollapse={triggerUpdate}
                        onExpand={triggerUpdate}
                    >
                        {renderPanels(panels.bottom, true)}
                    </Panel>
                    </>}
                </PanelGroup>
        </Panel>
        <PanelResizeHandle className={"window-panes-separator"} />
        <Panel
            ref={panelRefs.right}
            defaultSize={20}
            collapsible={true}
            minSize={10}
            maxSize={50}
            id={"right-panel"}
            order={1}
            onCollapse={triggerUpdate}
            onExpand={triggerUpdate}
        >
            {renderPanels(panels.right)}
        </Panel>
    </PanelGroup>
}
