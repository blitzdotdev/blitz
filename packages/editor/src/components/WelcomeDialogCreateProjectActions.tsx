import {useRef} from 'react'
import {Alignment, Button, Colors, Icon} from '@blueprintjs/core'
import {useManagerVersion} from '../utils/UseManager.ts'

export function WelcomeDialogCreateProjectActions(props: {
    alignText?: Alignment
    minimal?: boolean
    outlined?: boolean
}) {
    const manager = useManagerVersion()
    const input = useRef<HTMLInputElement>(null)
    const variant = props.minimal ? 'minimal' : props.outlined ? 'outlined' : 'solid'

    return <>
        <input
            ref={input}
            type="file"
            hidden
            multiple
            accept=".gltf,.glb,.obj,.fbx,.ply,.stl,.3dm,.usdz,.zip"
            onChange={(event) => {
                if (event.target.files) void manager.importFiles(Array.from(event.target.files))
            }}
        />
        <Button
            icon={<Icon color={Colors.GOLD3} icon="cube-edit"/>}
            text="Open 3D File"
            variant={variant}
            alignText={props.alignText}
            onClick={() => input.current?.click()}
        />
        <Button
            icon={<Icon color={Colors.GOLD3} icon="link"/>}
            text="Import from URL"
            variant={variant}
            alignText={props.alignText}
            onClick={() => {
                const url = window.prompt('Enter a URL to a 3D file:')
                if (url) void manager.importUrl(url)
            }}
        />
    </>
}
