import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import {afterAll, beforeAll} from 'vitest'

let kite3dHome: string
let previousKite3dHome: string | undefined

beforeAll(async () => {
    previousKite3dHome = process.env.KITE3D_HOME
    kite3dHome = await mkdtemp(resolve(tmpdir(), 'kite3d-test-home-'))
    process.env.KITE3D_HOME = kite3dHome
})

afterAll(async () => {
    if (previousKite3dHome === undefined) delete process.env.KITE3D_HOME
    else process.env.KITE3D_HOME = previousKite3dHome
    await rm(kite3dHome, {recursive: true, force: true})
})
