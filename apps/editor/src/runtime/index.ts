import editorPackage from '../../package.json'

export {createGame} from './createGame.ts'
export type {CreatedGame, CreateGameOptions, RuntimeProject} from './createGame.ts'

export const RUNTIME_VERSION = editorPackage.version

export * from 'threepipe'
export * from 'uiconfig.js'
export * from 'ts-browser-helpers'
