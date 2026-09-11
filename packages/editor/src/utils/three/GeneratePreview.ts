import {
    HemisphereLight,
    IMaterial,
    ImportResult,
    IObject3D,
    ITexture,
    MaterialPreviewGenerator,
    Scene,
    ThreeViewer
} from "threepipe";
import {refreshTexturePreview, staticData} from "./refreshTexturePreview.ts";

// todo wait for preframe?
export async function generatePreview(res: ImportResult, viewer: ThreeViewer) {
    let prev
    if (res.isTexture) {
        prev = await new Promise<string>((resolve) => {
            const preview = refreshTexturePreview(res as ITexture, viewer, (p) => {
                if (preview === staticData.loadingImage) resolve(p)
            })
            if (preview !== staticData.loadingImage) resolve(preview)
        })
    } else if (res.isMaterial) {
        const gen = new MaterialPreviewGenerator()
        await viewer.doOnce('preFrame')
        viewer.setDirty()
        prev = gen.generate(res as IMaterial, viewer.renderManager.renderer)
        gen.dispose()
    } else if (res.isObject3D) {
        let root
        const channel = 7
        // console.log(res, res.parent)
        if (res.parent) { // todo this should not be the case actually
            // check if in scene
            // root = viewer.scene
            // viewer.scene.children.push(res)
        } else {
            root = new Scene()
            // todo why is so big intensity req?
            const hemisphericLight = new HemisphereLight(0xffffff, 0x444444, 4)
            hemisphericLight.layers.set(channel)
            hemisphericLight.position.set(0, 10, 0)
            root.add(hemisphericLight)
            root.add(res as IObject3D)
            console.log(root)
        }
        // viewer.setDirty()
        // await viewer.doOnce('preFrame')
        // todo use a render target in snapObject
        // prev = snapObject(viewer.renderManager.renderer, res as IObject3D, root, channel, new Vector3(1,1,1).multiplyScalar(1.25))

        if (root && root !== viewer.scene) {
            root.remove(res as IObject3D)
            root.children.forEach(c => {
                const disposable = c as typeof c & {dispose?: () => void}
                disposable.dispose && disposable.dispose()
            })
            const disposableRoot = root as typeof root & {dispose?: () => void}
            disposableRoot.dispose && disposableRoot.dispose()
        }

    }
    return prev;
}
