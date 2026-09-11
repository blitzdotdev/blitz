import {
    CameraViewPlugin,
    OrbitControls3,
    OrthographicCamera2,
    PerspectiveCamera2,
    PickingPlugin,
    ThreeViewer,
    Vector3
} from "threepipe";

export function editorCameraController(plugin: {
    viewer: ThreeViewer | null | undefined,
    enableWASDMovement: boolean,
    wasdMovementSpeed: number,
    keyMap: { [key: string]: boolean },
    cameraMode: 'perspective' | 'orthographic',
    cameraPerspective: PerspectiveCamera2,
    cameraOrtho: OrthographicCamera2,
}) {
    const viewer = plugin.viewer
    if (!plugin.enableWASDMovement || !viewer) return
    // if()
    const camView = viewer.getPlugin(CameraViewPlugin)!
    if (camView.animating) return
    const picking = viewer.getPlugin(PickingPlugin)!
    const selected = picking.getSelectedObject()
    // if(plugin.keyMap.f && (selected as IObject3D)?.isObject3D){
    //     picking.focusObject((selected as IObject3D))
    // }
    if (selected && !plugin.keyMap.mouse0) return

    let needsUpdate = false
    let movementSpeed = plugin.wasdMovementSpeed
    // if (ev.shiftKey) movementSpeed *= 4
    // if (ev.ctrlKey) movementSpeed *= 0.25
    if (plugin.keyMap.shift) movementSpeed *= 4
    if (plugin.keyMap.control) movementSpeed *= 0.25

    // Get camera's local coordinate system
    const camera = plugin.cameraMode === 'perspective' ? plugin.cameraPerspective : plugin.cameraOrtho
    const controls = camera.controls as OrbitControls3
    if (!controls || !controls.enablePan || !controls.enabled) return

    const forward = new Vector3()
    const right = new Vector3()
    const up = new Vector3(0, 1, 0)

    // Calculate forward direction (camera looking direction)
    camera.getWorldDirection(forward)
    forward.normalize()

    // Calculate right direction (cross product of up and forward)
    right.crossVectors(up, forward)
    right.normalize()

    // Recalculate up to ensure orthogonal coordinate system
    up.crossVectors(forward, right)
    up.normalize()

    const deltaPosition = new Vector3()
    const deltaTarget = new Vector3()
    const deltaTarget2 = new Vector3()

    if (plugin.keyMap.w) {// Move forward
        deltaPosition.add(forward.clone().multiplyScalar(1))
        deltaTarget2.add(forward.clone().multiplyScalar(1))
        needsUpdate = true
    }
    if (plugin.keyMap.s) {// Move backward
        deltaPosition.add(forward.clone().multiplyScalar(-1))
        // deltaTarget2.add(forward.clone().multiplyScalar(-1))
        needsUpdate = true
    }
    if (plugin.keyMap.d) {// Move left
        deltaPosition.add(right.clone().multiplyScalar(-1))
        deltaTarget.add(right.clone().multiplyScalar(-1))
        needsUpdate = true
    }
    if (plugin.keyMap.a) {// Move right
        deltaPosition.add(right.clone().multiplyScalar(1))
        deltaTarget.add(right.clone().multiplyScalar(1))
        needsUpdate = true
    }
    if (plugin.keyMap.q) {// Move down
        deltaPosition.add(up.clone().multiplyScalar(-1))
        deltaTarget.add(up.clone().multiplyScalar(-1))
        needsUpdate = true
    }
    if (plugin.keyMap.e) {// Move up
        deltaPosition.add(up.clone().multiplyScalar(1))
        deltaTarget.add(up.clone().multiplyScalar(1))
        needsUpdate = true
    }

    if (needsUpdate) {
        deltaPosition.normalize().multiplyScalar(movementSpeed)
        deltaTarget2.add(deltaTarget).normalize().multiplyScalar(movementSpeed)
        deltaTarget.normalize().multiplyScalar(movementSpeed)
        // Move both camera and target to maintain relative positioning
        camera.position.add(deltaPosition)
        camera.target.add(deltaTarget)
        // (camera as ICamera).target?.add(deltaPosition)
        // if (updateTarget) camera.target.add(deltaPosition)

        const dir = camera.position.clone().sub(camera.target)
        const neg = dir.dot(forward) > 0
        // minDistance
        if (neg || dir.length() - deltaTarget.length() < controls.minDistance) {
            if (controls.autoPushTarget) {
                // camera.target.copy(camera.position).add(dir.clone().normalize().multiplyScalar(controls.minDistance))
                camera.target.sub(deltaTarget).add(deltaTarget2)
            } else {
                // prevent getting too close when not updating target
                camera.position.copy(camera.target.clone().add(dir.clone().normalize().multiplyScalar(controls.minDistance)))
            }
        } else {
            // maxDistance
            if (dir.length() + deltaPosition.length() > controls.maxDistance) {
                if (controls.autoPullTarget) {
                    // camera.target.add(deltaPosition)
                } else {
                    // prevent getting too far when not updating target
                    // camera.position.copy(camera.target.clone().add(dir.normalize().multiplyScalar(-plugin.maxDistance)))
                }
            }
        }
        // camera.lookAt(plugin.target)
        camera.setDirty && camera.setDirty({change: 'transform'})

        // Prevent browser scrolling and other default behaviors
        // ev.preventDefault()

        // Update the controls
        // plugin.update()
        // camera.refreshTarget && camera.refreshTarget()
    }
}
