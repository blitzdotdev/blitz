import {AmbientLight, DirectionalLight2, HemisphereLight} from "threepipe";
import {EditModePlugin} from "./EditModePlugin.ts";


// todo use this to remove repeated code
// private _envPaths: Record<string, string> = {
//     'env-day': 'https://threejs.org/examples/textures/equirectangular/quarry_01_1k.hdr',
//     'env-night': 'https://threejs.org/examples/textures/equirectangular/moonless_golf_1k.hdr',
//     'env-studio': 'https://threejs.org/examples/textures/equirectangular/royal_esplanade_1k.hdr',
//     'env-indoors': 'https://samples.threepipe.org/minimal/empty_warehouse_01_1k.hdr',
//     'env-outdoors': 'https://samples.threepipe.org/minimal/venice_sunset_1k.hdr',
// }

export const overrideLightingPresets = {
    'lights-day': {
        label: 'Day',
        icon: 'flash',
        create: async (plugin: EditModePlugin) => {
            // Bright outdoor daylight
            const sunLight = new DirectionalLight2(0xffffff, 1.5)
            sunLight.position.set(5, 10, 7.5)
            sunLight.castShadow = false

            const skyLight = new HemisphereLight(0x87ceeb, 0x545454, 0.6)
            skyLight.position.set(0, 10, 0)

            return {
                lights: [sunLight, skyLight],
            }
        }
    },
    'lights-night': {
        label: 'Night',
        icon: 'moon',
        create: async (plugin: EditModePlugin) => {
            // Dim bluish night lighting
            const moonLight = new DirectionalLight2(0x6b8cba, 0.3)
            moonLight.position.set(-5, 10, -7.5)
            moonLight.castShadow = false

            const ambient = new AmbientLight(0x1a2332, 0.2)

            return {
                lights: [moonLight, ambient],
            }
        }
    },
    'lights-studio': {
        label: 'Studio',
        icon: 'camera',
        create: async (plugin: EditModePlugin) => {
            // Three-point studio lighting
            const keyLight = new DirectionalLight2(0xffffff, 1.0)
            keyLight.position.set(5, 10, 5)
            keyLight.castShadow = false

            const fillLight = new DirectionalLight2(0xffffff, 0.4)
            fillLight.position.set(-5, 5, 5)
            fillLight.castShadow = false

            const backLight = new DirectionalLight2(0xffffff, 0.5)
            backLight.position.set(0, 5, -10)
            backLight.castShadow = false

            const ambient = new AmbientLight(0xffffff, 0.3)

            return {
                lights: [keyLight, fillLight, backLight, ambient],
            }
        }
    },
    'lights-none': {
        label: 'None',
        icon: 'disable',
        create: async (plugin: EditModePlugin) => {
            // No lights at all
            return {
                lights: [],
            }
        }
    },
    'env-day': {
        label: 'Day',
        icon: 'globe',
        create: async (plugin: EditModePlugin) => {
            const envPath = 'https://threejs.org/examples/textures/equirectangular/quarry_01_1k.hdr'
            try {
                const env: any = await plugin.viewer!.load(envPath)
                return {
                    environment: env,
                }
            } catch (error) {
                console.error(`Failed to load environment: ${envPath}`, error)
                return {lights: []}
            }
        }
    },
    'env-night': {
        label: 'Night',
        icon: 'moon',
        create: async (plugin: EditModePlugin) => {
            const envPath = 'https://threejs.org/examples/textures/equirectangular/moonless_golf_1k.hdr'
            try {
                const env: any = await plugin.viewer!.load(envPath)
                return {
                    environment: env,
                }
            } catch (error) {
                console.error(`Failed to load environment: ${envPath}`, error)
                return {lights: []}
            }
        }
    },
    'env-studio': {
        label: 'Studio',
        icon: 'camera',
        create: async (plugin: EditModePlugin) => {
            const envPath = 'https://threejs.org/examples/textures/equirectangular/royal_esplanade_1k.hdr'
            try {
                const env: any = await plugin.viewer!.load(envPath)
                return {
                    environment: env,
                }
            } catch (error) {
                console.error(`Failed to load environment: ${envPath}`, error)
                return {lights: []}
            }
        }
    },
    'env-indoors': {
        label: 'Indoors',
        icon: 'home',
        create: async (plugin: EditModePlugin) => {
            const envPath = 'https://samples.threepipe.org/minimal/empty_warehouse_01_1k.hdr'
            try {
                const env: any = await plugin.viewer!.load(envPath)
                return {
                    environment: env,
                }
            } catch (error) {
                console.error(`Failed to load environment: ${envPath}`, error)
                return {lights: []}
            }
        }
    },
    'env-outdoors': {
        label: 'Outdoors',
        icon: 'outdated',
        create: async (plugin: EditModePlugin) => {
            const envPath = 'https://samples.threepipe.org/minimal/venice_sunset_1k.hdr'
            try {
                const env: any = await plugin.viewer!.load(envPath)
                return {
                    environment: env,
                }
            } catch (error) {
                console.error(`Failed to load environment: ${envPath}`, error)
                return {lights: []}
            }
        }
    },
}
