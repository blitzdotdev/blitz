import {FC, useEffect, useState} from "react";
import {Intent, Menu, MenuItem, MenuDivider} from "@blueprintjs/core";
import {CameraType, EditModePlugin} from "../utils/EditModePlugin.ts";
import {ICamera, IObject3D, ThreeViewer} from "threepipe";

import {useManager} from "../utils/UseManager.ts";

interface CameraSelectionMenuProps {
    currentCamera: CameraType;
    setCurrentCamera: (camera: CameraType) => void;
}


// Function to get all cameras from the scene
const getSceneCameras = (viewer: ThreeViewer) => {
    const cameras: ICamera[] = [];
    viewer.scene.modelRoot.traverse((obj: IObject3D) => {
        if (obj.isCamera && typeof (obj as ICamera).activateMain === 'function') {
            cameras.push(obj as ICamera);
        }
    });
    return cameras;
};


export const CameraSelectionMenu: FC<CameraSelectionMenuProps> = ({
    currentCamera,
    setCurrentCamera
}) => {
    const [_, forceUpdate] = useState(0);
    const [sceneCameras, setSceneCameras] = useState<ICamera[]>([]);
    const manager = useManager()
    const editModePlugin = manager.get().getPlugin(EditModePlugin)!
    const viewer = manager.get()

    // Update scene cameras list
    const updateSceneCameras = () => {
        const cameras = getSceneCameras(viewer);
        setSceneCameras(cameras);
    };

    useEffect(() => {
        // Initial state
        updateSceneCameras();

        // Listen to scene hierarchy changes
        const handleSceneUpdate = (e: any) => {
            if (e.hierarchyChanged) {
                updateSceneCameras();
            }
        };

        viewer.scene.addEventListener('sceneUpdate', handleSceneUpdate);

        forceUpdate(v => v + 1);

        return () => {
            viewer.scene.removeEventListener('sceneUpdate', handleSceneUpdate);
        };
    }, [editModePlugin]);

    const selectCamera = (cameraType: CameraType) => {
        const success = editModePlugin.setCameraMode(cameraType);
        if (success) {
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
            {sceneCameras.length > 0 && sceneCameras.map(camera => (
                <MenuItem
                    key={camera.uuid}
                    text={camera.name || `Camera (${camera.type})`}
                    icon="camera"
                    intent={currentCamera === camera.uuid ? Intent.PRIMARY : Intent.NONE}
                    onClick={(e) => {
                        e.stopPropagation();
                        selectCamera(camera.uuid);
                    }}
                    shouldDismissPopover={false}
                />
            ))}
        </Menu>
    );
};
