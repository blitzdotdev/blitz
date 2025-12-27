import {EntityComponentPlugin, EventDispatcher, PickingPlugin} from "threepipe";
import {resolveFile, settingsKey} from "./project.ts";
import {isPackageProject, ViewerInstanceManager} from "./ViewerInstanceManager.ts";

export class PlayModeHelper extends EventDispatcher<{
    runModePauseChange: {},
    // assetRegistryChange: {},
}> {

    isPausedRunning = false

    // todo make public readonly
    isRunningMode = false

    constructor(private manager: ViewerInstanceManager) {
        super()
    }

    async startRunMode() {
        const manager = this.manager
        // check if scene is loaded
        // save current scene to running.glb
        // load running.glb in play mode
        // set loadedNeedsSave = false
        if (!manager.loadedScene) return false
        if (!manager.loadedProjectFile) return false
        if (manager.savingScene) return false

        if (this.isRunningMode) {
            if (this.isPausedRunning) {
                await this.unpauseRunMode(true)
                return true
            }
            return true
        }

        const project = manager.loadedProject
        const isPackage = isPackageProject(project)
        if (!project || (isPackage && !project.handle)) return false

        await manager.editPreview.start()

        let load

        if (isPackage) {
            const filePath = `.${settingsKey}/running/${manager.editorId}.scene.glb` // todo delete file after run mode closed?

            try {
                const v = manager.get()
                const gltfMeta = v.scene.modelRoot.userData.gltfExtras?.resourcePath
                if (gltfMeta) delete v.scene.modelRoot.userData.gltfExtras.resourcePath

                const picking = v.getPlugin(PickingPlugin)
                const selected = picking?.getSelectedObject()?.uuid

                const res = await manager.exportScene('running', false, 'gltf')
                if (!res.file) {
                    // todo
                    throw new Error('Failed to export scene for run mode: ' + (res.error || 'Unknown error'))
                }

                const text = await (res.file as File).text()
                const gltfJson = JSON.parse(text)
                console.log('[Running Scene GLTF]', gltfJson)

                if (v.scene.modelRoot.userData.gltfExtras)
                    v.scene.modelRoot.userData.gltfExtras.resourcePath = gltfMeta

                manager._runningSceneFile = res.file

                // todo async write file and delete on stop (handle user stopping before write complete)
                // const saved = await manager.writeFile(project.handle, filePath, manager._runningSceneFile, project.path).catch(e => {
                //     console.error(e)
                //     return false
                // })
                // if (!saved) {
                //     // return {error: 'Failed to save scene file.'}
                //     throw new Error('Failed to save scene file for run mode')
                // }

                manager.unloadScene() // todo why do we need to unload and load the same thing again?
                load = async () => {
                    await manager.loadImport({
                        file: res.file, path: filePath,
                    }, project, true).catch(e => {
                        return {error: e.message}
                    })
                    if (picking && selected) {
                        const obj = v.object3dManager.getObject(selected)
                        if (obj) picking.setSelectedObject(obj)
                    }
                }
            } catch (e) {
                await manager.editPreview.stop()
                throw e
            }
        }

        console.clear && console.clear()
        this.isRunningMode = true
        manager.features.enable('physics', 'PlayingMode')
        manager.get().timeline.reset()

        if (load) await load()

        manager.get().timeline.start()
        manager.get().getPlugin(EntityComponentPlugin)!.start()
        return true
    }

    async pauseRunMode() {
        const manager = this.manager
        if (this.isPausedRunning) return
        this.isPausedRunning = true
        manager.get().timeline.stop()
        this.dispatchEvent({type: 'runModePauseChange'})
    }

    async unpauseRunMode(startTime = true) {
        const manager = this.manager
        if (!this.isPausedRunning) return
        this.isPausedRunning = false
        if (startTime) manager.get().timeline.start()
        this.dispatchEvent({type: 'runModePauseChange'})
    }

    async stopRunMode() {
        const manager = this.manager
        if (!this.isRunningMode) return false
        this.isRunningMode = false

        await this.unpauseRunMode(false)

        const project = manager.loadedProject
        const isPackage = isPackageProject(project)
        if (!project || (isPackage && !project.handle)) return false

        if (!manager.loadedProjectFile || !manager.loadedScene) return

        const v = manager.get()
        const picking = v.getPlugin(PickingPlugin)
        const selected = picking?.getSelectedObject()?.uuid

        v.getPlugin(EntityComponentPlugin)!.stop()

        if (isPackage) {
            manager.unloadScene()
        }

        manager.features.disable('physics', 'PlayingMode')

        await manager.editPreview.stop()

        v.timeline.stop()
        v.timeline.reset()

        if (isPackage) {
            const filePath = `.${settingsKey}/running/${manager.editorId}.scene.glb` // todo delete file after run mode closed?

            let tempFile = manager._runningSceneFile
            if (!tempFile) {
                // try to load from disk
                const file = await resolveFile(filePath, project.path, project.handle)
                if (file) tempFile = file as File
            }
            if (!tempFile) {
                console.error('No running scene file found, cannot reload scene.')
                return
            }
            // todo delete tempFile

            const res2 = await manager.loadImport({
                file: tempFile, path: filePath,
            }, project, true).catch(e => {
                return {error: e.message}
            })

            if (picking && selected) {
                const obj = v.object3dManager.getObject(selected)
                if (obj) picking.setSelectedObject(obj)
            }
        }

    }

}
