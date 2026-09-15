import {homedir} from 'node:os'
import {resolve} from 'node:path'

// Everything kite3d keeps for the whole machine: projects.json, hub.json and the launcher copy.
export function kite3dHome(): string {
    return resolve(homedir(), '.kite3d')
}
