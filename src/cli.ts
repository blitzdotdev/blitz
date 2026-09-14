#!/usr/bin/env node
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {initProject, runDev, screenshotFromDisk} from './commands.ts'
import {assertKite3dProjectRoot, isKite3dProjectRoot} from './project-root.ts'
import {bundledSkills} from './skills.ts'
import {KITE3D_VERSION} from './versions.ts'

const ROOT_USAGE = `Kite3D ${KITE3D_VERSION} builds browser 3D games with an agent and a local editor.
Workflow:
  npx kite3d init my-game && cd my-game && npm install
  Read AGENTS.md in the project. It is the guide: engine API, scene file, rules.
  npx kite3d dev        runs the local editor while you edit
  npx kite3d publish    points to the bundled publishing procedure

Usage: kite3d <command> [options]

Commands:
  init [dir]                  Create a Kite3D project
  dev [options]               Start the local editor in the foreground
  screenshot [options]        Save a PNG of the editor viewport
  skills [--json]             List bundled skills and their readable paths
  publish                     Print the publishing procedure path

Run kite3d <command> --help for command usage.`

const COMMAND_USAGE: Record<string, string> = {
    init: 'Usage: kite3d init [dir]',
    dev: 'Usage: kite3d dev [--port <port>] [--no-open]',
    screenshot: 'Usage: kite3d screenshot [--name <name>] [--headless] [--full] [--width <px>] [--height <px>] [--json]',
    skills: 'Usage: kite3d skills [--json]',
    publish: publishMessage(),
}

const [command = 'help', ...args] = process.argv.slice(2)

try {
    if (command === 'help' || command === '--help' || command === '-h') {
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
        const parsed = parseArgs(args, {}, 1)
        const directory = parsed.positionals[0] || '.'
        if (await isKite3dProjectRoot(resolve(directory))) {
            console.log(`${directory} is already a Kite3D project. Next: cd ${directory} && npx kite3d dev`)
        } else {
            const target = await initProject(directory)
            console.log(`Created Kite3D project at ${target}`)
            console.log(`Next: cd ${directory} && npm install && npx kite3d dev`)
            console.log('Then read AGENTS.md in the project before you write code. Build and inspect the saved project.')
        }
    } else if (command === 'dev') {
        await assertKite3dProjectRoot(process.cwd())
        const parsed = parseArgs(args, {'--port': 'value', '--no-open': 'boolean'})
        const port = portOption(parsed.values['--port'])
        const server = await runDev({
            port,
            strictPort: port !== undefined,
            noOpen: parsed.values['--no-open'] === true,
        })
        const shutdown = async () => {
            await server.close()
            process.exit(0)
        }
        process.once('SIGINT', shutdown)
        process.once('SIGTERM', shutdown)
        console.log(`Kite3D editor: ${server.url} (Kite3D ${KITE3D_VERSION})`)
        console.log(`Project: ${server.projectRoot}`)
        console.log('Guide: AGENTS.md in this folder. Inspect the saved project before sharing it.')
    } else if (command === 'screenshot') {
        await assertKite3dProjectRoot(process.cwd())
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
    } else if (command === 'skills') {
        const parsed = parseArgs(args, {'--json': 'boolean'})
        const skills = await bundledSkills()
        const output = parsed.values['--json'] === true
            ? JSON.stringify(skills)
            : skills.map(({name, path}) => `${name}\t${path}`).join('\n')
        if (output) console.log(output)
    } else if (command === 'publish') {
        parseArgs(args, {})
        console.log(publishMessage())
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

function positiveIntegerOption(value: string | boolean | undefined, name: string): number | undefined {
    const raw = valueOption(value)
    if (raw === undefined) return undefined
    const integer = Number(raw)
    if (!Number.isInteger(integer) || integer < 1) throw new Error(`${name} must be a positive integer`)
    return integer
}
