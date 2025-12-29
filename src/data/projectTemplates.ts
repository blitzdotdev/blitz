import {mainScenePath, settingsKey} from "../utils/project.ts";
import agentsMdTemplate from './AgentsMdTemplate.md?raw';
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
    dependencies: {
        threepipe: ">=0.4.2"
    }
}

export const defaultIconTemplatePng = atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ipXkAAAAASUVORK5CYII=')
export const defaultIconTemplateSvg = `
<svg width="512" height="512" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M237.642 332C228.019 354.682 217.187 402.768 250.839 413.655C292.903 427.264 313.111 362.518 352.701 385.612C384.373 404.087 365.898 449.534 352.701 470.566" stroke="#1B3976" stroke-width="11.5472" stroke-linecap="round"/>
  <path d="M388.155 457.455L359.3 458.195C358.751 458.195 357.074 457.37 354.764 454.072C351.877 449.948 341.98 437.163 338.681 435.513C336.989 434.667 334.641 434.906 332.703 435.404C330.909 435.864 329.515 437.188 328.603 438.799C324.674 445.742 318.765 457.116 318.473 461.494C318.143 466.443 321.36 467.68 323.009 467.68H348.997C349.541 467.68 350.084 467.622 350.625 467.568C352.231 467.406 354.486 467.526 354.764 468.917C355.176 470.979 372.497 489.125 376.209 491.187C378.244 492.317 381.17 491.576 383.473 490.554C385.254 489.765 386.461 488.139 387.115 486.304C389.904 478.478 394.183 466.302 394.767 463.969C395.124 462.541 394.532 461.05 393.696 459.807C392.501 458.032 390.294 457.4 388.155 457.455Z" fill="#E7312C"/>
  <path d="M358.475 459.844C351.464 478.814 318.884 504.383 299.914 499.022" stroke="#E7312C" stroke-width="11.5472" stroke-linecap="round"/>
  <path d="M251.699 175.19C247.987 196.224 232.544 314.732 227.87 373.705C230.475 374.023 233.22 373.224 235.3 371.197L397.412 213.262C398.999 211.716 399.91 209.712 400.111 207.641C358.34 196.211 280.049 176.422 251.699 175.19Z" fill="#1F62C2"/>
  <path d="M282.91 45.6295C274.387 75.4589 256.235 143.024 251.699 175.19C280.049 176.422 358.34 196.211 400.111 207.641C400.32 205.492 399.764 203.27 398.408 201.413L286.914 48.723C285.858 47.2772 284.458 46.2368 282.91 45.6295Z" fill="#4F99E6"/>
  <path d="M111.216 175.596C148.259 174.432 227.976 172.401 251.699 175.19C256.235 143.024 274.387 75.4589 282.91 45.6295C280.028 44.4988 276.636 44.8693 274.007 46.9191L113.541 172.067C112.362 172.987 111.572 174.238 111.216 175.596Z" fill="#266CCB"/>
  <path d="M227.87 373.705C232.544 314.732 247.987 196.224 251.699 175.19C227.976 172.401 148.259 174.432 111.216 175.596C110.788 177.23 110.987 179.02 111.888 180.577L221.117 369.245C222.624 371.847 225.172 373.375 227.87 373.705Z" fill="#154FA9"/>
</svg>
`

export {agentsMdTemplate};
