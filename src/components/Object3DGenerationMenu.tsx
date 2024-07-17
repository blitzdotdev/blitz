import {bpUiConfigIcons} from '../../../uiconfig-blueprint/lib/esm/components/iconMapping'
import {useManager} from '../utils/ViewerInstanceManager.ts'
import {Object3DGeneratorPlugin} from 'threepipe'
import {useCallback, useContext, useMemo} from 'react'
import {UiConfigRendererContext} from '../../../uiconfig-blueprint/lib/esm/bpComponents/BPComponent'
import {IconName, MenuItem} from '@blueprintjs/core'

const extraUiData: any = {
    'camera': {
        label: 'Camera',
        icon: 'mobile-video' as IconName,
    },
    'light': {
        label: 'Light',
        icon: 'lightbulb' as IconName,
    },
    'geometry': {
        label: 'Primitives',
        icon: 'shapes' as IconName,
    },
    'camera-perspective': {
        label: 'Perspective',
        icon: 'mobile-video' as IconName,
    },
    'camera-orthographic': {
        label: 'Orthographic',
        icon: 'mobile-video' as IconName,
    },
    'light-point': {
        label: 'Point',
        icon: 'flash' as IconName,
    },
    'light-ambient': {
        label: 'Ambient',
        icon: 'lightbulb' as IconName,
    },
    'light-directional': {
        label: 'Directional',
        icon: 'flash' as IconName,
    },
    'light-spot': {
        label: 'Spot',
        icon: 'lightbulb' as IconName,
    },
    'light-hemisphere': {
        label: 'Hemisphere',
        icon: 'lightbulb' as IconName,
    },
    'light-rect-area': {
        label: 'Rect Area',
        icon: 'rectangle' as IconName,
    },
    'geometry-plane': {
        label: 'Plane',
        icon: 'square' as IconName,
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
        icon: 'full-circle' as IconName,
    },
    'geometry-torus': {
        label: 'Torus',
        icon: bpUiConfigIcons['shape-torus-filled-mono']({style: {color: 'transparent'}}),
    },
    'geometry-cylinder': {
        label: 'Cylinder',
        icon: bpUiConfigIcons['shape-cylinder-filled-mono-1']({style: {color: 'transparent'}}),
    },
}

export function Object3DGenerationMenu() {
    const manager = useManager()
    const generator = manager.get().getPlugin(Object3DGeneratorPlugin)!
    const uiConfigRenderer = useContext(UiConfigRendererContext)
    const items = useMemo(() => {
        const groups = {} as any
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
        return generator.generate(id, {})
    }, [generator])
    return <>
        {items.map((v) => <MenuItem
            key={v.uuid}
            text={v.label || '(unknown)'}
            icon={v.icon || undefined}
            >
            {v.children.map((v) => <MenuItem
                key={v.uuid}
                text={v.label || '(unknown)'}
                icon={v.icon || undefined}
                onClick={() => onItemClick(v.uuid)} />)}
        </MenuItem>)}
    </>
}
