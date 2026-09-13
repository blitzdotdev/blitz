#!/usr/bin/env node
import {resolve} from 'node:path'
import openBrowser from 'open'
import {
    claimFromDisk,
    devStatusFromDisk,
    initProject,
    journalFromDisk,
    openCurrentProject,
    publishFromDisk,
    pullFromDisk,
    runDev,
    screenshotFromDisk,
    sourcesInstructions,
    statusFromDisk,
    upgradeProject,
} from './commands.ts'
import {checkProject, formatCheckTable} from './check.ts'
import {enforceVersionPin} from './version-pin.ts'
import {KITE3D_VERSION} from './versions.ts'
import {sanitizeDiagnostic} from './api.ts'
import {archiveProject} from './archive.ts'
import {doctorProject, formatDoctorTable} from './doctor.ts'
import {checkpointProject, gitRepositoryRoot, restoreProject} from './git.ts'
import {assertKite3dProjectRoot, isKite3dProjectRoot} from './project-root.ts'
import {LEGACY_PROJECT_MESSAGE, legacyProjectMigrationNeeded} from './legacy.ts'
import {bundledSkills} from './skills.ts'
import {removedGeneratorMessage} from '@kite3d/engine/projectFormat'

const ROOT_USAGE = `Kite3D ${KITE3D_VERSION} builds browser 3D games with an agent and a local editor.
Workflow:
  npx kite3d init my-game && cd my-game && npm install
  Read AGENTS.md in the project. It is the guide: engine API, scene file, rules.
  npx kite3d dev        keeps the local editor running while you edit
  npx kite3d check      run it and fix every failure before you publish
  npx kite3d publish    prints the live URL

Usage: kite3d <command> [options]

Commands:
  init [dir] [--no-git]       Create a Kite3D project and Git repository
  dev [--port <port>]         Start the local editor
  doctor [--port <port>]      Check the local development prerequisites
  checkpoint [label]          Commit a project checkpoint
  restore [hash]              Restore files from a checkpoint
  archive                     Write a sanitized project source ZIP
  publish [options]           Publish the project
  pull [--force]              Pull the active release
  status                      Show local deploy status
  claim [--no-open]           Open claim pages for local deploys
  screenshot [options]        Save a PNG of the editor viewport
  check                       Check Playable, Editable, and Persisted outcomes
  journal [options]           Read the edit journal
  open                        Open the running local editor
  sources                     Locate installed source
  skills [--json]             List bundled skills and their readable paths
  upgrade                     Upgrade the project to this Kite3D version

Run kite3d <command> --help for command usage.`

const COMMAND_USAGE: Record<string, string> = {
    init: 'Usage: kite3d init [dir] [--no-git]',
    dev: 'Usage: kite3d dev [--port <port>] [--no-open] [--force]',
    doctor: 'Usage: kite3d doctor [--port <port>]',
    checkpoint: 'Usage: kite3d checkpoint [label] [--allow-parent-repo]',
    restore: 'Usage: kite3d restore [hash] [--allow-parent-repo]',
    archive: 'Usage: kite3d archive',
    publish: 'Usage: kite3d publish [--slug <slug>] [--name <name>] [--message <message>] [--no-check] [--no-verify]',
    pull: 'Usage: kite3d pull [--force]',
    status: 'Usage: kite3d status',
    claim: 'Usage: kite3d claim [--no-open]',
    screenshot: 'Usage: kite3d screenshot [--name <name>] [--headless] [--full] [--width <px>] [--height <px>] [--json]',
    check: 'Usage: kite3d check',
    journal: 'Usage: kite3d journal [--since <iso>] [-n <count>]',
    open: 'Usage: kite3d open',
    sources: 'Usage: kite3d sources',
    skills: 'Usage: kite3d skills [--json]',
    upgrade: 'Usage: kite3d upgrade',
}

const PROJECT_ROOT_COMMANDS = new Set([
    'dev', 'check', 'screenshot', 'publish', 'doctor', 'checkpoint', 'restore', 'archive', 'status',
])

const [command = 'help', ...args] = process.argv.slice(2)

