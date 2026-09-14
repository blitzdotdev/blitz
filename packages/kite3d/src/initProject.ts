import {mkdir, readFile, readdir, stat, writeFile} from 'node:fs/promises'
import {dirname, relative, resolve, sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import {KITE3D_VERSION} from './versions.ts'

const TEMPLATE_RENAMES: Readonly<Record<string, string>> = {gitignore: '.gitignore'}

export async function initProject(directory = '.'): Promise<string> {
    const target = resolve(directory)
    const name = directory === '.' ? target.split(sep).at(-1)! : directory.split(/[\\/]/).filter(Boolean).at(-1)!
    await mkdir(target, {recursive: true})
    const template = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'template')
    for (const sourceName of await walkTemplate(template)) {
        const destinationName = TEMPLATE_RENAMES[sourceName] || sourceName
        const destination = resolve(target, destinationName)
        if (!destination.startsWith(`${target}${sep}`)) throw new Error('Template path escaped target directory')
        try {
            await stat(destination)
            throw new Error(`Refusing to overwrite existing file: ${relative(process.cwd(), destination)}`)
        } catch (error) {
            if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
        }
        await mkdir(dirname(destination), {recursive: true})
        let contents = await readFile(resolve(template, sourceName))
        if (destinationName === 'package.json') {
            const projectManifest = JSON.parse(contents.toString('utf8').replaceAll('__KITE3D_PROJECT_NAME__', packageName(name))) as {
                devDependencies?: Record<string, unknown>
            }
            projectManifest.devDependencies = {...projectManifest.devDependencies, kite3d: KITE3D_VERSION}
            contents = Buffer.from(`${JSON.stringify(projectManifest, null, 2)}\n`)
        }
        await writeFile(destination, contents)
    }
    return target
}

async function walkTemplate(root: string): Promise<string[]> {
    const files: string[] = []
    await visit(root, '')
    return files.sort()

    async function visit(directory: string, prefix: string): Promise<void> {
        for (const entry of await readdir(directory, {withFileTypes: true})) {
            const path = prefix ? `${prefix}/${entry.name}` : entry.name
            if (entry.isDirectory()) await visit(resolve(directory, entry.name), path)
            else if (entry.isFile()) files.push(path)
        }
    }
}

function packageName(name: string): string {
    const normalized = name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
    return normalized || 'kite3d-game'
}
