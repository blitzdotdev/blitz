// @ts-nocheck -- reference drop helper is retained behind the DevServerSource drop adapter.
import {
    AViewerPluginSync,
    Box3B,
    IMaterial,
    Intersection,
    IObject3D,
    ITexture,
    JSUndoManagerCommand1,
    Mesh,
    Raycaster,
    ThreeViewer,
    UndoManagerPlugin,
    Vector2,
    Vector3
} from 'threepipe';
import {
    ViewerInstanceManager
} from "./ViewerInstanceManager.ts";
import React from "react";
import {FileManifestEntry} from "./AssetsProvider.ts";
import {environmentCommand, materialCommand, objectCommand, textureCommand} from "./objectApplyCommands.tsx";
import {TExternalFile} from "../components/ExternalFilesPanel.tsx";
import {assetableFileTypes, isExternalObject, notAssetableFileTypes} from "./projectUtils.ts";

type DraggedItem = IMaterial | IObject3D | ITexture

function isEnvironmentTexture(texture: ITexture): boolean {
    // Check if it's a data texture with appropriate type and aspect ratio
    const tex = texture as any;

    // Check if it's a data texture
    if (!tex.isDataTexture) return false;

    // Check for half float or float type
    const isFloatType = tex.type === 1015 || tex.type === 1016; // HalfFloatType or FloatType
    if (!isFloatType) return false;

    // Check for 2:1 aspect ratio (environment map characteristic)
    const image = tex.image;
    if (!image || !image.width || !image.height) return false;

    const aspectRatio = image.width / image.height;
    const is2to1 = Math.abs(aspectRatio - 2.0) < 0.1; // Allow small tolerance

    return is2to1;
}

const draggingSpinner = document.createElement('div');
draggingSpinner.style.display = 'none'
// Create a transparent pixel
const transparentPixelCanvas = document.createElement('canvas');
transparentPixelCanvas.width = 1;
transparentPixelCanvas.height = 1;
// transparentPixelCanvas.style.display = 'none'
transparentPixelCanvas.style.position = 'absolute'
transparentPixelCanvas.style.zIndex = '-100'
transparentPixelCanvas.style.height = '1px'
transparentPixelCanvas.style.width = '1px'
// transparentPixelCanvas.style.height = '0'
document.body.appendChild(transparentPixelCanvas);

export class CanvasFileDropHandler extends AViewerPluginSync{
    private raycaster: Raycaster;
    private draggedItemSrc: DraggedItem | null = null;
    private draggedItem: DraggedItem | null = null;
    dropTarget: IObject3D | null | undefined = undefined; // undefined means not set yet, null means empty space
    // private previousMaterial: Material | null = null; // Store previous material for revert
    private previousCommand: JSUndoManagerCommand1 | null = null

    private itemCloneMap = new WeakMap<DraggedItem, DraggedItem>();
    toJSON: any = null

    public static readonly PluginType = 'CanvasFileDropHandler'
    enabled = true

