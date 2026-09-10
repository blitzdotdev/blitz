import {bpUiConfigIcons, UiConfigRendererContext} from 'uiconfig-blueprint/lib/esm/lib'
import {IObject3D, Object3DGeneratorPlugin} from 'threepipe'
import React, {useCallback, useContext, useMemo} from 'react'
import {IconName, MenuDivider, MenuItem} from '@blueprintjs/core'
import {useManager} from "../utils/UseManager.ts";

const extraUiData: {
    [key: string]: {
        label: string,
        icon?: IconName | React.JSX.Element
    }
} = {
    'geometry': {
        label: 'Primitives',
        icon: 'shapes',
    },
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
    'troika': {
        label: 'Text (2D)',
        icon: 'font',
    },
    'object-empty': {
        label: 'Empty Object',
        icon: 'new-object',
    },
    'object-group': {
        label: 'Empty Group',
        icon: 'group-objects',
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
        <MenuDivider title="Create" className={"context-menu-divider"} />
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
