import {TransformControls2} from "threepipe";
import {useEffect, useReducer, useState} from "react";
import {Intent, Menu, MenuDivider, MenuItem} from "@blueprintjs/core";

export function TransformControlsSettingsMenu({transformControls}: { transformControls: TransformControls2 }) {
    const [_, forceUpdate] = useState(0);

    useEffect(() => {
        const onChange = ()=>forceUpdate(v=>v+1);
        transformControls.addEventListener('mode-changed', onChange);
        transformControls.addEventListener('space-changed', onChange);
        transformControls.addEventListener('size-changed', onChange);
        return () => {
            transformControls.removeEventListener('mode-changed', onChange);
            transformControls.removeEventListener('space-changed', onChange);
            transformControls.removeEventListener('size-changed', onChange);
        }
    }, [transformControls]);

    return <Menu>
        <MenuDivider title="Mode" className={"context-menu-divider"}/>
        <MenuItem
            text="Translate"
            icon="move"
            intent={transformControls.mode === 'translate' ? Intent.PRIMARY : Intent.NONE}
            onClick={(e) => {
                e.stopPropagation()
                transformControls.mode = 'translate'
            }}
            shouldDismissPopover={false}
        />
        <MenuItem
            text="Rotate"
            icon="repeat"
            intent={transformControls.mode === 'rotate' ? Intent.PRIMARY : Intent.NONE}
            onClick={(e) => {
                e.stopPropagation()
                transformControls.mode = 'rotate'
            }}
            shouldDismissPopover={false}
        />
        <MenuItem
            text="Scale"
            icon="fullscreen"
            intent={transformControls.mode === 'scale' ? Intent.PRIMARY : Intent.NONE}
            onClick={(e) => {
                e.stopPropagation()
                transformControls.mode = 'scale'
            }}
            shouldDismissPopover={false}
        />
        <MenuDivider title="Space" className={"context-menu-divider"}/>
        <MenuItem
            text="World"
            icon="globe"
            intent={transformControls.space === 'world' ? Intent.PRIMARY : Intent.NONE}
            onClick={(e) => {
                e.stopPropagation()
                transformControls.space = 'world'
            }}
            shouldDismissPopover={false}
        />
        <MenuItem
            text="Local"
            icon="locate"
            intent={transformControls.space === 'local' ? Intent.PRIMARY : Intent.NONE}
            onClick={(e) => {
                e.stopPropagation()
                transformControls.space = 'local'
            }}
            shouldDismissPopover={false}
        />
        <MenuDivider title="Size" className={"context-menu-divider"}/>
        <MenuItem
            text="Increase"
            icon="plus"
            onClick={(e) => {
                e.stopPropagation()
                transformControls.size = transformControls.size + 0.1
            }}
            shouldDismissPopover={false}
        />
        <MenuItem
            text="Decrease"
            icon="minus"
            onClick={(e) => {
                e.stopPropagation()
                transformControls.size = Math.max(0.1, transformControls.size - 0.1)
            }}
            shouldDismissPopover={false}
        />
    </Menu>
}
