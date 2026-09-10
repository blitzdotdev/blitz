import {Button, ButtonGroup, Intent} from '@blueprintjs/core'
import {useManagerVersion} from '../utils/UseManager.ts'

export function PlayModeButtonGroup({onPlay, onStop}: {onPlay(): void, onStop(): void}) {
    const manager = useManagerVersion()
    const stopping = manager.isPlaying

    return <ButtonGroup>
        <Button
            data-testid="play"
            icon={stopping ? 'stop' : 'play'}
            intent={stopping ? Intent.DANGER : Intent.PRIMARY}
            onClick={stopping ? onStop : onPlay}
        >{stopping ? 'Stop' : 'Play'}</Button>
    </ButtonGroup>
}
