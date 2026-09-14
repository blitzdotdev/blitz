import {execFile} from 'node:child_process'
import {access, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {homedir, tmpdir} from 'node:os'
import {resolve} from 'node:path'
import {promisify} from 'node:util'
import {kite3dHome} from './home.ts'
import {KITE3D_VERSION} from './versions.ts'

const executeFile = promisify(execFile)

export const REGISTERED_MESSAGE =
    'Registered kite3d:// so kite3d.dev can open your projects. Undo with npx kite3d install --remove.'

const lsregister = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'

// A copy npx cannot evict, so the handler keeps working when the npx cache is cleared.
function launcherPrefix(): string {
    return resolve(kite3dHome(), 'launcher')
}

function launcherCliPath(): string {
    return resolve(launcherPrefix(), 'node_modules/kite3d/dist/cli.js')
}

// Whatever the link says, the handler does one thing: it runs kite3d open. A login shell puts the
// user's own node on PATH, so nothing records the path of a binary.
function handlerLine(): string {
    return process.platform === 'win32'
        ? `cmd /c node "${launcherCliPath()}" open`
        : `/bin/zsh -lc 'exec node "${launcherCliPath()}" open'`
}

function appletPath(): string {
    return resolve(homedir(), 'Applications/Kite3D Launcher.app')
}

function desktopFilePath(): string {
    return resolve(homedir(), '.local/share/applications/kite3d.desktop')
}

// kite3d install, and the first init or dev on a machine.
export async function installScheme(): Promise<void> {
    await installLauncherCopy()
    if (process.platform === 'darwin') await registerMacOs()
    else if (process.platform === 'linux') await registerLinux()
    else if (process.platform === 'win32') await registerWindows()
    else throw new Error(`kite3d:// cannot be registered on ${process.platform}.`)
}

// kite3d install --remove. The project index stays: it is the user's list, not part of the handler.
export async function removeScheme(): Promise<void> {
    if (process.platform === 'darwin') {
        // Unregister before the delete, or LaunchServices keeps answering for a folder that is gone.
        await run(lsregister, ['-u', appletPath()]).catch(() => undefined)
        await rm(appletPath(), {recursive: true, force: true})
    } else if (process.platform === 'linux') {
        await rm(desktopFilePath(), {force: true})
    } else if (process.platform === 'win32') {
        await run('reg', ['delete', 'HKCU\\Software\\Classes\\kite3d', '/f']).catch(() => undefined)
    }
    await rm(launcherPrefix(), {recursive: true, force: true})
}

// The first init or dev on a machine registers by itself, because a separate install step is a step
// people forget. True when this call registered it. A newer kite3d refreshes the copy.
export async function registerSchemeIfAbsent(options: {refreshCopy: boolean}): Promise<boolean> {
    if (process.env.CI) return false
    if (!['darwin', 'linux', 'win32'].includes(process.platform)) return false
    if (await isRegistered()) {
        if (options.refreshCopy) await refreshLauncherCopy()
        return false
    }
    await installScheme()
    return true
}

// The registration itself is the check, so a user who deleted it gets it back.
async function isRegistered(): Promise<boolean> {
    if (process.platform === 'darwin') return pathExists(appletPath())
    if (process.platform === 'linux') return pathExists(desktopFilePath())
    return run('reg', ['query', 'HKCU\\Software\\Classes\\kite3d']).then(() => true, () => false)
}

async function installLauncherCopy(): Promise<void> {
    const prefix = launcherPrefix()
    await mkdir(prefix, {recursive: true})
    await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', `kite3d@${KITE3D_VERSION}`, '--prefix', prefix])
}

async function refreshLauncherCopy(): Promise<void> {
    const installed = await installedLauncherVersion()
    if (installed && !isNewerVersion(KITE3D_VERSION, installed)) return
    await installLauncherCopy()
}

async function installedLauncherVersion(): Promise<string | null> {
    try {
        const manifest = JSON.parse(await readFile(resolve(launcherPrefix(), 'node_modules/kite3d/package.json'), 'utf8')) as {version?: unknown}
        return typeof manifest.version === 'string' ? manifest.version : null
    } catch {
        return null
    }
}

// True when left is a later version than right. Release numbers first, then a prerelease counts as
// earlier than the release it leads to.
function isNewerVersion(left: string, right: string): boolean {
    const [leftNumbers, leftPrerelease] = splitVersion(left)
    const [rightNumbers, rightPrerelease] = splitVersion(right)
    for (let index = 0; index < 3; index += 1) {
        if (leftNumbers[index] !== rightNumbers[index]) return leftNumbers[index] > rightNumbers[index]
    }
    if (leftPrerelease === rightPrerelease) return false
    if (!leftPrerelease) return true
    if (!rightPrerelease) return false
    return leftPrerelease > rightPrerelease
}

function splitVersion(version: string): [number[], string] {
    const [numbers, prerelease = ''] = version.split('-', 2)
    const parts = numbers.split('.').map((part) => Number(part))
    return [[0, 1, 2].map((index) => Number.isInteger(parts[index]) ? parts[index] : 0), prerelease]
}

// An applet whose open location handler runs the handler line. It is built here and never signed,
// so Gatekeeper has nothing to quarantine.
async function registerMacOs(): Promise<void> {
    const source = [
        'on open location this_URL',
        `\tdo shell script "${handlerLine().replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`,
        'end open location',
    ].join('\n')
    const scratch = await mkdtemp(resolve(tmpdir(), 'kite3d-applet-'))
    try {
        const scriptPath = resolve(scratch, 'launcher.applescript')
        await writeFile(scriptPath, `${source}\n`)
        await mkdir(resolve(homedir(), 'Applications'), {recursive: true})
        await rm(appletPath(), {recursive: true, force: true})
        await run('osacompile', ['-o', appletPath(), scriptPath])
    } finally {
        await rm(scratch, {recursive: true, force: true})
    }
    const plist = resolve(appletPath(), 'Contents/Info.plist')
    await run('/usr/libexec/PlistBuddy', [
        '-c', 'Add :CFBundleURLTypes array',
        '-c', 'Add :CFBundleURLTypes:0 dict',
        '-c', 'Add :CFBundleURLTypes:0:CFBundleURLName string Kite3D',
        '-c', 'Add :CFBundleURLTypes:0:CFBundleURLSchemes array',
        '-c', 'Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string kite3d',
        plist,
    ])
    await run(lsregister, ['-f', appletPath()])
}

async function registerLinux(): Promise<void> {
    const path = desktopFilePath()
    await mkdir(resolve(path, '..'), {recursive: true})
    await writeFile(path, [
        '[Desktop Entry]',
        'Type=Application',
        'Name=Kite3D Launcher',
        `Exec=${handlerLine()}`,
        'Terminal=false',
        'NoDisplay=true',
        'MimeType=x-scheme-handler/kite3d;',
        '',
    ].join('\n'))
    await run('xdg-mime', ['default', 'kite3d.desktop', 'x-scheme-handler/kite3d'])
}

async function registerWindows(): Promise<void> {
    await run('reg', ['add', 'HKCU\\Software\\Classes\\kite3d', '/ve', '/d', 'URL:Kite3D', '/f'])
    await run('reg', ['add', 'HKCU\\Software\\Classes\\kite3d', '/v', 'URL Protocol', '/d', '', '/f'])
    await run('reg', ['add', 'HKCU\\Software\\Classes\\kite3d\\shell\\open\\command', '/ve', '/d', handlerLine(), '/f'])
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await access(path)
        return true
    } catch {
        return false
    }
}

async function run(command: string, args: string[]): Promise<string> {
    try {
        const {stdout} = await executeFile(command, args, {encoding: 'utf8', maxBuffer: 8 * 1024 * 1024})
        return stdout
    } catch (error) {
        const stderr = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr).trim() : ''
        throw new Error(`${command} failed: ${stderr || (error instanceof Error ? error.message : String(error))}`)
    }
}
