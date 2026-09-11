import {execFile} from 'node:child_process'
import {cp, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {promisify} from 'node:util'

export const FIXTURE_PLUGIN_NAME = '@kite3d/test-plugin-fixture'

const execute = promisify(execFile)
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const fixtureRoot = fileURLToPath(new URL('./fixtures/plugin-package/', import.meta.url))

export async function installPackedFixturePlugin(projectRoot: string): Promise<void> {
    const packDirectory = await mkdtemp(resolve(tmpdir(), 'kite3d-plugin-pack-'))
    try {
        const {stdout} = await execute(npm, [
            'pack', fixtureRoot, '--offline', '--json', '--pack-destination', packDirectory,
        ])
        const packed = JSON.parse(stdout) as Array<{filename: string}>
        const tarball = resolve(packDirectory, packed[0].filename)
        const installDirectory = resolve(packDirectory, 'install')
        await mkdir(installDirectory)
        await execute(npm, [
            'install', '--offline', '--ignore-scripts', '--package-lock=false', '--legacy-peer-deps', '--omit=dev',
            '--install-links', tarball,
        ], {cwd: installDirectory})
        const packageParts = FIXTURE_PLUGIN_NAME.split('/')
        const installedPackage = resolve(projectRoot, 'node_modules', ...packageParts)
        await mkdir(resolve(installedPackage, '..'), {recursive: true})
        await cp(resolve(installDirectory, 'node_modules', ...packageParts), installedPackage, {recursive: true})
        const packagePath = resolve(projectRoot, 'package.json')
        const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as Record<string, unknown>
        const dependencies = isRecord(packageJson.dependencies) ? packageJson.dependencies : {}
        packageJson.dependencies = {...dependencies, [FIXTURE_PLUGIN_NAME]: `file:${tarball}`}
        await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)
    } finally {
        await rm(packDirectory, {recursive: true, force: true})
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
