import {AppToaster, bpUiConfigIcons, UiConfigRendererContext} from 'uiconfig-blueprint/lib/esm/lib'
import {useManager} from '../utils/ViewerInstanceManager.ts'
import {IObject3D, Object3DGeneratorPlugin} from 'threepipe'
import React, {useCallback, useContext, useMemo} from 'react'
import {IconName, MenuItem} from '@blueprintjs/core'
import {useListenProperty} from "./UseListenProperty.tsx";

const extraUiData: {
    [key: string]: {
        label: string,
        icon?: IconName | React.JSX.Element
    }
} = {
    'object': {
        label: 'Object',
        icon: 'new-object',
    },
    'camera': {
        label: 'Camera',
        icon: 'mobile-video',
    },
    'light': {
        label: 'Light',
        icon: 'lightbulb',
    },
    'geometry': {
        label: 'Primitives',
        icon: 'shapes',
    },
    'troika': {
        label: 'Text (2D)',
        icon: 'font',
    },
    'object-empty': {
        label: 'Empty Object',
        icon: 'new-object',
    },
    'camera-perspective': {
        label: 'Perspective',
        // icon: 'mobile-video',
        icon: bpUiConfigIcons['shape-trapezium-filled-mono-2']({style: {color: 'transparent'}}),
    },
    'camera-orthographic': {
        label: 'Orthographic',
        icon: bpUiConfigIcons['shape-cuboid-filled-mono-1']({style: {color: 'transparent'}}),
    },
    'light-point': {
        label: 'Point',
        icon: 'flash',
        // icon: bpUiConfigIcons['shape-diamond-filled-3']({style: {color: 'transparent'}, className: 'bp5-tree-node-icon-svg'}),
    },
    'light-ambient': {
        label: 'Ambient',
        icon: bpUiConfigIcons['shape-diamond-filled-mono-3']({style: {color: 'transparent'}, className: 'bp5-tree-node-icon-svg'}),
    },
    'light-directional': {
        label: 'Directional',
        icon: 'torch',
    },
    'light-spot': {
        label: 'Spot',
        icon: bpUiConfigIcons['shape-cone-filled-mono-2']({style: {color: 'transparent'}, className: 'bp5-tree-node-icon-svg'}),//'torch',
    },
    'light-hemisphere': {
        label: 'Hemisphere',
        icon: bpUiConfigIcons['shape-sphere-cut-filled-mono-1']({style: {color: 'transparent'}, className: 'bp5-tree-node-icon-svg'}),
    },
    'light-rect-area': {
        label: 'Rect Area',
        icon: 'rectangle',
    },
    'geometry-plane': {
        label: 'Plane',
        icon: 'square',
    },
    'geometry-sphere': {
        label: 'Sphere',
        icon: bpUiConfigIcons['shape-sphere-filled-mono-1']({style: {color: 'transparent'}}),
    },
    'geometry-box': {
        label: 'Cube / Box',
        icon: bpUiConfigIcons['shape-cube-filled-mono-1']({style: {color: 'transparent'}}),
    },
    'geometry-circle': {
        label: 'Circle',
        icon: 'full-circle',
    },
    'geometry-torus': {
        label: 'Torus',
        icon: bpUiConfigIcons['shape-torus-filled-mono']({style: {color: 'transparent'}}),
    },
    'geometry-cylinder': {
        label: 'Cylinder',
        icon: bpUiConfigIcons['shape-cylinder-filled-mono-1']({style: {color: 'transparent'}}),
    },
    'geometry-text': {
        label: 'Text (3D)',
        icon: 'font',
    },
    'geometry-line': {
        label: 'Line/Curve',
        icon: 'trending-up',
    },
    'troika-text-plane': {
        label: 'Text Plane',
        icon: 'font',
    },
}

export function Object3DGenerationMenu({onGenerate}: {onGenerate?: (obj: IObject3D)=>void}) {
    const manager = useManager()
    const generator = manager.get().getPlugin(Object3DGeneratorPlugin)!
    const uiConfigRenderer = useContext(UiConfigRendererContext)
    const items = useMemo(() => {
        const groups = {} as any
        // console.log(generator.generators)
        Object.keys(generator.generators).forEach(k => {
            const parts = k.split('-')
            const group = parts[0]
            const key = parts.slice(1).join('-')
            if(!groups[group]) {
                groups[group] = {
                    label: extraUiData[group]?.label || group,
                    icon: extraUiData[group]?.icon,
                    children: [],
                    uuid: group
                }
            }
            groups[group].children.push({
                label: extraUiData[k]?.label ?? key,
                icon: extraUiData[k]?.icon,
                uuid: k
            })
        })
        return Object.values(groups) as {label: string, icon?: IconName, children: {label: string, icon?: IconName, uuid: string}[], uuid: string}[]
    }, [generator, uiConfigRenderer])
    const onItemClick = useCallback((id: string) => {
        const obj =  generator.generate(id, {}, false, false)
        if(obj && onGenerate) onGenerate(obj)
    }, [generator])
    return <>
        {items.map((v) => <MenuItem
            key={v.uuid}
            text={v.label || '(unknown)'}
            icon={v.icon || undefined}
            popoverProps={{
                hoverOpenDelay: 150,
                hoverCloseDelay: 300,
            }}
            >
            {v.children.map((v) => <MenuItem
                key={v.uuid}
                text={v.label || '(unknown)'}
                icon={v.icon || undefined}
                onClick={() => onItemClick(v.uuid)}
                popoverProps={{
                    hoverOpenDelay: 150,
                    hoverCloseDelay: 0,
                }}
            />)}
        </MenuItem>)}
    </>
}

export function useOnObjectCreate() {
    const manager = useManager()
    // this is needed to rerender react
    const loadedProjectFile = useListenProperty(manager, 'loadedProjectFile', 'loadedProjectFileChange')
    const onObjectCreate = ((manager.loadedAssetObj as IObject3D)?.isObject3D || manager.loadedScene || !loadedProjectFile) ? (obj: IObject3D, root?: IObject3D) => {
        const scene = manager.get().scene
        if(!scene || !obj) return undefined
        if (manager.loadedAssetObj) {
            if ((manager.loadedAssetObj as IObject3D)?.isObject3D) {
                if(root){
                    let p = root
                    while(p && p !== scene.modelRoot && p !== manager.loadedAssetObj){
                        p = p.parent as IObject3D
                    }
                    if(p !== manager.loadedAssetObj){
                        AppToaster().show({
                            message: 'The selected root is not part of the loaded asset',
                            intent: 'warning',
                            icon: 'warning-sign',
                            timeout: 2000,
                            isCloseButtonShown: true,
                        });
                    }else {
                        root.add(obj)
                    }
                }else {
                    (manager.loadedAssetObj as IObject3D).add(obj)
                }
            } else {
                AppToaster().show({
                    message: 'Cannot create a new object in this file',
                    intent: 'warning',
                    icon: 'warning-sign',
                    timeout: 2000,
                    isCloseButtonShown: true,
                });
            }
        } else if (manager.loadedScene || !loadedProjectFile) {
            if(root && root !== scene.modelRoot)
                root.add(obj)
            else
                scene.addObject(obj)
        }

        obj?.parent && obj.dispatchEvent({type: 'select', value: obj, object: obj, ui: true})
        return obj?.parent
    } : null
    return onObjectCreate;
}