    constructor(private manager: ViewerInstanceManager) {
        super()
        this.raycaster = new Raycaster();

        this.handleDragOver = this.handleDragOver.bind(this);
        this.handleDrop = this.handleDrop.bind(this);
        this.handleDragLeave = this.handleDragLeave.bind(this);


        // const draggingSpinner = document.createElement('div');
        draggingSpinner.className = 'native-spinner';
        document.body.appendChild(draggingSpinner);

        const style = document.createElement('style');
        style.textContent = `
.native-spinner {
  position: fixed;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 4px solid #66b;
  border-top-color: #eee;
  animation: native-spin 1s linear infinite;
  pointer-events: none;
  z-index: 10000;
  mix-blend-mode: difference;
}

@keyframes native-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
`;
        document.head.appendChild(style);

    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer);
        viewer.canvas.addEventListener('dragover', this.handleDragOver);
        viewer.canvas.addEventListener('drop', this.handleDrop);
        viewer.canvas.addEventListener('dragleave', this.handleDragLeave);
    }

    cloneItem(item: DraggedItem): DraggedItem | null {
        let clone: DraggedItem|null = this.itemCloneMap.get(item) || null
        if(clone) {
            return clone
        }
        const isAsset = !!(item.userData?.rootPath && item._tpRootPath && item._tpRootPath === item.userData.rootPath)
        if(!isAsset) {
            clone = item
        }else {
            if ((item as IMaterial).isMaterial) {
                clone = this.manager.cloneAssetMaterial(item as IMaterial)
            } else if ((item as IObject3D).isObject3D) {
                clone = this.manager.cloneAssetObject(item as IObject3D)
            } else if ((item as ITexture).isTexture) {
                clone = this.manager.cloneAssetTexture(item as ITexture)
            } else {
                console.error('CanvasFileDropHandler: Unsupported dragged item type:', item);
                clone = null
            }
        }
        // if(!clone) return
        if(clone) this.itemCloneMap.set(item, clone)
        return clone
    }

    public setDraggedItem(item: DraggedItem): void {
        if(this.draggedItemSrc === item) return // already dragging this item
        if(this.draggedItemSrc){
            this.clearDraggedItem()
        }
        this.draggedItemSrc = item;
        const clone = this.cloneItem(item)
        this.draggedItem = clone || null
    }

    public clearDraggedItem(used = false, source?: DraggedItem): void {
        if(source && source !== this.draggedItemSrc) return // not the source we are dragging

        this.clearDropTarget()
        this.dropTarget = undefined
        if(!used && this.draggedItem){

            if(this.draggedItem !== this.draggedItemSrc) { // if not cloned, we dont need to dispose here
                // todo object manager unregister?

                if ((this.draggedItem as IMaterial).isMaterial) {
                    (this.draggedItem as IMaterial).dispose(true)
                } else if ((this.draggedItem as IObject3D).isObject3D) {
                    this.draggedItem.dispose && this.draggedItem.dispose!(true)
                } else if ((this.draggedItem as ITexture).isTexture) {
                    (this.draggedItem as ITexture).dispose && (this.draggedItem as ITexture).dispose!()
                } else {
                    console.error('CanvasFileDropHandler: Unsupported dragged item type for dispose:', this.draggedItem);
                }

            }
        }
        if(this.draggedItemSrc){
            this.itemCloneMap.delete(this.draggedItemSrc)
            this.draggedItemSrc = null
            // todo unload asset, or that should happen automatically
        }
        this.draggedItem = null;
    }

    private draggingEntry: {path: string, isFSEntry: boolean} | TExternalFile | null = null

    handleDragStart = async (e: React.DragEvent, f: FileManifestEntry | TExternalFile | {path: string, isFSEntry: false}) => {
        if(this.draggingEntry) return // already dragging something
        this.draggingEntry = f
        draggingSpinner.style.display = 'block'
        e.dataTransfer.setData('text/uri-list', ' ');
        e.dataTransfer!.setDragImage(transparentPixelCanvas, 16, 16);
        // e.preventDefault();
        const r = await this.manager.getAssetFromEntry(f)
        if(!this.draggingEntry) return // drag was cancelled in the meantime
        draggingSpinner.style.display = 'none'
        if(!r) return
        // e.stopPropagation();
        // e.dataTransfer.setDragImage(img, xOffset, yOffset); // optional: set a custom drag image

        // Set the dragged item in the handler
        this.setDraggedItem(r);
        e.dataTransfer.clearData();
        e.dataTransfer.effectAllowed = 'copy';
        // const path = f.isFSEntry ? assetUrlPrefix+f.path : f.path
        // e.dataTransfer.setData('application/json', JSON.stringify({path}));
        e.dataTransfer.setData('text/uri-list', ' ');
    };

    handleDragEnd = (e?: React.DragEvent) => {
        draggingSpinner.style.display = 'none'
        this.draggingEntry = null
        this.clearDraggedItem();
        e?.dataTransfer.clearData();
    }

    private handleDragOver(e: DragEvent): void {
        if(!this._viewer) return
        if(e.dataTransfer?.files?.length || e.dataTransfer?.items?.[0]?.kind === 'file') return // for dropzone
        e.preventDefault();

        draggingSpinner.style.left = `${e.pageX - 16}px`;
        draggingSpinner.style.top = `${e.pageY - 18}px`;
        const intersects = this.getIntersects(e).filter(i=>i.object !== this.draggedItem);

        let res: boolean
        const effect = this.draggedItem === this.draggedItemSrc ? 'move' : 'copy'
        if (intersects.length > 0 && this.draggedItem) {
            const mesh = intersects[0].object as Mesh;
            res = this.setDropTarget(mesh as any, false, {intersects: intersects as any});
        } else {
            res = this.setDropTarget(null, false, {});
        }
        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = res ? effect : 'none';
        }
        const draggedItem = this.draggedItem as IObject3D
        if(res && draggedItem?.isObject3D) {
            this.updatePosition(draggedItem);
        }

    }

    private handleDrop(e: DragEvent): void {
        if(!this._viewer) return
        draggingSpinner.style.display = 'none'
        if(!this.draggedItem) return;

        if(e.dataTransfer?.files?.length) return // for dropzone

        e.preventDefault();
        const intersects = this.getIntersects(e).filter(i=>i.object !== this.draggedItem);

        const mesh = intersects?.[0]?.object as IObject3D;
        const draggedItem = this.draggedItem as IObject3D

        const res = this.setDropTarget(mesh||null, true, {intersects: intersects as any});

        if(res && draggedItem?.isObject3D) {
            this.updatePosition(draggedItem)
        }

        this.clearDraggedItem(true);
    }

    private handleDragLeave(): void {
        this.clearDropTarget();
        this.dropTarget = undefined;
    }

    private updatePosition(draggedItem: IObject3D & {_bounds?: Box3B}) {
        const cParent = draggedItem.parent

        // Dragging an object
        const intersect = this.lastIntersects?.[0];

        const positionWorld = intersect?.point.clone() ?? new Vector3(0, 0, 0)
        const normalWorld = (intersect?.normal?.clone() ?? new Vector3(0, 1, 0))
        if (intersect?.object) {
            intersect.object.updateMatrixWorld()
            normalWorld.transformDirection(intersect.object.matrixWorld)
        }
        normalWorld.normalize()

        draggedItem.position.set(0, 0, 0)
        const bounds = draggedItem._bounds ?? new Box3B().setFromObject(draggedItem);
        const size = bounds.getSize(new Vector3())
        const center = bounds.getCenter(new Vector3())
        const size1 = size.dot(normalWorld)
        const offset = normalWorld.clone().multiplyScalar(size1 * .5)
        positionWorld.add(offset)
        positionWorld.sub(center) // so that it stays above the ground, not centered at ground

        cParent?.worldToLocal(positionWorld);
        draggedItem.position.copy(positionWorld);
        draggedItem.setDirty && draggedItem.setDirty({change: 'position'})

        // this.draggedItem.lookAt(normalWorld.add(positionWorld)) // looks weird most of the time
    }

    execCommand(cmd: JSUndoManagerCommand1, final: boolean) {
        const undoManager = this._viewer?.getPlugin(UndoManagerPlugin)?.undoManager
        undoManager?.record(cmd)
        cmd.redo() // apply the command immediately
        this.previousCommand = !final ? cmd : null
    }

    private lastIntersects?: Array<Intersection<IObject3D>>

    dropAction(
        item: DraggedItem,
        mesh: IObject3D|null, final = false,
        options: {index?: number, intersects?: Array<Intersection<IObject3D>>}
    ){
        const assetRoot = this.manager.loadedScene ? this._viewer?.scene.modelRoot : this.manager.loadedAssetObj as IObject3D
        if(!this._viewer) return false // for types

        if(!assetRoot) return false
        if(!assetRoot.isObject3D) return false // it can be a loaded material or texture

        let inModelRoot = false
        let par = mesh
        while(par && !inModelRoot){
            if(par === assetRoot) inModelRoot = true
            par = par.parent as IObject3D
        }

        let usedItem = false;
        let cmd: JSUndoManagerCommand1 | null = null;
        let clearPrev = false

        // if(this.previousCommand) {
        //     this.undoPrevCommand()
        // }

        if ((item as IMaterial).isMaterial) {
            const draggedItem = item as IMaterial

            // if(this.previousMaterial) return false // already dragging over something else
            if(mesh && !mesh.material) return false // can't apply material, not a mesh or line
            if(!inModelRoot) return false // only allow dropping material on model root children

            const canDrop = true // todo check for isAsset, rootPath etc
            if(!canDrop) return false

            // Dragging a material
            // this.previousMaterial = mesh ? mesh.material : null;
            // mesh.material = draggedItem;

            if(mesh) {
                cmd = materialCommand(draggedItem, mesh)
                // this.execCommand(cmd, final)
            } else {
                // this.previousCommand = null
                clearPrev = true
            }

            if(final) {
                usedItem = true
            }
            // console.log('Hovering over (material):', {
            //     object: mesh.userData.name,
            //     objectId: mesh.userData.id,
            //     distance: intersects[0].distance.toFixed(2),
            //     draggedMaterial: draggedItem,
            // });
        } else if ((item as ITexture).isTexture) {
            const draggedItem = item as ITexture
            const isEnvMap = isEnvironmentTexture(draggedItem);

            // For environment maps, ignore mesh and apply to scene
            if (isEnvMap) {
                const canDrop = true // todo check for isAsset, rootPath etc
                if(!canDrop) return false

                // Dragging an environment texture
                cmd = environmentCommand(draggedItem, this._viewer, final, this.manager)
                // this.execCommand(cmd, final)

            } else {
                // Regular texture - apply to mesh material
                if(mesh && !mesh.material) return false // can't apply texture, not a mesh or line
                if(!inModelRoot) return false // only allow dropping texture on model root children

                const canDrop = true // todo check for isAsset, rootPath etc
                if(!canDrop) return false

                if(mesh) {
                    cmd = textureCommand(draggedItem, mesh, 'map')
                    // this.execCommand(cmd, final)
                } else {
                    // this.previousCommand = null
                    clearPrev = true
                }

            }

            if(final) {
                usedItem = true
            }

            // console.log('Hovering over (texture):', {
            //     object: mesh.userData.name,
            //     objectId: mesh.userData.id,
            //     distance: intersects[0].distance.toFixed(2),
            //     draggedTexture: draggedItem,
            // });
        } else if ((item as IObject3D).isObject3D) {
            const parent = !mesh
            || !inModelRoot
            || !isDraggableDroppableNode(mesh).droppable // todo this will always be false since we are passing a mesh
                ? assetRoot : mesh
            const draggedItem = item as IObject3D

            const canDrop = canDropNode(draggedItem, parent) // todo check for isAsset, rootPath etc
            if(!canDrop) return false

            const root = draggedItem.parent ?? this._viewer.scene as IObject3D

            if(!final) {
                if (draggedItem.parent !== root && draggedItem.parent !== parent) {
                    // root.add(draggedItem);
                    cmd = objectCommand(draggedItem, root, -1)
                    // this.execCommand(cmd, false)
                }
            }else {
                if (draggedItem.parent !== parent || options.index !== undefined) {
                    cmd = objectCommand(draggedItem, parent, options.index)
                    // this.execCommand(cmd, true)

                    usedItem = true
                }
            }
            // console.log('Hovering over (object):', {
            //     object: mesh.userData.name,
            //     objectId: mesh.userData.id,
            //     distance: intersects[0].distance.toFixed(2),
            //     draggedObject: draggedItem,
            // });
        }

        return {usedItem, clearPrev, cmd}

    }

    setDropTarget(mesh: IObject3D|null, final = false, options: {index?: number, intersects?: Array<Intersection<IObject3D>>}) {
        this.lastIntersects = options.intersects || undefined

        if(!this.draggedItem) return false

        if(this.dropTarget === mesh && !final) return true // already highlighted

        if(this.dropTarget !== mesh) {
            this.clearDropTarget();
        }

        const r = this.dropAction(this.draggedItem, mesh, final, options)
        if(r){
            const {usedItem, clearPrev, cmd} = r
            if(this.previousCommand) {
                this.undoPrevCommand()
            }
            if(cmd) {
                this.execCommand(cmd, final)
            }
            if(clearPrev) {
                this.previousCommand = null
            }
            if(usedItem) {
                this.clearDraggedItem(true);
            }
            this.dropTarget = mesh;
            return true
        }
        return false
    }

    private getIntersects(e: DragEvent) {
        if(!this._viewer) return []
        const camera = this._viewer.scene.mainCamera
        const objects = [...this._viewer.scene.modelRoot.children, ...this._viewer.scene.children.filter(c => c.userData.isGroundMesh)]

        const mouse = this.getMousePosition(e);
        this.raycaster.setFromCamera(mouse, camera);
        const intersects = this.raycaster.intersectObjects(objects);
        return intersects;
    }

    private clearDropTarget(): void {
        // If a material was set, revert it
        // if (this.previousMaterial) {
        //     if (this.dropTarget) {
        //         this.dropTarget.material = this.previousMaterial;
        //     }
        //     this.previousMaterial = null;
        // }
        this.undoPrevCommand();
        this.dropTarget = null;
    }

    private undoPrevCommand() {
        if(!this.previousCommand) return
        const undoManager = this._viewer?.getPlugin(UndoManagerPlugin)?.undoManager
        // todo pop
        this.previousCommand.undo()
        this.previousCommand = null
    }

    onRemove(viewer: ThreeViewer) {
        viewer.canvas.removeEventListener('dragover', this.handleDragOver);
        viewer.canvas.removeEventListener('drop', this.handleDrop);
        viewer.canvas.removeEventListener('dragleave', this.handleDragLeave);
        super.onRemove(viewer);
    }

    canDragFile(f: { path: string, type?: 'file'|'directory' }): boolean {
        if(f.type && f.type !== 'file') return false
        // todo use isLoadableFile?
        return !notAssetableFileTypes.some(e=>f.path.endsWith(e)) // not a scene or something
            && assetableFileTypes.some(e=>f.path.endsWith(e)) // its a model, material, etc
    }

    private getMousePosition(event: DragEvent): Vector2 {
        if(!this._viewer?.canvas) return new Vector2()
        const rect = this._viewer.canvas.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        return new Vector2(x, y);
    }

}

