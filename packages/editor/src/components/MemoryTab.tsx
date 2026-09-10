import {useEffect, useState} from "react";
import {Card} from "@blueprintjs/core";
import {AssetRefItem, AssetRegistryItem} from "../utils/AssetTracker.ts";
import {assetUrlPrefix} from "../utils/project.ts";
import {iconForSelectionObject} from "../utils/icons.tsx";
import {useManager} from "../utils/UseManager.ts";
import {ButtonWithTooltip} from "./ButtonWithTooltip.tsx";
import {InsSectionItem} from "./InsSectionItem.tsx";
import {InsSectionHeader} from "./InsSectionHeader.tsx";

function bytesToString(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    else if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    else return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function MemoryTab({
  className,
}: {
    className?: string
}) {
    const manager = useManager()
    const tracker = manager.get().assetManager.tracker
    const fileTracker = manager.fileTracker

    // todo move all assetRegistry stuff to one manager
    // const assets = manager.get().assetManager.assetRegistry
    const [assetList, setAssetList] = useState({...tracker.registry})
    useEffect(() => {
        const onAsset = () => {
            setAssetList({...tracker.registry})
        }
        tracker.addEventListener('registryChanged', onAsset)
        return () => {
            tracker.removeEventListener('registryChanged', onAsset)
        }
    }, [tracker])
    const [fileList, setFileList] = useState([...fileTracker.files])
    useEffect(() => {
        const onFileChange = () => {
            setFileList([...fileTracker.files])
        }
        fileTracker.addEventListener('fileAdd', onFileChange)
        fileTracker.addEventListener('fileRemove', onFileChange)
        fileTracker.addEventListener('fileUpdate', onFileChange)
        return () => {
            fileTracker.removeEventListener('fileAdd', onFileChange)
            fileTracker.removeEventListener('fileRemove', onFileChange)
            fileTracker.removeEventListener('fileUpdate', onFileChange)
        }
    }, [fileTracker])

    const totalFileMemory = fileList.reduce((acc, item) => acc + item.file.size, 0)
    const totalFileMemoryStr = bytesToString(totalFileMemory)

    return <Card className={"bpInspectorCard " + className || ''} style={{borderRadius: 0}}>

        <InsSectionHeader title={"Loaded Assets"} icon={"package"}>
        {/*    buttons */}
        </InsSectionHeader>
        {Object.entries(assetList).map(([path, asset]) =>
            <AssetRegistryItemComp key={path} path={path} asset={asset}/>
        )}
        {Object.keys(assetList).length === 0 &&
            <InsSectionItem
                text={'No assets loaded'}
                icon={'info-sign'}
            />
        }

        <InsSectionHeader title={"Loaded Blobs"} icon={"database"}>
        {/*    buttons */}
        {/*    total size*/}
            <ButtonWithTooltip
                tooltip={`Total Size: ${totalFileMemoryStr}`}
                icon={'dashboard'}
                // text={totalFileMemoryStr}
            />

        </InsSectionHeader>
        {fileList.map((fileItem) =>
            <FileRegistryItemComp key={fileItem.path} fileItem={fileItem}/>
        )}
        {fileList.length === 0 &&
            <InsSectionItem
                text={'No blobs loaded'}
                icon={'info-sign'}
            />
        }

    </Card>
}


export function AssetRegistryItemComp({
    path,
    asset,
}: {
    path: string
    asset: AssetRegistryItem
}) {
    const [assetData, setAssetData] = useState<any>(null)
    const [assetRefs, setAssetRefs] = useState<AssetRefItem[]>(asset.refs.toArray())
    const manager = useManager()
    useEffect(() => {
        let mounted = true
        asset.pms.then((res) => {
            if (mounted) setAssetData(res)
        })
        return () => {
            mounted = false
        }
    })
    useEffect(() => {
        const l = () => {
            setAssetRefs(asset.refs.toArray())
        }
        asset.refs.on('add', l)
        asset.refs.on('delete', l)
        asset.refs.on('clear', l)
        return () => {
            asset.refs.off('add', l)
            asset.refs.off('delete', l)
            asset.refs.off('clear', l)
        }
    })
    const path2 = path.startsWith(assetUrlPrefix) ? path.slice(assetUrlPrefix.length) : path
    // return <div> {path} {assetData?.uuid || ''} </div>
    return <InsSectionItem
        text={decodeURI(path2.split('/').pop() || path2)}
        icon={iconForSelectionObject(assetData) || 'circle'}
        info={{text: path2, icon: 'link'}}
        buttons={[{
            text: `${assetRefs.length} References`,
            key: 'refCount',
            icon: 'people',
            intent: 'primary',
            onClick: async () => {
                // manager.unloadAsset(asset)
            }
        }, {
            text: `Type: ${assetData ? assetData.type || assetData.constructor?.name : 'Unknown'}`,
            key: 'type',
            icon: 'application',
            intent: 'primary',
        }, {
            text: `Log in Console`,
            key: 'log',
            icon: 'console',
            intent: 'primary',
            onClick: async () => {
                console.log(path, assetData)
            }
        },{
            text: 'Unload Asset', // todo only for dev, remove later
            key: 'unload',
            icon: 'trash',
            intent: 'warning',
            onClick: async () => {
                manager.unloadAsset(asset)
            }
        }]}
    />
    // return <RefSelectionObjectComponent object={assetData} disabled={true} allowNone={false}
    //                                     canSelect={true}
    //                                     />
}

export function FileRegistryItemComp({
    fileItem,
}: {
    fileItem: AssetRefItem
}) {
    const manager = useManager()
    const [lastUsed, setLastUsed] = useState<number>(fileItem.lastUsed)
    useEffect(() => {
        const l = () => {
            setLastUsed(fileItem.lastUsed)
        }
        fileItem.onUpdate.add(l)
        return () => {
            fileItem.onUpdate.delete(l)
        }
    }, [fileItem])
    const timeAgo = Date.now() - lastUsed
    const timeStr = timeAgo < 10000 ? 'just now' :
        timeAgo < 60000 ? `${Math.floor(timeAgo / 1000)} sec ago` :
            `${Math.floor(timeAgo / 60000)} min ago`
    const fileSize = fileItem.file.size
    const fileSizeStr = bytesToString(fileSize)

    return <InsSectionItem
        text={decodeURI(fileItem.path.split('/').pop() || fileItem.path)}
        icon={'document'}
        info={{text: fileItem.path, icon: 'link'}}
        buttons={[{
            // text: `Last Used: ${new Date(lastUsed).toLocaleString()}`,
            text: `Last Used: ${timeStr}`,
            key: 'lastUsed',
            icon: 'time',
            intent: 'primary',
            onClick: async () => {
                // manager.unloadAsset(asset)
            }
        }, {
            text: `File Size: ${fileSizeStr}`,
            key: 'fileSize',
            icon: 'dashboard',
            intent: 'primary',
            onClick: async () => {
                // manager.unloadAsset(asset)
            }
        }, {
            text: 'Revoke Blob',
            key: 'revoke',
            icon: 'trash',
            intent: 'warning',
            onClick: async () => {
                manager.fileTracker.removeFile(fileItem.path)
            }
        }]}
    />
}
