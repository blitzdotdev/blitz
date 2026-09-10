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

export const BLITZ_VERSION = readPackageVersion('@blitzdev/blitz')
export const EDITOR_VERSION = readPackageVersion('@blitzdev/editor')
export const ENGINE_VERSION = readPackageVersion('@blitzdev/engine')
