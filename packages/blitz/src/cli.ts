#!/usr/bin/env node
import {
    bakeFromEditor,
    claimFromDisk,
    devStatusFromDisk,
    initProject,
    journalFromDisk,
    openCurrentProject,
    publishFromDisk,
    pullFromDisk,
    runDev,
    sourcesInstructions,
    statusFromDisk,
    upgradeProject,
} from './commands.ts'
import {checkProject, formatCheckTable} from './check.ts'
import {enforceVersionPin} from './version-pin.ts'
import {BLITZ_VERSION} from './versions.ts'
import {sanitizeDiagnostic} from './api.ts'
import {archiveProject} from './archive.ts'
import {doctorProject, formatDoctorTable} from './doctor.ts'
import {checkpointProject, restoreProject} from './git.ts'

const ROOT_USAGE = `Usage: blitz <command> [options]

Commands:
  init [dir] [--no-git]       Create a Blitz project and Git repository
  dev [--port <port>]         Start the local editor
  doctor [--port <port>]      Check the local development prerequisites
  checkpoint [label]          Commit a project checkpoint
  restore [hash]              Restore files from a checkpoint
  archive                     Write a sanitized project source ZIP
  publish [options]           Publish the project
  pull [--force]              Pull the active release
  status                      Show local deploy status
  claim --email <email> --password <password> [--login]
                              Register or sign in, then claim local deploys
  bake <nodeName> [--force]   Bake a Generator node
  check                       Check Playable, Editable, and Persisted outcomes
  journal [options]           Read the edit journal
  open                        Open the running local editor
  sources                     Locate installed source
  upgrade [--to <x.y.z>]      Upgrade the project Blitz version

Run blitz <command> --help for command usage.`

const COMMAND_USAGE: Record<string, string> = {
    init: 'Usage: blitz init [dir] [--no-git]',
    dev: 'Usage: blitz dev [--port <port>] [--no-open] [--force]',
    doctor: 'Usage: blitz doctor [--port <port>]',
    checkpoint: 'Usage: blitz checkpoint [label]',
    restore: 'Usage: blitz restore [hash]',
    archive: 'Usage: blitz archive',
    publish: 'Usage: blitz publish [--slug <slug>] [--name <name>] [--message <message>] [--no-check] [--no-verify]',
    pull: 'Usage: blitz pull [--force]',
    status: 'Usage: blitz status',
    claim: 'Usage: blitz claim --email <email> --password <password> [--login]',
    bake: 'Usage: blitz bake <nodeName> [--force]',
    check: 'Usage: blitz check',
    journal: 'Usage: blitz journal [--since <iso>] [-n <count>]',
    open: 'Usage: blitz open',
    sources: 'Usage: blitz sources',
    upgrade: 'Usage: blitz upgrade [--to <x.y.z>]',
}

const [command = 'help', ...args] = process.argv.slice(2)

try {
    const skipsVersionRule = command === 'help' || command === '--help' || command === '-h' || command === 'doctor'
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
        console.log(BLITZ_VERSION)
    } else if (!COMMAND_USAGE[command]) {
        throw new Error(`Unknown command: ${command}\n${ROOT_USAGE}`)
    } else if (args.includes('--help') || args.includes('-h')) {
        const extras = args.filter((argument) => argument !== '--help' && argument !== '-h')
        if (extras.length) throw new Error(`--help cannot be combined with other arguments.\n${COMMAND_USAGE[command]}`)
        console.log(COMMAND_USAGE[command])
    } else if (command === 'init') {
        const parsed = parseArgs(args, {'--no-git': 'boolean'}, 1)
        const directory = parsed.positionals[0] || '.'
        const target = await initProject(directory, {git: parsed.values['--no-git'] !== true})
        console.log(`Created Blitz project at ${target}`)
        console.log(`Next: cd ${directory} && npm install && npx blitz dev`)
    } else if (command === 'doctor') {
        const parsed = parseArgs(args, {'--port': 'value'})
        const result = await doctorProject(process.cwd(), {port: portOption(parsed.values['--port'])})
        console.log(formatDoctorTable(result))
        if (!result.ok) process.exitCode = 1
    } else if (command === 'checkpoint') {
        const parsed = parseArgs(args, {}, 1)
        const result = await checkpointProject(process.cwd(), parsed.positionals[0])
        console.log(`Checkpoint ${result.hash}${result.label ? ` ${result.label}` : ''}`)
    } else if (command === 'restore') {
        const parsed = parseArgs(args, {}, 1)
        const result = await restoreProject(process.cwd(), parsed.positionals[0])
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
        console.log(`Blitz editor: ${server.url}`)
        console.log(`Project: ${server.projectRoot}`)
        const shutdown = async () => {
            await server.close()
            process.exit(0)
        }
        process.once('SIGINT', shutdown)
        process.once('SIGTERM', shutdown)
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
        if (!entries.length) console.log('No deploys. Run blitz publish first.')
        for (const entry of entries) console.log(JSON.stringify({...entry, time_left: timeLeft(entry)}))
    } else if (command === 'claim') {
        const parsed = parseArgs(args, {'--email': 'value', '--password': 'value', '--login': 'boolean'})
        const email = requiredOption(parsed.values['--email'], '--email')
        const password = requiredOption(parsed.values['--password'], '--password')
        const entries = await claimFromDisk({email, password, login: parsed.values['--login'] === true})
        for (const entry of entries.filter(({claimed}) => claimed)) console.log(`Claimed ${entry.slug}: ${entry.preview_url}`)
    } else if (command === 'open') {
        parseArgs(args, {})
        console.log(await openCurrentProject())
    } else if (command === 'sources') {
        parseArgs(args, {})
        console.log(await sourcesInstructions())
    } else if (command === 'bake') {
        const parsed = parseArgs(args, {'--force': 'boolean'}, 1)
        const nodeName = parsed.positionals[0] || ''
        const result = await bakeFromEditor(nodeName, {force: parsed.values['--force'] === true})
        console.log(`Baked ${String(result.nodeName || nodeName)}`)
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
        const parsed = parseArgs(args, {'--to': 'value'})
        const result = await upgradeProject(process.cwd(), {to: valueOption(parsed.values['--to'])})
        console.log(`Upgraded Blitz from ${result.from} to ${result.to}`)
    }
} catch (error) {
    console.error(`blitz: ${sanitizeDiagnostic(error instanceof Error ? error.message : error)}`)
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

function requiredOption(value: string | boolean | undefined, name: string): string {
    const result = valueOption(value)
    if (!result) throw new Error(`${name} is required`)
    return result
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

function timeLeft(entry: {claimed: boolean, expires_at: string}): string {
    if (entry.claimed) return 'claimed'
    const hasZone = /[zZ]|[+-]\d\d:\d\d$/.test(entry.expires_at)
    const expires = Date.parse(entry.expires_at.replace(' ', 'T') + (hasZone ? '' : 'Z'))
    const milliseconds = expires - Date.now()
    if (!Number.isFinite(milliseconds) || milliseconds <= 0) return 'expired'
    const minutes = Math.ceil(milliseconds / 60_000)
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}