export function isDraggableDroppableNode(obj: IObject3D){
    // isComponent means isComponentInstance
    // AGREED-4: registered dropped roots remain ordinary top-level objects in
    // the reference hierarchy; only their persisted transport is different.
    const isComponent = !obj.userData.blitzImportedInstance && obj.userData.rootPath && (obj.userData.sProperties || obj._sChildren)
    const isExternal = isExternalObject(obj)
    const isGroup = !obj.isMesh && !obj.material && !obj.isLine && !obj.isPoints && !obj.isCamera && !obj.isLight && !obj.isWidget // groups, lights, cameras, helpers, etc
    const droppable = !isExternal && !isComponent && isGroup
    const draggable = !isExternal
    return {isComponent, isExternal, isGroup, droppable, draggable}
}

export function canDropNode(source: IObject3D, target: IObject3D, index?: number) {
    const noTypes = [ 'Mesh', 'Line', 'Points' ]
    if (noTypes.includes(target.type)) return false
    let compatible = true
    target.traverseAncestors(c=>c.id === source!.id && (compatible = false))
    if(!compatible) return false // source is an ancestor of target

    if(!isDraggableDroppableNode(target).droppable) return false
    if(!isDraggableDroppableNode(source).draggable) return false

    // target ancestor of source
    // source.traverseAncestors(c=>c.id === target!.id && (compatible = false))
    if(source.parent === target){
        if(index !== undefined && target.children.indexOf(source) !== index) return true
        else return true // still return true evem if indx is the same
    }else if(index === undefined) {
        // if no index is given, we can drop it anywhere
        return true
    }
    return true
}
