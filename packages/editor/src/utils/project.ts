import type {
    AssetsJSONManifest,
    ProjectConfigSettings,
    ProjectConfigSettingsJSON,
} from '@kite3d/engine'

export {
    assetUrlPrefix,
    parseAssetsJSONManifest,
    parsePackageJSON,
    parsePackageJsonSettingsConfig,
    settingsKey,
} from '@kite3d/engine'
export type {
    AssetsJSONManifest,
    ExternalPlugin,
    ExternalScript,
    ProjectConfigSettings,
    ProjectConfigSettingsJSON,
} from '@kite3d/engine'

export const mainScenePath = 'assets/main.scene.gltf'

export interface SavedSceneFile {
    path: string
    file: File | string
    assets?: string
    lastModified: number
    preview?: File | string
    scene?: File
}

export interface LoadedProject extends SavedSceneFile {
    settings?: {
        mainScene: string | null
        json: Record<string, unknown>
        config: ProjectConfigSettings
        assetsJson?: unknown
    }
    assetsManifest?: AssetsJSONManifest
}

export interface SavedSceneFileMetaStored {
    path: string
    file: string
    assets?: string
    lastModified: number
    preview?: string
}

export interface SavedSceneFileMeta extends Omit<SavedSceneFileMetaStored, 'preview'> {
    preview?: File | string
}

export async function resolveFile(value: string | File) {
    return value
}

export async function parsePackageJsonSettings(file: File, project: SavedSceneFile) {
    const {parsePackageJSON, parsePackageJsonSettingsConfig} = await import('@kite3d/engine')
    const json = parsePackageJSON(await file.text())
    return {
        ...project,
        file,
        lastModified: file.lastModified,
        settings: {
            mainScene: json.mainScene,
            json,
            config: await parsePackageJsonSettingsConfig(json),
        },
    } satisfies LoadedProject
}
