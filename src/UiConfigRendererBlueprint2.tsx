import {Root} from 'react-dom/client'
import {BPComponent} from 'uiconfig-blueprint/lib/esm/lib'
// import rendererCss from './renderer.scss?inline'
import {FocusStyleManager} from '@blueprintjs/core'
import type {THREE} from "uiconfig-blueprint/lib/esm/lib";
import {
    createDiv,
    UiConfigRendererBase, UiObjectConfig,
    Class,
    Color, getOrCall, IEvent,
    IViewerPlugin,
    IViewerPluginSync,
    Texture,
    ThreeViewer,
    Vector2,
    Vector3,
    Vector4
} from 'threepipe'

export class UiConfigRendererBlueprint2 extends UiConfigRendererBase<Root> {

    constructor(container: HTMLElement = document.body, {autoPostFrame = true} = {}) {
        super(container, autoPostFrame);
        // this._root.expanded = expanded

    }

    protected _createUiContainer(): HTMLDivElement {
        FocusStyleManager.onlyShowFocusOnTabs();

        const container = createDiv({id: 'blueprintEditorContainer2', addToBody: false})
        // createStyles(rendererCss)

        // this._root = createRoot(container, {
        //     identifierPrefix: 'bpUi',
        //     onRecoverableError: (error) => {
        //         console.warn(error)
        //     }
        // })
        // this._root.render(
        //     <StrictMode>
        //         <UiConfigRendererContext.Provider value={this}>
        //         <App />
        //         </UiConfigRendererContext.Provider>
        //     </StrictMode>
        // )
        return container
    }

    protected _refreshUiConfigObject(config: UiObjectConfig): void {
        (config.uiRef as BPComponent<any, any>)?.refreshConfigState()
    }

    renderUiConfig(_: UiObjectConfig): void {
        return;
    }

    // eslint-disable-next-line @typescript-eslint/naming-convention
    THREE: THREE|undefined = (window as any).THREE

    dispose() {
        // todo
    }

}

export class BlueprintJsUiPlugin2 extends UiConfigRendererBlueprint2 implements IViewerPluginSync {
    declare ['constructor']: typeof BlueprintJsUiPlugin2
    static readonly PluginType = 'BlueprintJsUi'
    enabled = true

    constructor(container: HTMLElement = document.body) {
        super(container, {
            autoPostFrame: false,
        })
        this.THREE = {Color, Vector4, Vector3, Vector2, Texture} as any
    }

    protected _viewer?: ThreeViewer
    onAdded(viewer: ThreeViewer): void {
        this._viewer = viewer
        this.__viewer = viewer
        viewer.addEventListener('preRender', this._preRender)
        viewer.addEventListener('postRender', this._postRender)
        viewer.addEventListener('preFrame', this._preFrame)
        viewer.addEventListener('postFrame', this._postFrame)
    }
    onRemove(viewer: ThreeViewer): void {
        this._viewer = undefined
        viewer.removeEventListener('preRender', this._preRender)
        viewer.removeEventListener('postRender', this._postRender)
        viewer.removeEventListener('preFrame', this._preFrame)
        viewer.removeEventListener('postFrame', this._postFrame)
        this.dispose()
    }

    private _plugins: IViewerPlugin[] = []

    setupPlugins(...plugins: Class<IViewerPlugin>[]): void {
        plugins.forEach(plugin => this.setupPluginUi(plugin))
    }
    setupPluginUi<T extends IViewerPlugin>(plugin: T|Class<T>): UiObjectConfig | undefined {
        const p = (plugin as Class<IViewerPlugin>).prototype ? this._viewer?.getPlugin<T>(plugin as Class<T>) : plugin as T
        if (!p) {
            console.warn('plugin not found:', plugin)
            return undefined
        }
        this._plugins.push(p)
        if (p.uiConfig && p.uiConfig.hidden === undefined) p.uiConfig.hidden = false // todo; this is a hack for now
        const ui = p.uiConfig
        this.appendChild(ui)
        // this._setupPluginSerializationContext(ui, p)
        return ui
    }

    refreshPluginsEnabled() {
        this._plugins.forEach(p=>{
            const config = p.uiConfig
            if (config) {
                // const enabled = (p as any).enabled ?? true
                // safeSetProperty(config, 'hidden', !enabled, true)
                // if (config.expanded)
                //     safeSetProperty(config, 'expanded', config.expanded && enabled, true)
                if (getOrCall(config.hidden) !== true)
                    config.uiRefresh?.(true, 'postFrame')
                else if (config.uiRef) {
                    config.uiRef.hidden = true
                }
            }
        })
    }

    /**
     * Required for loading files in BPFileComponent
     */
    get fileLoader() {
        return this._viewer || this.__viewer
    }

    // when unmounting components the viewer instance might be required, but by then the
    // viewer might have been removed from the context, so we store it here.
    // like in BPHierarchyComponent
    // todo: its a hack, find a way to unmount components in onRemove of this plugin.
    private __viewer: ThreeViewer|undefined
    /**
     * Required for BPHierarchyComponent
     */
    get viewer() {
        return this._viewer || this.__viewer
    }

    private _preRender = () => this.refreshQueue('preRender')
    private _postRender = () => this.refreshQueue('postRender')
    private _postFrame = (e: IEvent<'postFrame'>) => {
        this.dispatchEvent(e)
        this.refreshQueue('postFrame')
    }
    private _preFrame = () => this.refreshQueue('preFrame')

    // alert = async(message?: string): Promise<void> =>this._viewer ? this._viewer.dialog.alert(message) : window?.alert(message)
    // confirm = async(message?: string): Promise<boolean> =>this._viewer ? this._viewer.dialog.confirm(message) : window?.confirm(message)
    // prompt = async(message?: string, _default?: string, cancel = true): Promise<string | null> =>this._viewer ? this._viewer.dialog.prompt(message, _default, cancel) : window?.prompt(message, _default)

}

