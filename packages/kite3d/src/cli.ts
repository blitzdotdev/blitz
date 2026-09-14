#!/usr/bin/env node
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import openBrowser from 'open'
import {
    claimFromDisk,
    devStatusFromDisk,
    initProject,
    journalFromDisk,
    runDetachedDev,
    runDev,
    screenshotFromDisk,
    sourcesInstructions,
    statusFromDisk,
    stopDev,
    upgradeProject,
} from './commands.ts'
import {enforceVersionPin} from './version-pin.ts'
import {KITE3D_VERSION} from './versions.ts'
import {archiveProject} from './archive.ts'
import {doctorProject, formatDoctorTable} from './doctor.ts'
import {gitRepositoryRoot} from './git.ts'
import {assertKite3dProjectRoot, isKite3dProjectRoot} from './project-root.ts'
import {LEGACY_PROJECT_MESSAGE, legacyProjectMigrationNeeded} from './legacy.ts'
import {bundledSkills} from './skills.ts'
import {removedGeneratorMessage} from '@kite3d/engine/projectFormat'
import {createHubServer, openProjectHub, stopProjectHub} from './hub.ts'

const ROOT_USAGE = `Kite3D ${KITE3D_VERSION} builds browser 3D games with an agent and a local editor.
Workflow:
  npx kite3d init my-game && cd my-game && npm install
  Read AGENTS.md in the project. It is the guide: engine API, scene file, rules.
  npx kite3d dev        keeps the local editor running while you edit
  npx kite3d publish    points to the bundled publishing procedure

Usage: kite3d <command> [options]

Commands:
  init [dir] [--no-git]       Create a Kite3D project and Git repository
  dev [options]               Start or stop the local editor
  doctor [--port <port>]      Check the local development prerequisites
  archive                     Write a sanitized project source ZIP
  publish                     Print the publishing procedure path
  status                      Show local deploy status
  claim [--no-open]           Open claim pages for local deploys
  screenshot [options]        Save a PNG of the editor viewport
  journal [options]           Read the edit journal
  open [options]              Open or stop the project launcher
  sources                     Locate installed source
  skills [--json]             List bundled skills and their readable paths
  upgrade                     Upgrade the project to this Kite3D version

Run kite3d <command> --help for command usage.`

const COMMAND_USAGE: Record<string, string> = {
    init: 'Usage: kite3d init [dir] [--no-git]',
    dev: 'Usage: kite3d dev [--port <port>] [--no-open] [--force] [--detach | --stop]',
    doctor: 'Usage: kite3d doctor [--port <port>]',
    archive: 'Usage: kite3d archive',
    publish: publishMessage(),
    status: 'Usage: kite3d status',
    claim: 'Usage: kite3d claim [--no-open]',
    screenshot: 'Usage: kite3d screenshot [--name <name>] [--headless] [--full] [--width <px>] [--height <px>] [--json]',
    journal: 'Usage: kite3d journal [--since <iso>] [-n <count>]',
    open: 'Usage: kite3d open [--no-open] [--stop]',
    sources: 'Usage: kite3d sources',
    skills: 'Usage: kite3d skills [--json]',
    upgrade: 'Usage: kite3d upgrade',
}

const PROJECT_ROOT_COMMANDS = new Set([
    'dev', 'screenshot', 'doctor', 'archive', 'status',
])

const [command = 'help', ...args] = process.argv.slice(2)

