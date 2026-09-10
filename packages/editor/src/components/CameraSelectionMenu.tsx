import {FC, useEffect, useState} from "react";
import {Intent, Menu, MenuItem, MenuDivider} from "@blueprintjs/core";
import {EditModePlugin} from "../utils/EditModePlugin.ts";

import {useManager} from "../utils/UseManager.ts";

type CameraType = 'perspective' | 'orthographic' | 'default';

interface CameraSelectionMenuProps {
    currentCamera: CameraType;
    setCurrentCamera: (camera: CameraType) => void;
}

export const CameraSelectionMenu: FC<CameraSelectionMenuProps> = ({
    currentCamera,
    setCurrentCamera
}) => {
    const [_, forceUpdate] = useState(0);
    const manager = useManager()
    const editModePlugin = manager.get().getPlugin(EditModePlugin)!
    const viewer = manager.get()

    useEffect(() => {
        // Initial state
        forceUpdate(v => v + 1);
    }, [editModePlugin]);

    const selectCamera = (cameraType: CameraType) => {
        // todo use toggleCameraMode, add scene cameras also to cameraMode, by merging cameraType and cameraMode thing
        if (cameraType === 'default') {
            // Switch to default camera (scene camera)
            const defaultCamera = viewer.scene.defaultCamera;
            if (defaultCamera) {
                defaultCamera.activateMain();
                setCurrentCamera('default');
            }
        } else {
            // Switch to editor camera (perspective or orthographic)
            editModePlugin.cameraMode = cameraType;
            editModePlugin.setDirty();
            setCurrentCamera(cameraType);
        }
        forceUpdate(v => v + 1);
    };

    return (
        <Menu>
            <MenuDivider title="Editor Cameras" className={"context-menu-divider"} />
            <MenuItem
                text="Perspective"
                icon="eye-open"
                intent={currentCamera === 'perspective' ? Intent.PRIMARY : Intent.NONE}
                onClick={(e) => {
                    e.stopPropagation();
                    selectCamera('perspective');
                }}
                shouldDismissPopover={false}
            />
            <MenuItem
                text="Orthographic"
                icon="grid-view"
                intent={currentCamera === 'orthographic' ? Intent.PRIMARY : Intent.NONE}
                onClick={(e) => {
                    e.stopPropagation();
                    selectCamera('orthographic');
                }}
                shouldDismissPopover={false}
            />
            <MenuDivider title="Scene Cameras" className={"context-menu-divider"} />
            <MenuItem
                text="Default Camera"
                icon="camera"
                intent={currentCamera === 'default' ? Intent.PRIMARY : Intent.NONE}
                onClick={(e) => {
                    e.stopPropagation();
                    selectCamera('default');
                }}
                shouldDismissPopover={false}
            />
        </Menu>
    );
};
