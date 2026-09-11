import {createRequire} from 'node:module'

interface PackageManifest {
    version?: unknown
}

const require = createRequire(import.meta.url)

function readPackageVersion(packageName: string): string {
    const manifest = require(`${packageName}/package.json`) as PackageManifest
    if (typeof manifest.version !== 'string' || !manifest.version) {
        throw new Error(`${packageName}/package.json does not contain a version`)
    }
    return manifest.version
}

export const KITE3D_VERSION = readPackageVersion('kite3d')
export const EDITOR_VERSION = readPackageVersion('@kite3d/editor')
export const ENGINE_VERSION = readPackageVersion('@kite3d/engine')
