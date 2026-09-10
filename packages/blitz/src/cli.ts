#!/usr/bin/env node
import {initProject, openCurrentProject, publishFromDisk, pullFromDisk, runDev, sourcesInstructions} from './commands.ts'

const [command = 'help', ...args] = process.argv.slice(2)

try {
    if (command === 'init') {
        const directory = args.find((value) => !value.startsWith('-')) || '.'
        const target = await initProject(directory)
        console.log(`Created Blitz project at ${target}`)
        console.log(`Next: cd ${directory} && npm install && npx blitz dev`)
    } else if (command === 'dev') {
        const port = numberOption(args, '--port') ?? 4321
        const server = await runDev({port, noOpen: args.includes('--no-open')})
        console.log(`Blitz editor: ${server.url}`)
        console.log(`Project: ${server.projectRoot}`)
        const shutdown = async () => {
            await server.close()
            process.exit(0)
        }
        process.once('SIGINT', shutdown)
        process.once('SIGTERM', shutdown)
    } else if (command === 'publish') {
        const result = await publishFromDisk(process.cwd(), stringOption(args, '--message'), (value) => {
            const progress = value as {phase?: string, completed?: number, total?: number, path?: string}
            console.log(`[${progress.phase}] ${progress.completed}/${progress.total}${progress.path ? ` ${progress.path}` : ''}`)
        })
        console.log(`Published ${result.release_hash}`)
        console.log(result.preview_url)
    } else if (command === 'pull') {
        const result = await pullFromDisk()
        console.log(`Pulled ${result.release_hash}; updated ${result.updated.length} file(s).`)
    } else if (command === 'open') {
        console.log(await openCurrentProject())
    } else if (command === 'sources') {
        console.log(await sourcesInstructions())
    } else {
        console.log('Usage: blitz <init [dir] | dev [--port 4321] [--no-open] | publish [--message text] | pull | open | sources>')
        if (command !== 'help' && command !== '--help' && command !== '-h') process.exitCode = 1
    }
} catch (error) {
    console.error(`blitz: ${error instanceof Error ? error.message : error}`)
    process.exitCode = 1
}

function stringOption(args: string[], name: string): string | undefined {
    const index = args.indexOf(name)
    return index < 0 ? undefined : args[index + 1]
}

function numberOption(args: string[], name: string): number | undefined {
    const raw = stringOption(args, name)
    if (raw === undefined) return undefined
    const value = Number(raw)
    if (!Number.isInteger(value) || value < 0 || value > 65535) throw new Error(`${name} must be a valid port`)
    return value
}
