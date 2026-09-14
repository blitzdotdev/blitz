/// <reference types="vite/client" />

import type { ThreeViewer, Object3D } from 'threepipe'
import type { getSceneStructureMd } from '../src/utils/three/EditorStructure'
import type { SceneCommander } from '../src/utils/three/SceneCommander'

declare global {
  interface Window {
    testViewer: ThreeViewer
    getSceneStructureMd: typeof getSceneStructureMd
    SceneCommander: typeof SceneCommander
    Object3D: typeof Object3D
    testInitComplete: boolean
    testInitError?: Error
    testResults?: {
      markdownV2?: string
      json?: string
      xml?: string
      compact?: string
      markdown?: string
    }
    testHasComponents?: boolean
  }
}

export {}
