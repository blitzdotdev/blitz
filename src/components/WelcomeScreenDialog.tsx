import {Alignment, Button, Card, Classes, Colors, H4, Icon, Overlay2} from '@blueprintjs/core'
import React, {useEffect} from 'react'
import {IconName} from '@blueprintjs/icons'
import {MaybeElement} from '@blueprintjs/core/src/common/props'
import {WelcomeDialogProjectsTab} from './WelcomeDialogProjectsTab'
import {useManager, useProject} from '../utils/ViewerInstanceManager.ts'
import {DropzonePlugin, getUrlQueryParam, ThreeViewer} from 'threepipe';
import {useProjectActions} from "../utils/projectActions.tsx";

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

const loadModel = async (model: string|null, viewer: ThreeViewer)=>{
    let env = getUrlQueryParam('env')
    if(!env || !['false', 'f', 'no', 'n', 'null'].includes(env.trim().toLowerCase()||'')){
        await viewer.setEnvironmentMap(env ?? 'https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr')
    }
    if(!model) return false
    const ext = getUrlQueryParam('ext') || getUrlQueryParam('model-extension') || undefined
    const loader = viewer.getPlugin(DropzonePlugin) ?? viewer
    const res =await loader.load(model, {fileExtension: ext})
    return !!res
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

export function WelcomeScreenDialog() {
    const [currentTab, setCurrentTab] = React.useState<keyof typeof tabs>('projects')
    const {project, welcomeOpen, setWelcomeOpen} = useProject()
    const {loadProject} = useProjectActions()
    const manager = useManager()

    useEffect(()=>{
        const viewer = manager.get()
        if(!viewer) return
        // @ts-ignore
        if(viewer.__initLoaded) return
        // @ts-ignore
        viewer.__initLoaded = true

        // todo use forPlugin
        // const transfr = viewer.getPlugin(TransfrSharePlugin)
        // transfr && (transfr.queryParam = 'm')

        let model = getUrlQueryParam('m') || getUrlQueryParam('model')
        const project = getUrlQueryParam('project') || getUrlQueryParam('p')
        const projectFile = getUrlQueryParam('file') || getUrlQueryParam('f')
        if(project){
            if (welcomeOpen) setWelcomeOpen(false)
            manager.getMeta(project).then(meta=>{
                if(!meta){
                    viewer.dialog.alert(`Unable to load project: Project not found: ${project}`)
                    setWelcomeOpen(true)
                    loadModel(model, viewer)
                    if(model && welcomeOpen) setWelcomeOpen(false)
                }else {
                    if(model){
                        console.error("Both 'model' and 'project' query parameters are set. Using 'project' parameter to load the project and ignoring 'model'.")
                        model = null
                    }
                    loadProject(meta.path, projectFile)
                    if (welcomeOpen) setWelcomeOpen(false)
                }
            })
        }else {
            if(model && welcomeOpen) setWelcomeOpen(false)
            loadModel(model, viewer)
        }
    }, [manager, welcomeOpen, setWelcomeOpen])

    return (project || !welcomeOpen) ? null : <Overlay2
        isOpen={true}
        className={Classes.OVERLAY_SCROLL_CONTAINER}
        backdropProps={{
            onDragEnter: (_e) => {
                if(welcomeOpen) setWelcomeOpen(false)
                // const files = e.dataTransfer.files // always empty
                // console.log(files.length, e.nativeEvent)
                // e.preventDefault()
            },
        }}
        usePortal={false}
        onClose={()=>setWelcomeOpen(false)}>
        <Card id="welcome-dialog"
              onDragEnter={(_e) => {
                  if(welcomeOpen) setWelcomeOpen(false)
                  // const files = e.dataTransfer.files // always empty
                  // console.log(files.length, e.nativeEvent)
                  // e.preventDefault()
              }}
              elevation={4} >
            <div id="welcome-sidebar">
                <div id="welcome-sidebar-logo">
                    <img src="/logo.svg" width={35} height={35} alt="Threepipe"/>
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
                {/*<MenuAim/>*/}
            </div>
        </Card>
    </Overlay2>
}
