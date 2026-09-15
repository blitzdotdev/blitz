import {Alignment, Button, Card, Classes, Colors, Icon, Overlay2} from '@blueprintjs/core'
import {ProjectPicker} from './ProjectPicker.tsx'

/**
 * The hub page. A server without a project has nothing to show behind this, so the dialog is
 * always open: escape and a click outside do nothing.
 */
export function WelcomeScreenDialog() {
    return <Overlay2
        isOpen={true}
        className={Classes.OVERLAY_SCROLL_CONTAINER}
        usePortal={false}
        enforceFocus={false}
        autoFocus={false}
        canEscapeKeyClose={false}
        canOutsideClickClose={false}>
        <Card id="welcome-dialog" elevation={4}>
            <div id="welcome-sidebar">
                <div id="welcome-sidebar-logo">
                    <img src="/logo.svg" width={60} height={60} alt="Kite3D" style={{margin: "-10px"}}/>
                    <div style={{display: 'flex', flexDirection: 'column'}}>
                        <h4 style={{margin: "0"}}>Kite 3D</h4>
                        <div>Alpha</div>
                    </div>
                </div>
                {/* One entry, so it names what the content pane shows instead of switching it. */}
                <Button
                    id="welcome-sidebar-list-button-projects"
                    icon={<Icon color={Colors.BLUE4} icon="projects"/>} text="Projects"
                    alignText={Alignment.START}
                    variant={"minimal"}
                    fill className="welcome-sidebar-list-button"
                    active={true}/>
            </div>
            <div id="welcome-content">
                <ProjectPicker/>
            </div>
        </Card>
    </Overlay2>
}
