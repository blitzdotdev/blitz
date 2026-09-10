import {Card} from "@blueprintjs/core";
import {ButtonWithTooltip} from "./ButtonWithTooltip.tsx";
import {InsSectionItem} from "./InsSectionItem.tsx";
import {InsSectionHeader} from "./InsSectionHeader.tsx";

export function MemoryTab({
  className,
}: {
    className?: string
}) {
    // AGREED-4: DevServerSource streams project bytes instead of retaining browser
    // File objects. The reference empty registry presentation remains unchanged.
    return <Card className={"bpInspectorCard " + className || ''} style={{borderRadius: 0}}>
        <InsSectionHeader title={"Loaded Assets"} icon={"package"}/>
        <InsSectionItem text={'No assets loaded'} icon={'info-sign'}/>

        <InsSectionHeader title={"Loaded Blobs"} icon={"database"}>
            <ButtonWithTooltip tooltip="Total Size: 0 B" icon={'dashboard'}/>
        </InsSectionHeader>
        <InsSectionItem text={'No blobs loaded'} icon={'info-sign'}/>
    </Card>
}
