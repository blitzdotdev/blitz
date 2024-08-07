import {Alignment, Button, Card, Classes, Colors, H4, Icon, Overlay2} from '@blueprintjs/core'
import React from 'react'
import {IconName} from '@blueprintjs/icons'
import {MaybeElement} from '@blueprintjs/core/src/common/props'
import {WelcomeDialogProjectsTab} from './WelcomeDialogProjectsTab'
import {useProject} from '../utils/ViewerInstanceManager.ts'

const tabs = {
    'projects': {
        icon: 'projects' as IconName,
        text: 'Files',
        color: Colors.BLUE4,
        // render: () => <WelcomeDialogAccountTab/>
        render: ()=><WelcomeDialogProjectsTab />
    },
    'templates': {
        icon: 'star-empty' as IconName,
        text: 'Templates',
        color: Colors.GOLD4,
        render: () => <WelcomeDialogProjectsTab/>
    },
    'learn': {
        icon: 'help' as IconName,
        text: 'Learn',
        color: Colors.GREEN4,
        render: () => <WelcomeDialogProjectsTab/>
    },
    'community': {
        icon: 'rocket-slant' as IconName,
        rightIcon: <Icon icon={'share'} size={10} style={{width: 'auto'}}/>,
        text: 'Community',
        color: Colors.RED4,
        render: () => <WelcomeDialogProjectsTab/>
    },
    'settings': {
        icon: 'cog' as IconName,
        text: 'Settings',
        color: Colors.GRAY4,
        render: () => <WelcomeDialogProjectsTab/>
    },
    'account': {
        icon: 'user' as IconName,
        text: 'Account',
        color: Colors.ORANGE4,
        render: () => <WelcomeDialogAccountTab/>
    },
}

export function WelcomeDialogAccountTab() {

    return (
        <div className="welcome-main-container">
            <H4>
                Test
            </H4>
        </div>
    )
}

export function WelcomeSidebarListButton(props: {
    name: any,
    val: { color?: string, icon?: IconName | MaybeElement, text: string, rightIcon?: IconName | MaybeElement },
    currentTab: 'settings' | 'projects' | 'learn' | 'templates' | 'community' | 'account',
    disabled?: boolean,
    onClick: () => void
}) {
    return <Button
        id={'welcome-sidebar-list-button-' + props.name}
        icon={<Icon color={props.val.color} icon={props.val.icon}/>} text={props.val.text}
        alignText={Alignment.LEFT}
        disabled={props.disabled}
        minimal fill className="welcome-sidebar-list-button"
        active={props.currentTab === props.name}
        onClick={props.onClick}
        rightIcon={props.val.rightIcon}
    />
}

export function WelcomeScreenDialog(props: { isOpen: boolean, onClose: () => void }) {

    const [currentTab, setCurrentTab] = React.useState<keyof typeof tabs>('projects')
    const {file, project} = useProject()

    return (file || project) ? null : <Overlay2
        isOpen={props.isOpen}
        className={Classes.OVERLAY_SCROLL_CONTAINER}
        backdropProps={{
            onDragEnter: (_e) => {
                if(props.isOpen) props.onClose()
                // const files = e.dataTransfer.files // always empty
                // console.log(files.length, e.nativeEvent)
                // e.preventDefault()
            },
        }}
        onClose={props.onClose}>
        <Card id="welcome-dialog"
              onDragEnter={(_e) => {
                  if(props.isOpen) props.onClose()
                  // const files = e.dataTransfer.files // always empty
                  // console.log(files.length, e.nativeEvent)
                  // e.preventDefault()
              }}
              elevation={4} >
            <div id="welcome-sidebar">
                <div id="welcome-sidebar-logo">
                    {/*<img src="logo192.png" width={35} height={35} alt="ShaderFlow"/>*/}
                    <div style={{display: 'flex', flexDirection: 'column'}}>
                        <h4 style={{margin: "0"}}>Threepipe Editor</h4>
                        <div>Alpha</div>
                    </div>
                </div>
                <WelcomeSidebarListButton name={"projects"} val={tabs["projects"]} currentTab={currentTab}
                                          onClick={() => setCurrentTab("projects")}/>
                <WelcomeSidebarListButton name={"templates"} val={tabs["templates"]} currentTab={currentTab}
                                          disabled
                                          onClick={() => setCurrentTab("templates")}/>
                <WelcomeSidebarListButton name={"learn"} val={tabs["learn"]} currentTab={currentTab}
                                          disabled
                                          onClick={() => setCurrentTab("learn")}/>
                <WelcomeSidebarListButton name={"community"} val={tabs["community"]} currentTab={currentTab}
                                          disabled
                                          onClick={() => setCurrentTab("community")}/>
                <WelcomeSidebarListButton name={"settings"} val={tabs["settings"]} currentTab={currentTab}
                                          disabled
                                          onClick={() => setCurrentTab("settings")}/>
                {/*<WelcomeSidebarListButton name={"account"} val={{*/}
                {/*    ...tabs["account"],*/}
                {/*    text: "Login",*/}
                {/*}} currentTab={currentTab} onClick={() => setCurrentTab("account")}/>*/}
            </div>
            <div id="welcome-content">
                {tabs[currentTab].render()}
            </div>
        </Card>
    </Overlay2>
}
