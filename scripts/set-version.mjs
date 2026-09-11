#!/usr/bin/env node

import {execFileSync} from 'node:child_process'
import {readFile, writeFile} from 'node:fs/promises'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const publishableManifests = [
    'packages/engine/package.json',
    'packages/editor/package.json',
    'packages/kite3d/package.json',
]
const lockstepPackages = new Set(['@blitzdev/engine', '@blitzdev/editor', 'kite3d'])
const dependencySections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

export function computeVersion(currentVersion, requestedVersion) {
    const match = semverPattern.exec(currentVersion)
    if (!match) throw new Error(`Root package version is not a stable semantic version: ${currentVersion}`)

    if (semverPattern.test(requestedVersion)) return requestedVersion
    if (!['patch', 'minor', 'major'].includes(requestedVersion)) {
        throw new Error('Version must be patch, minor, major, or an explicit x.y.z version.')
    }

    let [, major, minor, patch] = match.map(Number)
    if (requestedVersion === 'patch') patch += 1
    if (requestedVersion === 'minor') {
        minor += 1
        patch = 0
    }
    if (requestedVersion === 'major') {
        major += 1
        minor = 0
        patch = 0
    }
    return `${major}.${minor}.${patch}`
}

async function readManifest(path) {
    return JSON.parse(await readFile(path, 'utf8'))
}

async function writeManifest(path, manifest) {
    await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`)
}

export async function rewriteManifests(repositoryDirectory, newVersion) {
    const manifestPaths = ['package.json', ...publishableManifests]
    const manifests = await Promise.all(manifestPaths.map(path => readManifest(resolve(repositoryDirectory, path))))

    for (const manifest of manifests) manifest.version = newVersion
    for (const manifest of manifests.slice(1)) {
        for (const section of dependencySections) {
            if (!manifest[section]) continue
            for (const dependency of Object.keys(manifest[section])) {
                if (lockstepPackages.has(dependency)) {
                    manifest[section][dependency] = newVersion
                }
            }
        }
    }

    await Promise.all(manifestPaths.map((path, index) => writeManifest(resolve(repositoryDirectory, path), manifests[index])))
}

function run(command, args, options = {}) {
    return execFileSync(command, args, {encoding: 'utf8', ...options})
}

export async function setVersion({
    repositoryDirectory,
    requestedVersion,
    allowDirty = false,
}) {
    if (!allowDirty) {
        const status = run('git', ['status', '--porcelain'], {cwd: repositoryDirectory}).trim()
        if (status) throw new Error('Refusing to set the version on a dirty git tree. Commit or stash changes, or pass --allow-dirty.')
    }

    const rootManifestPath = resolve(repositoryDirectory, 'package.json')
    const currentVersion = (await readManifest(rootManifestPath)).version
    const newVersion = computeVersion(currentVersion, requestedVersion)
    const protectedPaths = ['package.json', ...publishableManifests, 'package-lock.json']
    const originals = new Map(await Promise.all(protectedPaths.map(async path => [
        path,
        await readFile(resolve(repositoryDirectory, path), 'utf8'),
    ])))

    try {
        await rewriteManifests(repositoryDirectory, newVersion)
        run('npm', [
            'install',
            '--package-lock-only',
            '--ignore-scripts',
            '--cache',
            '/tmp/kite3d-npm-cache',
        ], {cwd: repositoryDirectory, stdio: 'inherit'})
    } catch (error) {
        await Promise.all([...originals].map(([path, contents]) => writeFile(resolve(repositoryDirectory, path), contents)))
        throw error
    }

    console.log(`Version: ${currentVersion} -> ${newVersion}`)
    return {currentVersion, newVersion}
}

function parseArguments(arguments_) {
    const allowDirty = arguments_.includes('--allow-dirty')
    const positional = arguments_.filter(argument => argument !== '--allow-dirty')
    if (positional.length !== 1) {
        throw new Error('Usage: node scripts/set-version.mjs <patch|minor|major|x.y.z> [--allow-dirty]')
    }
    return {allowDirty, requestedVersion: positional[0]}
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
    try {
        const repositoryDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
        await setVersion({repositoryDirectory, ...parseArguments(process.argv.slice(2))})
    } catch (error) {
        console.error(`set-version: ${error.message}`)
        process.exitCode = 1
    }
}