try {
    const legacyProject = await legacyProjectMigrationNeeded(process.cwd())
    const allowsLegacyProject = command === 'upgrade' || command === 'doctor' || command === 'skills'
        || command === 'help' || command === '--help' || command === '-h'
        || command === '--version' || command === '-v'
        || args.includes('--help') || args.includes('-h')
    if (legacyProject && !allowsLegacyProject) throw new Error(LEGACY_PROJECT_MESSAGE)
    if (PROJECT_ROOT_COMMANDS.has(command) && !args.includes('--help') && !args.includes('-h')) {
        if (!(command === 'doctor' && legacyProject)) await assertKite3dProjectRoot(process.cwd())
    }
    const skipsVersionRule = command === 'help' || command === '--help' || command === '-h'
        || command === 'doctor' || command === 'upgrade' || command === 'skills'
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
                + 'Build, run npx kite3d check, then npx kite3d publish.',
            )
        }
    } else if (command === 'doctor') {
        const parsed = parseArgs(args, {'--port': 'value'})
        const result = await doctorProject(process.cwd(), {port: portOption(parsed.values['--port'])})
        console.log(formatDoctorTable(result))
        if (!result.ok) process.exitCode = 1
    } else if (command === 'checkpoint') {
        const parsed = parseArgs(args, {'--allow-parent-repo': 'boolean'}, 1)
        const result = await checkpointProject(process.cwd(), parsed.positionals[0], {
            allowParentRepo: parsed.values['--allow-parent-repo'] === true,
        })
        console.log(`Checkpoint ${result.hash}${result.label ? ` ${result.label}` : ''}`)
    } else if (command === 'restore') {
        const parsed = parseArgs(args, {'--allow-parent-repo': 'boolean'}, 1)
        const result = await restoreProject(process.cwd(), parsed.positionals[0], {
            allowParentRepo: parsed.values['--allow-parent-repo'] === true,
        })
        console.log(`Restored checkpoint ${result.hash}`)
    } else if (command === 'archive') {
        parseArgs(args, {})
        const result = await archiveProject()
        console.log(`Archived ${result.files.length} file(s) to ${result.path}`)
    } else if (command === 'dev') {
        const parsed = parseArgs(args, {'--port': 'value', '--no-open': 'boolean', '--force': 'boolean'})
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
        console.log('Guide: AGENTS.md in this folder. Verify with npx kite3d check. Publish with npx kite3d publish.')
    } else if (command === 'publish') {
        const parsed = parseArgs(args, {
            '--slug': 'value',
            '--name': 'value',
            '--message': 'value',
            '--no-check': 'boolean',
            '--no-verify': 'boolean',
        })
        const result = await publishFromDisk(process.cwd(), {
            slug: valueOption(parsed.values['--slug']),
            name: valueOption(parsed.values['--name']),
            message: valueOption(parsed.values['--message']),
            noCheck: parsed.values['--no-check'] === true,
            noVerify: parsed.values['--no-verify'] === true,
        }, (value) => {
            const progress = value as {phase?: string, done?: number, total?: number, path?: string}
            console.log(`[${progress.phase}] ${progress.done}/${progress.total}${progress.path ? ` ${progress.path}` : ''}`)
        })
        console.log(`Published ${result.release_hash}`)
        console.log(result.preview_url)
    } else if (command === 'pull') {
        const parsed = parseArgs(args, {'--force': 'boolean'})
        const result = await pullFromDisk(process.cwd(), {force: parsed.values['--force'] === true})
        if (!result.release_hash) {
            console.log('There is nothing to pull before the first publish.')
        } else {
            for (const path of result.kept) console.log(`${path}: modified locally, kept`)
            console.log(`Pulled ${result.release_hash}; updated ${result.updated.length} file(s).`)
        }
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
        parseArgs(args, {})
        console.log(await openCurrentProject())
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
    } else if (command === 'check') {
        parseArgs(args, {})
        const result = await checkProject()
        console.log(formatCheckTable(result))
        if (!result.ok) process.exitCode = 1
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
    console.error(`kite3d: ${sanitizeDiagnostic(error instanceof Error ? error.message : error)}`)
    process.exitCode = 1
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
