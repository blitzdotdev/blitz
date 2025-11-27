import {FC, useEffect, useState} from "react";
import {Intent, Menu, MenuItem, MenuDivider} from "@blueprintjs/core";
import {EditModePlugin, OverrideMaterialType, OverrideLightingType} from "../utils/EditModePlugin.ts";
import {useManager} from "../utils/ViewerInstanceManager.ts";

interface SceneOverrideMaterialMenuProps {
    // onStateChange?: (isActive: boolean) => void;
    currentMaterial: OverrideMaterialType | null;
    setCurrentMaterial: (material: OverrideMaterialType | null) => void;
    currentLighting: OverrideLightingType | null;
    setCurrentLighting: (lighting: OverrideLightingType | null) => void;
}

export const SceneOverrideMaterialMenu: FC<SceneOverrideMaterialMenuProps> = ({
    currentMaterial,
    setCurrentMaterial,
    currentLighting,
    setCurrentLighting
}) => {
    const [_, forceUpdate] = useState(0);
    const manager = useManager()
    const editModePlugin = manager.get().getPlugin(EditModePlugin)!

    useEffect(() => {
        // Initial state
        forceUpdate(v => v + 1);
    }, [editModePlugin]);

    const applyMaterial = (materialType: OverrideMaterialType) => {
        // Clear lighting first if active
        if (currentLighting !== null) {
            editModePlugin.setSceneOverrideLighting(null);
            setCurrentLighting(null);
        }
        // Apply new material
        editModePlugin.setSceneOverrideMaterial(materialType);
        setCurrentMaterial(materialType);
        forceUpdate(v => v + 1);
    };

    const clearAll = () => {
        // Clear both material and lighting
        if (editModePlugin.sceneOverrideMaterial) {
            editModePlugin.setSceneOverrideMaterial();
        }
        if (currentLighting !== null) {
            editModePlugin.setSceneOverrideLighting(null);
        }
        setCurrentMaterial(null);
        setCurrentLighting(null);
        forceUpdate(v => v + 1);
    };

    const applyLighting = (lightingType: OverrideLightingType) => {
        // Clear material first if active
        if (currentMaterial !== null) {
            editModePlugin.setSceneOverrideMaterial(null);
            setCurrentMaterial(null);
        }
        // Apply new lighting
        editModePlugin.setSceneOverrideLighting(lightingType);
        setCurrentLighting(lightingType);
        forceUpdate(v => v + 1);
    };

    const isActive = editModePlugin.sceneOverrideMaterial !== null;
    const isLightingActive = currentLighting !== null;
    const isAnyActive = isActive || isLightingActive;

    // Get current UV channel if UV material is active
    const uvChannel = currentMaterial === 'uv' && editModePlugin.sceneOverrideMaterial
        ? (editModePlugin.sceneOverrideMaterial as any).uvChannel
        : 0;

    return (
        <Menu>
            <MenuItem
                text="Off"
                icon="cross"
                intent={!isAnyActive ? Intent.PRIMARY : Intent.NONE}
                onClick={(e) => {
                    e.stopPropagation();
                    clearAll();
                }}
                shouldDismissPopover={false}
            />
            <MenuDivider title="Override Lighting" className={"context-menu-divider"} />
            <MenuItem
                text="Day"
                icon="flash"
                intent={isLightingActive && currentLighting === 'day' ? Intent.PRIMARY : Intent.NONE}
                onClick={(e) => {
                    e.stopPropagation();
                    applyLighting('day');
                }}
                shouldDismissPopover={false}
            />
            <MenuItem
                text="Night"
                icon="moon"
                intent={isLightingActive && currentLighting === 'night' ? Intent.PRIMARY : Intent.NONE}
                onClick={(e) => {
                    e.stopPropagation();
                    applyLighting('night');
                }}
                shouldDismissPopover={false}
            />
            <MenuItem
                text="Studio"
                icon="camera"
                intent={isLightingActive && currentLighting === 'studio' ? Intent.PRIMARY : Intent.NONE}
                onClick={(e) => {
                    e.stopPropagation();
                    applyLighting('studio');
                }}
                shouldDismissPopover={false}
            />
            <MenuItem
                text="None"
                icon="disable"
                intent={isLightingActive && currentLighting === 'none' ? Intent.PRIMARY : Intent.NONE}
                onClick={(e) => {
                    e.stopPropagation();
                    applyLighting('none');
                }}
                shouldDismissPopover={false}
            />
            <MenuDivider title="Override Material" className={"context-menu-divider"} />
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
