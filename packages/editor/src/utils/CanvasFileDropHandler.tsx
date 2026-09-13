// @ts-nocheck -- reference drop helper is retained behind the DevServerSource drop adapter.
import {
    AViewerPluginSync,
    Box3B,
    IMaterial,
    Intersection,
    IObject3D,
    ITexture,
    JSUndoManagerCommand1,
    PickingPlugin,
    Raycaster,
    SelectionObject,
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
import {cloneAssetItem} from "./AssetTracker.ts";
import {requestLibraryDropDialog, type LibraryDropActionOption} from '../components/LibraryDropDialog.tsx'
import {
    getLibraryDropChoice,
    setLibraryDropChoice,
    type LibraryDropAssetType,
    type LibraryDropChoice,
} from './libraryDropChoices.ts'

type DraggedItem = IMaterial | IObject3D | ITexture
type LibraryEntry = FileManifestEntry | TExternalFile | {path: string, name?: string, assetType?: string, isFSEntry: false}

const textureSlots: LibraryDropActionOption[] = [
    {id: 'map', label: 'Base color'},
    {id: 'normalMap', label: 'Normal'},
    {id: 'roughnessMap', label: 'Roughness'},
    {id: 'metalnessMap', label: 'Metalness'},
    {id: 'emissiveMap', label: 'Emissive'},
    {id: 'aoMap', label: 'Occlusion'},
]

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
            if ((item as IMaterial).isMaterial || (item as IObject3D).isObject3D || (item as ITexture).isTexture) {
                clone = cloneAssetItem(item)
                delete clone._tpRootPath
                if ((clone as IObject3D).isObject3D) {
                    delete (clone as IObject3D)._tpRootUid
                    ;(clone as IObject3D)._sChildren ||= []
                }
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

    private draggingEntry: LibraryEntry | null = null
    private libraryImport: Promise<DraggedItem> | null = null
    private dropLanded = false

    handleDragStart = async (e: React.DragEvent, f: LibraryEntry) => {
        if(this.libraryImport) return // already dragging something
        this.draggingEntry = f
        draggingSpinner.style.display = 'block'
        e.dataTransfer.setData('text/uri-list', ' ');
        e.dataTransfer!.setDragImage(transparentPixelCanvas, 16, 16);
        // e.preventDefault();
        const libraryImport = this.manager.getAssetFromEntry(f).then((item) => {
            if (!item) throw new Error('No supported asset was loaded.')
            return item as DraggedItem
        })
        this.libraryImport = libraryImport
        this.dropLanded = false
        let loaded = false
        try {
            const item = await libraryImport
            if (this.libraryImport !== libraryImport) return
            this.setDraggedItem(item);
            loaded = true
        } catch (error) {
            console.error(`Unable to import library asset ${f.name || this.fileName(f.path)}`, error)
        } finally {
            if (this.libraryImport === libraryImport) {
                draggingSpinner.style.display = 'none'
                if (!loaded && !this.dropLanded) {
                    this.libraryImport = null
                    this.draggingEntry = null
                }
            }
        }
        // e.stopPropagation();
        // e.dataTransfer.setDragImage(img, xOffset, yOffset); // optional: set a custom drag image

        e.dataTransfer.clearData();
        e.dataTransfer.effectAllowed = 'copy';
        // const path = f.isFSEntry ? assetUrlPrefix+f.path : f.path
        // e.dataTransfer.setData('application/json', JSON.stringify({path}));
        e.dataTransfer.setData('text/uri-list', ' ');
    };

    handleDragEnd = (e?: React.DragEvent) => {
        if (this.dropLanded) {
            e?.dataTransfer.clearData();
            return
        }
        draggingSpinner.style.display = 'none'
        this.libraryImport = null
        this.dropLanded = false
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

        const effect = this.draggedItem === this.draggedItemSrc ? 'move' : 'copy'
        this.lastIntersects = intersects as Array<Intersection<IObject3D>>
        this.dropTarget = intersects[0]?.object as IObject3D || null
        const res = Boolean(this.draggedItem || this.libraryImport)
        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = res ? effect : 'none';
        }

    }

    private async handleDrop(e: DragEvent): Promise<void> {
        if(!this._viewer) return
        if(e.dataTransfer?.files?.length) return // for dropzone
        const libraryImport = this.libraryImport
        if(!this.draggedItem && !libraryImport) return;

        e.preventDefault();
        if (libraryImport) this.dropLanded = true
        const intersects = this.getIntersects(e)
        const entry = this.draggingEntry

        try {
            const imported = this.draggedItem || await libraryImport
            if (!imported || (libraryImport && (this.libraryImport !== libraryImport || !this.dropLanded))) return
            if (!this.draggedItem) this.setDraggedItem(imported)
            const item = this.draggedItem
            if (!item) return
            const filteredIntersects = intersects.filter(({object}) => object !== item)

            const mesh = filteredIntersects[0]?.object as IObject3D;
            const dropPosition = (item as IObject3D).isObject3D
                ? this.getDroppedObjectWorldPosition(item as IObject3D, filteredIntersects as Array<Intersection<IObject3D>>)
                : undefined

            this.dropLibraryItem(item, entry, mesh || null, dropPosition)

            this.clearDraggedItem(true);
        } catch {
            return
        } finally {
            if (!libraryImport || (this.libraryImport === libraryImport && this.dropLanded)) {
                draggingSpinner.style.display = 'none'
                this.libraryImport = null
                this.dropLanded = false
                this.draggingEntry = null
            }
        }
    }

    private handleDragLeave(): void {
        this.clearDropTarget();
        this.dropTarget = undefined;
    }

    private getDroppedObjectWorldPosition(
        draggedItem: IObject3D & {_bounds?: Box3B},
        intersects: Array<Intersection<IObject3D>>,
    ) {
        const intersect = intersects[0]
        if (!intersect) return undefined

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

        return positionWorld
    }

    dropLibraryItem(
        item: DraggedItem,
        entry: LibraryEntry | null,
        hit: IObject3D | null,
        dropPosition?: Vector3,
    ) {
        if (!this._viewer) return false
        const assetRoot = this.manager.loadedScene ? this._viewer.scene.modelRoot : this.manager.loadedAssetObj as IObject3D
        if (!assetRoot?.isObject3D) return false

        const assetType = this.libraryAssetType(item, entry)
        const assetName = entry?.name || item.name || this.fileName(entry?.path) || 'Library asset'
        const selected = this._viewer.getPlugin(PickingPlugin)?.getSelectedObject() || null
        const selectedTarget = this.validSelectedTarget(selected)
        const cursorTarget = hit && this.isInAssetRoot(hit, assetRoot) ? hit : null
        const target = selectedTarget || cursorTarget || assetRoot
        const targetName = target === assetRoot ? 'Scene root' : target.name || target.uuid || 'Unnamed object'
        const targetDescription = selectedTarget
            ? (selectedTarget.isMaterial ? 'The selected material was used.' : 'The selected hierarchy object was used.')
            : cursorTarget
                ? 'No hierarchy selection was available. The object under the cursor was used.'
                : 'No hierarchy selection or object under the cursor was available. The scene root was used.'

        let actions: LibraryDropActionOption[] = []
        let defaultAction = 'import-only'
        let reason: string | undefined
        let materialTargets: IObject3D[] = []
        let materialOptions: Array<{index: number, name: string}> | undefined

        if (assetType === 'model') {
            const objectTarget = (target as IObject3D).isObject3D ? target as IObject3D : assetRoot
            if (objectTarget !== assetRoot) {
                actions.push({id: 'model-target', label: `Add under ${targetName}`})
                defaultAction = 'model-target'
            }
            actions.push({id: 'model-root', label: 'Add at the scene root'})
            if (defaultAction === 'import-only') defaultAction = 'model-root'
        } else if (assetType === 'material') {
            const objectTarget = (target as IObject3D).isObject3D ? target as IObject3D : null
            if (objectTarget?.material) {
                materialTargets = [objectTarget]
                actions = [{id: 'material-apply', label: `Apply to ${targetName}`}]
                defaultAction = 'material-apply'
            } else if (objectTarget) {
                objectTarget.traverse((object) => {
                    const candidate = object as IObject3D
                    if (candidate.material) materialTargets.push(candidate)
                })
                if (materialTargets.length) {
                    actions = [{
                        id: 'material-apply',
                        label: `Apply to the ${materialTargets.length} meshes under ${targetName}`,
                    }]
                    defaultAction = 'material-apply'
                }
            }
            if (!materialTargets.length) {
                actions = [{id: 'import-only', label: 'Import into the project only'}]
                reason = `${targetName} does not contain a mesh that can accept a material.`
            }
        } else if (assetType === 'texture') {
            if ((target as IMaterial).isMaterial) {
                actions = [{id: 'texture-apply', label: `Apply to ${targetName}`}]
                defaultAction = 'texture-apply'
            } else if ((target as IObject3D).isObject3D && (target as IObject3D).material) {
                const materials = Array.isArray((target as IObject3D).material)
                    ? (target as IObject3D).material as IMaterial[]
                    : [(target as IObject3D).material as IMaterial]
                materialOptions = materials.map((material, index) => ({
                    index,
                    name: material?.name || `Unnamed material ${index + 1}`,
                }))
                actions = [{id: 'texture-apply', label: `Apply to ${targetName}`}]
                defaultAction = 'texture-apply'
            } else {
                actions = [{id: 'import-only', label: 'Import into the project only'}]
                reason = `${targetName} cannot accept a texture because it has no material.`
            }
        } else {
            actions = [
                {id: 'environment', label: 'Set as scene environment'},
                {id: 'background', label: 'Set as background'},
                {id: 'both', label: 'Both'},
            ]
            defaultAction = 'environment'
        }

        const performChoice = (choice: LibraryDropChoice & {materialIndex?: number}) => {
            if (choice.action === 'import-only') return true
            if (choice.action === 'model-target' || choice.action === 'model-root') {
                const requestedParent = choice.action === 'model-root' ? assetRoot : target
                const parent = (requestedParent as IObject3D).isObject3D
                    && this.isInScene(requestedParent as IObject3D)
                    ? requestedParent as IObject3D
                    : assetRoot
                if (dropPosition) {
                    parent.updateMatrixWorld()
                    ;(item as IObject3D).position.copy(parent.worldToLocal(dropPosition.clone()))
                    ;(item as IObject3D).setDirty?.({change: 'position'})
                }
                this.execCommand(objectCommand(item as IObject3D, parent), true)
                return true
            }
            if (choice.action === 'material-apply' && materialTargets.length) {
                this.execCommand(materialCommand(item as IMaterial, materialTargets), true)
                return true
            }
            if (choice.action === 'texture-apply') {
                const textureTarget = (target as IMaterial).isMaterial
                    ? target as IMaterial
                    : target as IObject3D
                const slot = textureSlots.some(({id}) => id === choice.slot) ? choice.slot : 'map'
                this.execCommand(textureCommand(item as ITexture, textureTarget, slot, choice.materialIndex || 0), true)
                return true
            }
            if (assetType === 'environment' && ['environment', 'background', 'both'].includes(choice.action)) {
                this.execCommand(environmentCommand(
                    item as ITexture,
                    this._viewer!,
                    true,
                    this.manager,
                    choice.action as 'environment' | 'background' | 'both',
                ), true)
                return true
            }
            return false
        }

        const remembered = getLibraryDropChoice(assetType)
        if (remembered && actions.some(({id}) => id === remembered.action)) {
            return performChoice(remembered)
        }

        return requestLibraryDropDialog({
            assetName,
            assetType,
            targetName: assetType === 'environment' ? 'Scene' : targetName,
            targetDescription: assetType === 'environment'
                ? 'Environment maps target the scene.'
                : targetDescription,
            reason,
            actions,
            defaultAction,
            slots: assetType === 'texture' && defaultAction === 'texture-apply' ? textureSlots : undefined,
            materials: materialOptions,
            onApply: (choice, remember) => {
                if (!performChoice(choice)) return
                if (remember) setLibraryDropChoice(assetType, {action: choice.action, slot: choice.slot})
            },
        })
    }

    private libraryAssetType(item: DraggedItem, entry: LibraryEntry | null): LibraryDropAssetType {
        const extension = (entry?.path || '').split(/[?#]/)[0].split('.').pop()?.toLowerCase()
        if (entry?.assetType === 'hdri' || extension === 'hdr' || extension === 'exr') return 'environment'
        if ((item as IObject3D).isObject3D) return 'model'
        if ((item as IMaterial).isMaterial) return 'material'
        return 'texture'
    }

    private validSelectedTarget(selected: SelectionObject): SelectionObject {
        if (!selected) return null
        if (selected === this._viewer?.scene) return this._viewer.scene.modelRoot
        if ((selected as IObject3D).isObject3D) {
            return this.isInScene(selected as IObject3D) ? selected : null
        }
        return selected
    }

    private isInScene(object: IObject3D) {
        let current: IObject3D | null = object
        while (current) {
            if (current === this._viewer?.scene) return true
            current = current.parent as IObject3D | null
        }
        return false
    }

    private isInAssetRoot(object: IObject3D, assetRoot: IObject3D) {
        let current: IObject3D | null = object
        while (current) {
            if (current === assetRoot) return true
            current = current.parent as IObject3D | null
        }
        return false
    }

    private fileName(path?: string) {
        if (!path) return ''
        try {
            return new URL(path, window.location.href).pathname.split('/').pop() || ''
        } catch {
            return path.split('/').pop() || ''
        }
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

    canDragFile(f: {path: string, type?: 'file' | 'directory', assetType?: string}): boolean {
        if(f.type && f.type !== 'file') return false
        if (f.assetType && ['model', 'material', 'texture', 'hdri'].includes(f.assetType)) return true
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
    const isComponent = !obj.userData.kite3dImportedInstance && obj.userData.rootPath && (obj.userData.sProperties || obj._sChildren)
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
