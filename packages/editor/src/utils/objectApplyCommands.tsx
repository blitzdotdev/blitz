// @ts-nocheck -- reference commands are retained behind manager compatibility methods.
import {
    IMaterial,
    ImportResultExtras,
    IObject3D,
    ITexture,
    JSUndoManagerCommand1,
    ThreeViewer,
    UiObjectConfig
} from "threepipe";
import React, {ReactNode} from "react";
import {InsSectionHeader} from "../components/InsSectionHeader.tsx";
import {addAtIndex} from "./AddAtIndex.tsx";
import {Button} from "@blueprintjs/core";
import {dialogPopupCard} from "../components/PopupDialogCard.tsx";
import {ConfigObject} from "uiconfig-blueprint/lib/esm/lib";
import {ViewerInstanceManager} from "./ViewerInstanceManager.ts";
import {iconForSelectionObject} from "./icons.tsx";

export function objectCommand(source: IObject3D, target: IObject3D, newIndex = -1) {
    const cmd = {
        lastParent: target as IObject3D | null,
        lastIndex: newIndex as any,
        redo: () => {
            const lastParent = cmd.lastParent
            const lastIndex = cmd.lastIndex
            cmd.lastParent = source.parent
            cmd.lastIndex = source.parent?.children.indexOf(source) ?? -1
            // todo use attach if e?.shiftKey
            addAtIndex(source, lastParent, lastIndex);
            source.dispatchEvent({type: 'select', value: source, object: source, ui: true, bubbleToParent: true, trackUndo: false})
        },
        undo: () => {
            // console.log('undo', {...cmd})
            const {lastParent, lastIndex} = cmd
            cmd.lastParent = source.parent
            cmd.lastIndex = source.parent?.children.indexOf(source) ?? -1
            addAtIndex(source, lastParent, lastIndex);
            source.dispatchEvent({type: 'select', value: source, object: source, ui: true, bubbleToParent: true, trackUndo: false})
        },
    } satisfies JSUndoManagerCommand1 & {lastParent: IObject3D | null, lastIndex: number}
    return cmd;
}

export function materialCommand(material: IMaterial, target: IObject3D | IObject3D[], index?: number) {
    const targets = Array.isArray(target) ? target : [target]
    const cmd = {
        lastMaterials: [] as Array<IMaterial | IMaterial[] | null | undefined>,
        redo: () => {
            cmd.lastMaterials = targets.map((object) => {
                const previous = object.material
                if (index !== undefined && Array.isArray(previous)) {
                    const next = [...previous]
                    next[index] = material
                    object.material = next
                } else {
                    object.material = material
                }
                object.setDirty?.({change: 'material'})
                return previous
            })
        },
        undo: () => {
            const current = targets.map((object) => object.material)
            targets.forEach((object, targetIndex) => {
                const previous = cmd.lastMaterials[targetIndex]
                if (previous) object.material = previous
                object.setDirty?.({change: 'material'})
            })
            cmd.lastMaterials = current
        }
    } satisfies JSUndoManagerCommand1 & {lastMaterials: Array<IMaterial | IMaterial[] | null | undefined>}
    return cmd;
}

export function textureCommand(
    texture: ITexture,
    target: IObject3D | IMaterial,
    textureSlot: string = 'map',
    materialIndex = 0,
) {
    const getMaterial = () => {
        if ((target as IMaterial).isMaterial) return target as IMaterial
        const material = (target as IObject3D).material
        return Array.isArray(material) ? material[materialIndex] : material as IMaterial
    }
    const markTargetDirty = (material: IMaterial) => {
        if ((target as IObject3D).isObject3D) {
            ;(target as IObject3D).setDirty?.({change: 'material'})
        } else {
            material.appliedMeshes?.forEach((mesh) => mesh.setDirty?.({change: 'material'}))
        }
    }
    const cmd = {
        lastTexture: null as ITexture | null | undefined,
        redo: () => {
            const mat = getMaterial()
            if (!mat) return;
            cmd.lastTexture = (mat as any)[textureSlot];
            (mat as any)[textureSlot] = texture;
            mat.setDirty && mat.setDirty();
            markTargetDirty(mat)
        },
        undo: () => {
            const mat = getMaterial()
            if (!mat) return;
            const lastTexture = cmd.lastTexture;
            cmd.lastTexture = (mat as any)[textureSlot];
            (mat as any)[textureSlot] = lastTexture;
            mat.setDirty && mat.setDirty();
            markTargetDirty(mat)
        }
    } satisfies JSUndoManagerCommand1 & {lastTexture: ITexture | null | undefined}
    return cmd;
}

