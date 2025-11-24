import {FC, useEffect, useState} from "react";
import {Intent, Menu, MenuItem, MenuDivider} from "@blueprintjs/core";
import {EditModePlugin, OverrideMaterialType} from "../utils/EditModePlugin.ts";
import {useManager} from "../utils/ViewerInstanceManager.ts";

interface SceneOverrideMaterialMenuProps {
    // onStateChange?: (isActive: boolean) => void;
    currentMaterial: OverrideMaterialType | null;
    setCurrentMaterial: (material: OverrideMaterialType | null) => void;
}

export const SceneOverrideMaterialMenu: FC<SceneOverrideMaterialMenuProps> = ({currentMaterial, setCurrentMaterial}) => {
    const [_, forceUpdate] = useState(0);
    const manager = useManager()
    const editModePlugin = manager.get().getPlugin(EditModePlugin)!

    useEffect(() => {
        // Initial state
        forceUpdate(v => v + 1);
    }, [editModePlugin]);

    const applyMaterial = (materialType: OverrideMaterialType) => {
        // Apply new material
        editModePlugin.toggleSceneOverrideMaterial(materialType);
        setCurrentMaterial(materialType);
        forceUpdate(v => v + 1);
    };

    const clearMaterial = () => {
        if (editModePlugin['_sceneOverrideMaterial']) {
            editModePlugin.toggleSceneOverrideMaterial();
        }
        setCurrentMaterial(null);
        forceUpdate(v => v + 1);
    };

    const isActive = editModePlugin['_sceneOverrideMaterial'] !== null;

    // Get current UV channel if UV material is active
    const uvChannel = currentMaterial === 'uv' && editModePlugin['_sceneOverrideMaterial']
        ? (editModePlugin['_sceneOverrideMaterial'] as any).uvChannel
        : 0;

    return (
        <Menu>
            <MenuItem
                text="Off"
                icon="cross"
                intent={!isActive ? Intent.PRIMARY : Intent.NONE}
                onClick={(e) => {
                    e.stopPropagation();
                    clearMaterial();
                }}
                shouldDismissPopover={false}
            />
            <MenuDivider title="Material Type" className={"context-menu-divider"} />
            <MenuItem
                text="Unlit"
                icon="circle"
                intent={isActive && currentMaterial === 'basic' ? Intent.PRIMARY : Intent.NONE}
                onClick={(e) => {
                    e.stopPropagation();
                    applyMaterial('basic');
                }}
                shouldDismissPopover={false}
            />
            <MenuItem
                text="Depth"
                icon="layers"
                intent={isActive && currentMaterial === 'depth' ? Intent.PRIMARY : Intent.NONE}
                onClick={(e) => {
                    e.stopPropagation();
                    applyMaterial('depth');
                }}
                shouldDismissPopover={false}
            />
            <MenuItem
                text="Normal"
                icon="swap-vertical"
                intent={isActive && currentMaterial === 'normal' ? Intent.PRIMARY : Intent.NONE}
                onClick={(e) => {
                    e.stopPropagation();
                    applyMaterial('normal');
                }}
                shouldDismissPopover={false}
            />
            <MenuItem
                text="Normal World"
                icon="globe"
                intent={isActive && currentMaterial === 'normalWorld' ? Intent.PRIMARY : Intent.NONE}
                onClick={(e) => {
                    e.stopPropagation();
                    applyMaterial('normalWorld');
                }}
                shouldDismissPopover={false}
            />
            <MenuItem
                text="Material ID"
                icon="lightbulb"
                intent={isActive && currentMaterial === 'materialId' ? Intent.PRIMARY : Intent.NONE}
                onClick={(e) => {
                    e.stopPropagation();
                    applyMaterial('materialId');
                }}
                shouldDismissPopover={false}
            />
            <MenuItem
                text={currentMaterial === 'uv' ? `UV ${uvChannel}` : 'UV'}
                icon="grid-view"
                intent={isActive && currentMaterial === 'uv' ? Intent.PRIMARY : Intent.NONE}
                onClick={(e) => {
                    e.stopPropagation();
                    applyMaterial('uv');
                }}
                shouldDismissPopover={false}
            />
        </Menu>
    );
};