try {
    const legacyProject = await legacyProjectMigrationNeeded(process.cwd())
    const allowsLegacyProject = command === 'upgrade' || command === 'doctor' || command === 'skills' || command === 'publish'
        || command === 'help' || command === '--help' || command === '-h'
        || command === '--version' || command === '-v'
        || args.includes('--help') || args.includes('-h')
    const commandNeedsNoProject = command === 'open' || command === 'dev' && args.includes('--stop')
    if (legacyProject && !allowsLegacyProject && !commandNeedsNoProject) throw new Error(LEGACY_PROJECT_MESSAGE)
    if (PROJECT_ROOT_COMMANDS.has(command) && !args.includes('--help') && !args.includes('-h')) {
        if (!(command === 'doctor' && legacyProject) && !commandNeedsNoProject) await assertKite3dProjectRoot(process.cwd())
    }
    const skipsVersionRule = command === 'help' || command === '--help' || command === '-h'
        || command === 'doctor' || command === 'upgrade' || command === 'skills' || command === 'publish'
        || command === '--version' || command === '-v'
        || args.includes('--help') || args.includes('-h')
    const delegatedExitCode = skipsVersionRule ? undefined : await enforceVersionPin(command, process.argv.slice(2))
    if (delegatedExitCode !== undefined) {
        process.exitCode = delegatedExitCode
    } else if (command === 'help' || command === '--help' || command === '-h') {
        if (args.length) throw new Error(`Unknown argument: ${args[0]}`)
        console.log(ROOT_USAGE)
    } else if (command === '--version' || command === '-v') {
        if (args.length) throw new Error(`Unknown argument: ${args[0]}`)
        console.log(KITE3D_VERSION)
    } else if (!COMMAND_USAGE[command]) {
        throw new Error(`Unknown command: ${command}\n${ROOT_USAGE}`)
    } else if (args.includes('--help') || args.includes('-h')) {
        const extras = args.filter((argument) => argument !== '--help' && argument !== '-h')
        if (extras.length) throw new Error(`--help cannot be combined with other arguments.\n${COMMAND_USAGE[command]}`)
        console.log(COMMAND_USAGE[command])
    } else if (command === 'init') {
        const parsed = parseArgs(args, {'--no-git': 'boolean'}, 1)
        const directory = parsed.positionals[0] || '.'
        if (await isKite3dProjectRoot(resolve(directory))) {
            console.log(`${directory} is already a Kite3D project. Next: cd ${directory} && npx kite3d dev`)
        } else {
            const target = await initProject(directory, {git: parsed.values['--no-git'] !== true})
            console.log(`Created Kite3D project at ${target}`)
            if (parsed.values['--no-git'] === true) {
                console.log('Git repository: skipped (--no-git)')
            } else {
                const repository = await gitRepositoryRoot(target)
                console.log(repository === target
                    ? `Git repository: project repository at ${repository}`
                    : `Git repository: tracked parent repository at ${repository}`)
            }
            console.log(`Next: cd ${directory} && npm install && npx kite3d dev`)
            console.log(
                'Then read AGENTS.md in the project before you write code. '
                + 'Build and inspect the saved project.',
            )
        }
    } else if (command === 'doctor') {
        const parsed = parseArgs(args, {'--port': 'value'})
        const result = await doctorProject(process.cwd(), {port: portOption(parsed.values['--port'])})
        console.log(formatDoctorTable(result))
        if (!result.ok) process.exitCode = 1
    } else if (command === 'archive') {
        parseArgs(args, {})
        const result = await archiveProject()
        console.log(`Archived ${result.files.length} file(s) to ${result.path}`)
    } else if (command === 'dev') {
        const parsed = parseArgs(args, {
            '--port': 'value',
            '--no-open': 'boolean',
            '--force': 'boolean',
            '--detach': 'boolean',
            '--stop': 'boolean',
        })
        if (parsed.values['--stop'] === true) {
            if (Object.keys(parsed.values).some((option) => option !== '--stop')) {
                throw new Error(`--stop cannot be combined with other options.\n${COMMAND_USAGE.dev}`)
            }
            const stopped = await stopDev()
            console.log(stopped
                ? `Stopped the development server for ${resolve(process.cwd())}`
                : `No development server is running for ${resolve(process.cwd())}`)
        } else if (parsed.values['--detach'] === true) {
            const server = await runDetachedDev({
                port: portOption(parsed.values['--port']),
                force: parsed.values['--force'] === true,
            })
            console.log(server.url)
        } else {
            const port = portOption(parsed.values['--port'])
            const server = await runDev({
                port,
                strictPort: port !== undefined,
                noOpen: parsed.values['--no-open'] === true,
                force: parsed.values['--force'] === true,
            })
            // Install the handlers before the ready lines: on Linux a stdout pipe is
            // written synchronously, so a reader can react to "Project:" before the
            // next statement runs, and a signal then kills the process outright.
            const shutdown = async () => {
                await server.close()
                process.exit(0)
            }
            process.once('SIGINT', shutdown)
            process.once('SIGTERM', shutdown)
            console.log(`Kite3D editor: ${server.url} (Kite3D ${KITE3D_VERSION})`)
            console.log(`Project: ${server.projectRoot}`)
            console.log('Guide: AGENTS.md in this folder. Inspect the saved project before sharing it.')
        }
    } else if (command === 'publish') {
        parseArgs(args, {})
        console.log(publishMessage())
    } else if (command === 'status') {
        parseArgs(args, {})
        const entries = await statusFromDisk()
        const dev = await devStatusFromDisk()
        if (dev) console.log(`Dev server: pid ${dev.pid}, port ${dev.port}, age ${dev.age}, ${dev.url}`)
        if (!entries.length) console.log('No deploys. Run kite3d publish first.')
        for (const entry of entries) console.log(JSON.stringify({...entry, time_left: timeLeft(entry)}))
    } else if (command === 'claim') {
        const parsed = parseArgs(args, {'--no-open': 'boolean'})
        const entries = await claimFromDisk()
        if (!entries.length) {
            console.log('All local deploys are already claimed.')
        } else {
            for (const entry of entries) console.log(`Claim ${entry.slug}: ${entry.claim_url}`)
            if (parsed.values['--no-open'] !== true) {
                for (const entry of entries) await openBrowser(entry.claim_url)
            }
        }
    } else if (command === 'open') {
        const parsed = parseArgs(args, {'--no-open': 'boolean', '--stop': 'boolean'})
        if (parsed.values['--stop'] === true) {
            if (parsed.values['--no-open'] === true) {
                throw new Error(`--stop cannot be combined with --no-open.\n${COMMAND_USAGE.open}`)
            }
            console.log(await stopProjectHub()
                ? 'Stopped the Kite3D launcher.'
                : 'No Kite3D launcher is running.')
        } else if (process.env.KITE3D_HUB_SERVER === '1') {
            const server = await createHubServer()
            const shutdown = async () => {
                await server.close()
                process.exit(0)
            }
            process.once('SIGINT', shutdown)
            process.once('SIGTERM', shutdown)
            console.log(`Kite3D launcher: ${server.url}`)
        } else {
            console.log(await openProjectHub({noOpen: parsed.values['--no-open'] === true}))
        }
    } else if (command === 'sources') {
        parseArgs(args, {})
        console.log(await sourcesInstructions())
    } else if (command === 'skills') {
        const parsed = parseArgs(args, {'--json': 'boolean'})
        const skills = await bundledSkills()
        const output = parsed.values['--json'] === true
            ? JSON.stringify(skills)
            : skills.map(({name, path}) => `${name}\t${path}`).join('\n')
        if (output) console.log(output)
    } else if (command === 'screenshot') {
        const parsed = parseArgs(args, {
            '--name': 'value',
            '--headless': 'boolean',
            '--full': 'boolean',
            '--width': 'value',
            '--height': 'value',
            '--json': 'boolean',
        })
        const result = await screenshotFromDisk(process.cwd(), {
            name: valueOption(parsed.values['--name']),
            headless: parsed.values['--headless'] === true,
            full: parsed.values['--full'] === true,
            width: positiveIntegerOption(parsed.values['--width'], '--width'),
            height: positiveIntegerOption(parsed.values['--height'], '--height'),
        })
        console.log(parsed.values['--json'] === true ? JSON.stringify({
            path: result.path,
            width: result.width,
            height: result.height,
            source: result.source,
            capturedAt: result.capturedAt,
        }) : result.path)
    } else if (command === 'journal') {
        const parsed = parseArgs(args, {'--since': 'value', '-n': 'value'})
        const entries = await journalFromDisk(process.cwd(), {
            since: valueOption(parsed.values['--since']),
            limit: integerOption(parsed.values['-n'], '-n'),
        })
        for (const entry of entries) console.log(JSON.stringify(entry))
    } else if (command === 'upgrade') {
        parseArgs(args, {})
        const result = await upgradeProject(process.cwd())
        for (const change of result.changes) console.log(change)
        console.log(`Upgraded Kite3D from ${result.from} to ${result.to}`)
        for (const nodeName of result.removedGeneratorNodes) console.log(removedGeneratorMessage(nodeName))
        if (result.next) console.log(`Next: ${result.next}`)
    }
} catch (error) {
    console.error(`kite3d: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
}

function publishMessage(): string {
    const path = fileURLToPath(new URL('../skills/publish/SKILL.md', import.meta.url))
    return `Publishing is done by you. Read and follow: ${path}`
}

type OptionKind = 'value' | 'boolean'

function parseArgs(
    args: string[],
    options: Record<string, OptionKind>,
    maximumPositionals = 0,
): {values: Record<string, string | boolean>, positionals: string[]} {
    const values: Record<string, string | boolean> = {}
    const positionals: string[] = []
    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index]
        if (!argument.startsWith('-')) {
            positionals.push(argument)
            continue
        }
        const kind = options[argument]
        if (!kind) throw new Error(`Unknown flag: ${argument}`)
        if (values[argument] !== undefined) throw new Error(`Flag specified more than once: ${argument}`)
        if (kind === 'boolean') {
            values[argument] = true
            continue
        }
        const value = args[index + 1]
        if (!value || value.startsWith('-')) throw new Error(`${argument} requires a value`)
        values[argument] = value
        index += 1
    }
    if (positionals.length > maximumPositionals) throw new Error(`Unexpected argument: ${positionals[maximumPositionals]}`)
    return {values, positionals}
}

function valueOption(value: string | boolean | undefined): string | undefined {
    return typeof value === 'string' ? value : undefined
}

function portOption(value: string | boolean | undefined): number | undefined {
    const raw = valueOption(value)
    if (raw === undefined) return undefined
    const port = Number(raw)
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('--port must be a valid port')
    return port
}

function integerOption(value: string | boolean | undefined, name: string): number | undefined {
    const raw = valueOption(value)
    if (raw === undefined) return undefined
    const integer = Number(raw)
    if (!Number.isInteger(integer) || integer < 0) throw new Error(`${name} must be a non-negative integer`)
    return integer
}

function positiveIntegerOption(value: string | boolean | undefined, name: string): number | undefined {
    const integer = integerOption(value, name)
    if (integer === 0) throw new Error(`${name} must be a positive integer`)
    return integer
}

function timeLeft(entry: {claimed: boolean, expires_at: string}): string {
    if (entry.claimed) return 'claimed'
    const hasZone = /[zZ]|[+-]\d\d:\d\d$/.test(entry.expires_at)
    const expires = Date.parse(entry.expires_at.replace(' ', 'T') + (hasZone ? '' : 'Z'))
    const milliseconds = expires - Date.now()
    if (!Number.isFinite(milliseconds) || milliseconds <= 0) return 'expired'
    const minutes = Math.ceil(milliseconds / 60_000)
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}
