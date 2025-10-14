import {mainScenePath, settingsKey} from "./project.ts";

export const mainJsTemplate = `
export async function main({ viewer }){
    
    window.viewer = viewer; // for easy debugging
    
    // viewer is the ThreeViewer instance
    // go wild.
  
    // objects in the scene file are loaded under the model root  
    console.log('[${settingsKey}]: Model Root', viewer.scene.modelRoot);
    
}

export async function onError(err){

    // Oops something went wrong during setup or loading the main scene.
    
    console.error('[${settingsKey}]: Error during setup', err)

}
`

export const packageJsonTemplate = {
    name: `${settingsKey}-project`,
    version: '1.0.0',
    private: true,
    description: '',
    scripts: {},
    mainScene: mainScenePath,
    main: './main.js',
    keywords: ['3d', 'game', 'threepipe', 'three-editor'],
}

export const defaultIconTemplate = atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ipXkAAAAASUVORK5CYII=')
