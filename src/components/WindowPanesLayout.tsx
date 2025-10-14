import {Panel, PanelGroup, PanelResizeHandle,} from "react-resizable-panels";
import {CSSProperties, ReactNode, useEffect} from "react";
import {Card, Tab, Tabs} from "@blueprintjs/core";
import {toTitleCase} from "threepipe";

export interface WindowPanel{
    title: string
    content: ReactNode
    style?: CSSProperties
    key?: string
    className?: string
}
export interface WindowPanesLayoutProps{
    panels: {
        left: WindowPanel[]
        right: WindowPanel[]
        bottom: WindowPanel[]
        center: WindowPanel[]
    }
}

export function WindowPanesLayout({ panels }: WindowPanesLayoutProps){
    const renderPanel  = (panel: WindowPanel, index = 0)=> {
        return <Card key={panel.key ?? index} style={{
            width: "100%",
            height: "100%",
            padding: "0",
            background: 'transparent',
            // position: "relative",
            // display: "flex",
            // flexDirection: "column",
            borderRadius: 0,
            margin: 0,
            ...panel.style,
        }} className={panel.className}>
            {/*<div style={{fontWeight: 'bold', marginBottom: '4px'}}>{panel.title}</div>*/}
            {/*<div></div>*/}
            {panel.content}
        </Card>
    }

    const renderPanels  = (p: WindowPanel[])=> {
        if(p.length > 1){
            return <Tabs
                vertical={false}
                animate={false}
                renderActiveTabPanelOnly={false}
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
    return  <PanelGroup className={"editorSplitContainer"} direction="horizontal" autoSaveId={"tpEditorWindowPanels"}>
        <Panel
            defaultSize={20}
            collapsible={true}
            minSize={10}
            maxSize={50}
        >
            {renderPanels(panels.left)}
        </Panel>
        <PanelResizeHandle />
        <Panel >
            <PanelGroup direction="vertical">
                <Panel>
                    {renderPanels(panels.center)}
                </Panel>
                <PanelResizeHandle />
                <Panel
                    defaultSize={10}
                    collapsible={true}
                    minSize={10}
                    maxSize={50}
                >
                    {renderPanels(panels.bottom)}
                </Panel>
            </PanelGroup>
        </Panel>
        <PanelResizeHandle />
        <Panel
            defaultSize={20}
            collapsible={true}
            minSize={10}
            maxSize={50}
        >
            {renderPanels(panels.right)}
        </Panel>
    </PanelGroup>
}
