import {useManager} from "../utils/UseManager.ts";
import {libAssetTypes} from "../data/LibAssetTypes.tsx";
import React, {useEffect, useState} from "react";
import {PopupMenuButton} from "./PopupMenuButton.tsx";
import {Tab, Tabs} from "@blueprintjs/core";
import {ExternalFilesGrid} from "./ExternalFilesGrid.tsx";
import {SliderMenuItem} from "./FilesPanel.tsx";

export type TExternalFile = {
    name: string
    path: string
    type: 'file' | 'directory'
    children: TExternalFile[],
    assetType?: string,
    libFileId?: string // if this file is linked to a lib asset, store its id here}
    isFSEntry?: false,
    icon?: string,
    size?: number,
    sha256?: string,
    mtime?: number,
}

export function ExternalFilesPanel({}: {}) {
    // const {project} = useProject()
    const manager = useManager()

    const files: TExternalFile[] = libAssetTypes.map(p => ({...p, children: []}))

    const [libAssets, setLibAssets] = useState<Array<{
        id: string
        name: string
        fileUrl: string
        thumbnailUrl: string
        type: string
    }>>([])
    useEffect(() => {
        const controller = new AbortController()
        void fetch('https://blitz-asset-library-proxy.blitzapp.workers.dev/assets/v1/list', {
            signal: controller.signal,
        }).then(async (response) => {
            if (!response.ok) throw new Error(`Asset library returned ${response.status}`)
            const body = await response.json() as {assets?: typeof libAssets}
            setLibAssets(Array.isArray(body.assets) ? body.assets : [])
        }).catch((error) => {
            if (!controller.signal.aborted) console.error('Unable to load asset library', error)
        })
        return () => controller.abort()
    }, [])

    libAssets.forEach(f => {
        const f1 = {
            ...f,
            name: f.name,
            type: 'file',
            path: f.fileUrl || '',
            icon: f.thumbnailUrl.replace('width=256&height=256', 'width=64&height=64'), // use smaller thumbnail
            // variants: f.files || {},
            libFileId: f.id,
            children: []
        } as unknown as TExternalFile
        const group = files.find(f2 => f2.assetType === f.type)
        if (!f1.path) {
            console.log('No fileUrl for asset:', f, f.type)
        } else if (group) {
            group.children.push(f1)
        } else {
            console.log('No group found for asset type:', f1.type)
        }
    })

    // const {refreshManifest} = useExternalAssets()

    // // console.log(fileManifest)
    // useEffect(()=>{
    //     refreshManifest()
    // }, [refreshManifest]) // refreshManifest changes on project change

    const [thumbSize, setThumbSize] = useState(32);

    return !manager.loadedProject ? null : <div style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        // @ts-ignore
        '--file-item-button-size': `${thumbSize}px`,
    }}>
        {/*<PanelHeader>*/}
        {/*    /!*<FilesPanelBreadCrumbs/>*!/*/}
        {/*    <div style={{flexGrow: 1}}></div>*/}
        {/*</PanelHeader>*/}
        <PopupMenuButton icon={"cog"} text={""} style={{
            position: 'absolute',
            right: 0, top: 0,
            zIndex: 1,
        }}>
            <SliderMenuItem setThumbSize={setThumbSize} thumbSize={thumbSize}/>
        </PopupMenuButton>
        <Tabs
            animate={false}
            renderActiveTabPanelOnly={true}
            size={"medium"}
            vertical={false}
            defaultSelectedTabId={files[0]?.path}
            // style={{zIndex: 0}}
        >
            {files.map((f, i) => <Tab key={f.path} id={f.path} title={f.name} panel={<ExternalFilesGrid group={f}/>}/>)}
        </Tabs>

        <div className={"files-panel-grid"}>
        </div>
    </div>
}
