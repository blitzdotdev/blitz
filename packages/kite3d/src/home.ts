import {homedir} from 'node:os'
import {resolve} from 'node:path'

// Everything kite3d keeps for the whole machine: projects.json, hub.json and the launcher copy.
// KITE3D_HOME points it somewhere else, so a test never touches the real one.
export function kite3dHome(): string {
    return resolve(process.env.KITE3D_HOME || resolve(homedir(), '.kite3d'))
}