export function environmentCommand(
    texture: ITexture,
    viewer: ThreeViewer,
    final: boolean,
    manager: ViewerInstanceManager,
    applyTo: 'environment' | 'background' | 'both' = 'environment',
) {
    const cmd = {
        lastEnvironment: null as ITexture | null | undefined,
        lastBackground: null as unknown,
        dialogContent: undefined as React.ReactNode | undefined,
        timeoutId: undefined as number | undefined,
        redo: () => {
            if (applyTo === 'environment' || applyTo === 'both') {
                cmd.lastEnvironment = viewer.scene.environment as ITexture;
                viewer.scene.environment = texture;
            }
            if (applyTo === 'background' || applyTo === 'both') {
                cmd.lastBackground = viewer.scene.background
                viewer.scene.background = texture
            }
            viewer.scene.setDirty?.({change: applyTo})

            if(final) {
                let libInfo: ImportResultExtras['_libFileInfo']|undefined = undefined;
                const variants: UiObjectConfig[] = []
                let selectedVariant: UiObjectConfig|null = null;
                // Show popup with texture info
                if ((texture as ImportResultExtras)._libFileInfo) {
                    libInfo = (texture as ImportResultExtras)._libFileInfo;
                    console.log('Environment texture lib info:', libInfo);
                    if(libInfo?.polyhavenFiles){
                        if(libInfo.polyhavenFiles.hdri){
                            // move this to backend?
                            const sizes = Object.keys(libInfo.polyhavenFiles.hdri).filter(k=>/^\d+k$/.test(k))
                            for(const size of sizes){
                                const types = Object.keys(libInfo.polyhavenFiles.hdri[size])
                                for(const type of types){
                                    variants.push({
                                        label: `${size} ${type}`,
                                        value: libInfo.polyhavenFiles.hdri[size][type],
                                        uuid: `${size}-${type}`
                                    })
                                }
                            }
                        }
                        if(libInfo.polyhavenFiles.tonemapped){
                            variants.push({
                                label: `Tonemapped`,
                                value: libInfo.polyhavenFiles.tonemapped,
                                uuid: `tonemapped`
                            })
                        }
                        console.log(variants, libInfo.fileUrl)
                        selectedVariant = variants.find(v=>v.value.url === libInfo?.fileUrl) || null;
                    }
                }

                const onVariantChange = async (v: any) => {
                    selectedVariant = variants.find(va=>va.value === v) || null;

                    const url = selectedVariant?.value.url;
                    if(!url) return;
                    console.log('Changing environment variant to:', selectedVariant?.label);
                    // todo show loading, disable dropdown?
                    const texture = await manager.getAssetFromPath(url)
                    if(!texture || !texture.isTexture){
                        console.error('Failed to load environment texture from url:', url);
                    }else {
                        if (applyTo === 'environment' || applyTo === 'both') viewer.scene.environment = texture as ITexture;
                        if (applyTo === 'background' || applyTo === 'both') viewer.scene.background = texture as ITexture;
                    }
                }

                dialogPopupCard.setDialogContent(cmd, () => (
                    <>
                        <InsSectionHeader title={libInfo?.id || texture.name || "Environment Map"} icon={iconForSelectionObject(texture)}>
                            <Button
                                icon="cross"
                                variant="minimal"
                                size="small"
                                onClick={() => {
                                    dialogPopupCard.resetDialogContent(cmd);
                                }}
                            />
                        </InsSectionHeader>
                        {selectedVariant && <ConfigObject
                            key={'variations'}
                            config={{
                                type: 'dropdown',
                                label: 'Variations',
                                children: variants,
                                getValue: () => {return selectedVariant?.value || ''},
                                setValue: (v: string) => {
                                    onVariantChange(v)
                                }
                            }}
                            openPanel={()=>{}}
                            closePanel={()=>{}}
                        />}
                        {/*<div>*/}
                        {/*    Name - {texture.name || '(unnamed)'} <br/>*/}
                        {/*</div>*/}
                    </>
                ));
            }
        },
        undo: () => {
            if (applyTo === 'environment' || applyTo === 'both') {
                const lastEnv = cmd.lastEnvironment;
                cmd.lastEnvironment = viewer.scene.environment as ITexture;
                viewer.scene.environment = lastEnv ?? null;
            }
            if (applyTo === 'background' || applyTo === 'both') {
                const lastBackground = cmd.lastBackground
                cmd.lastBackground = viewer.scene.background
                viewer.scene.background = lastBackground as typeof viewer.scene.background
            }
            viewer.scene.setDirty?.({change: applyTo})

            // Clear the popup on undo only if it's showing this command's content
            dialogPopupCard.resetDialogContent(cmd);
        }
    } satisfies JSUndoManagerCommand1 & {lastEnvironment: ITexture | null | undefined, lastBackground: unknown, [k:string]: any}
    return cmd;
}
