import {Alignment, Button, Card, Classes, Colors, Icon, Overlay2} from '@blueprintjs/core'
import React, {useEffect} from 'react'
import type {IconName} from '@blueprintjs/icons'
import type {MaybeElement} from '@blueprintjs/core/src/common/props'
import {WelcomeDialogProjectsTab} from './WelcomeDialogProjectsTab.tsx'
import {useProject} from '../utils/UseProject.ts'
import {useHubClient} from '../hubClient.tsx'

const tabs = {
    projects: {icon: 'projects' as IconName, text: 'Files', color: Colors.BLUE4},
    templates: {icon: 'star-empty' as IconName, text: 'Templates', color: Colors.GOLD4},
    learn: {icon: 'help' as IconName, text: 'Learn', color: Colors.GREEN4},
    community: {
        icon: 'rocket-slant' as IconName,
        rightIcon: <Icon icon="share" size={10} style={{width: 'auto'}}/>,
        text: 'Community',
        color: Colors.RED4,
    },
    settings: {icon: 'cog' as IconName, text: 'Settings', color: Colors.GRAY4},
}

export function WelcomeSidebarListButton(props: {
    name: keyof typeof tabs
    val: {color?: string, icon?: IconName | MaybeElement, text: string, rightIcon?: IconName | MaybeElement}
    currentTab: keyof typeof tabs
    disabled?: boolean
    onClick(): void
}) {
    return <Button
        id={`welcome-sidebar-list-button-${props.name}`}
        icon={<Icon color={props.val.color} icon={props.val.icon}/>} text={props.val.text}
        alignText={Alignment.START}
        disabled={props.disabled}
        variant="minimal"
        fill={true}
        className="welcome-sidebar-list-button"
        active={props.currentTab === props.name}
        onClick={props.onClick}
        endIcon={props.val.rightIcon}
    />
}

export function WelcomeScreenDialog({hubMode}: {hubMode: boolean}) {
    const [currentTab, setCurrentTab] = React.useState<keyof typeof tabs>('projects')
    const {welcomeOpen, setWelcomeOpen, setWelcomeView} = useProject()
    const {refresh} = useHubClient()
    const open = hubMode || welcomeOpen

    useEffect(() => {
        if (!open) return
        setCurrentTab('projects')
        void refresh()
    }, [open, refresh])

    if (!open) return null
    const close = () => {
        if (hubMode) return
        setWelcomeOpen(false)
        setWelcomeView('projects')
    }
    return <Overlay2
        isOpen={true}
        className={Classes.OVERLAY_SCROLL_CONTAINER}
        usePortal={false}
        enforceFocus={false}
        autoFocus={false}
        canEscapeKeyClose={!hubMode}
        canOutsideClickClose={!hubMode}
        onClose={close}>
        <Card id="welcome-dialog" elevation={4}>
            <div id="welcome-sidebar">
                <div id="welcome-sidebar-logo">
                    <img src="/logo.svg" width={60} height={60} alt="Kite3D" style={{margin: '-10px'}} className="welcome-screen-logo"/>
                    <div className="welcome-product-name">
                        <h4>Kite 3D</h4>
                        <div>Alpha</div>
                    </div>
                </div>
                {(Object.keys(tabs) as Array<keyof typeof tabs>).map((name) => <WelcomeSidebarListButton
                    key={name}
                    name={name}
                    val={tabs[name]}
                    currentTab={currentTab}
                    disabled={name !== 'projects'}
                    onClick={() => setCurrentTab(name)}/>) }
            </div>
            <div id="welcome-content">
                <WelcomeDialogProjectsTab/>
            </div>
        </Card>
    </Overlay2>
}
