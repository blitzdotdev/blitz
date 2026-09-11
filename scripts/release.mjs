#!/usr/bin/env node

import {execFileSync} from 'node:child_process'
import {copyFile, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

import {registerRuntime} from './register-runtime.mjs'
import {uploadAgentsMd} from './upload-agents-md.mjs'

const repositoryDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const publishOrder = ['engine', 'editor', 'kite3d']
const lockstepPackages = new Set(['@kite3d/engine', '@kite3d/editor', 'kite3d'])
const isLockstepPackage = name => lockstepPackages.has(name)

function run(command, args, {environment = process.env, capture = false, allowFailure = false} = {}) {
    try {
        return execFileSync(command, args, {
            cwd: repositoryDirectory,
            encoding: 'utf8',
            env: environment,
            stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
        })
    } catch (error) {
        if (allowFailure) return null
        if (capture && error.stderr) process.stderr.write(error.stderr)
        throw error
    }
}

export function publishPackage({name, version, workspace, dryRun, environment, commandRunner = run, logger = console.log}) {
    const packageSpec = `${name}@${version}`
    const publishedVersion = commandRunner('npm', ['view', packageSpec, 'version'], {
        environment,
        capture: true,
        allowFailure: true,
    })?.trim()
    if (publishedVersion) {
        logger(`${packageSpec} already published, skipping`)
        return false
    }

    const arguments_ = ['publish', '--workspace', workspace, '--access', 'public']
    if (dryRun) arguments_.push('--dry-run')
    commandRunner('npm', arguments_, {environment})
    return true
}

function parseArguments(arguments_) {
    const knownArguments = new Set(['--dry-run', '--publish', '--register'])
    const unknown = arguments_.filter(argument => !knownArguments.has(argument))
    if (unknown.length) throw new Error(`Unknown argument: ${unknown.join(', ')}`)
    if (arguments_.includes('--dry-run') && arguments_.includes('--publish')) {
        throw new Error('--dry-run and --publish are mutually exclusive.')
    }

    const publish = arguments_.includes('--publish')
    const dryRun = arguments_.includes('--dry-run') || (!process.env.CI && !publish)
    if (!dryRun && !publish) throw new Error('CI releases must explicitly pass --dry-run or --publish.')
    return {dryRun, register: arguments_.includes('--register')}
}

async function readJson(path) {
    return JSON.parse(await readFile(resolve(repositoryDirectory, path), 'utf8'))
}

async function validateLockstepVersion() {
    const rootManifest = await readJson('package.json')
    const manifests = await Promise.all(publishOrder.map(name => readJson(`packages/${name}/package.json`)))
    for (const manifest of manifests) {
        if (manifest.version !== rootManifest.version) {
            throw new Error(`${manifest.name} is ${manifest.version}; expected lockstep version ${rootManifest.version}.`)
        }
        for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
            for (const [name, version] of Object.entries(manifest[section] ?? {})) {
                if (isLockstepPackage(name) && version !== rootManifest.version) {
                    throw new Error(`${manifest.name} pins ${name} to ${version}; expected exact pin ${rootManifest.version}.`)
                }
            }
        }
    }
    const lockfile = await readJson('package-lock.json')
    for (const path of ['', ...publishOrder.map(name => `packages/${name}`)]) {
        const lockedManifest = lockfile.packages?.[path]
        if (!lockedManifest || lockedManifest.version !== rootManifest.version) {
            throw new Error(`package-lock.json entry ${path || '<root>'} is not at ${rootManifest.version}.`)
        }
        for (const [name, version] of Object.entries(lockedManifest.dependencies ?? {})) {
            if (isLockstepPackage(name) && version !== rootManifest.version) {
                throw new Error(`package-lock.json entry ${path} pins ${name} to ${version}; expected ${rootManifest.version}.`)
            }
        }
    }
    return rootManifest.version
}

function verifyGitState(version, dryRun) {
    const status = run('git', ['status', '--porcelain'], {capture: true}).trim()
    if (status) throw new Error('Release requires a clean git tree.')

    const branch = run('git', ['branch', '--show-current'], {capture: true}).trim()
    if (dryRun) return branch
    if (branch === 'main' || branch === 'release' || branch.startsWith('release/')) return branch

    if (!branch) {
        const exactTag = run('git', ['describe', '--tags', '--exact-match', 'HEAD'], {
            capture: true,
            allowFailure: true,
        })?.trim()
        if (exactTag === `v${version}`) return branch
    }
    throw new Error(`Releases must run from main, a release branch, or the matching v${version} tag.`)
}

async function createNpmEnvironment() {
    if (!process.env.NPM_TOKEN) return {environment: process.env, cleanup: async () => {}}

    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'kite3d-release-npm-'))
    const userConfig = join(temporaryDirectory, '.npmrc')
    await writeFile(userConfig, '//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n', {mode: 0o600})
    return {
        environment: {...process.env, NPM_CONFIG_USERCONFIG: userConfig},
        cleanup: () => rm(temporaryDirectory, {recursive: true, force: true}),
    }
}

function finishTag(version, branch, dryRun, registered) {
    const tag = `v${version}`
    if (dryRun) {
        console.log(`Dry run complete; ${registered ? 'performed backend uploads by request but' : 'skipped backend uploads and'} tag ${tag}.`)
        console.log(`After a real release, push with: git push origin ${branch ? `${branch} ` : ''}${tag}`)
        return
    }

    const taggedCommit = run('git', ['rev-list', '-n', '1', tag], {capture: true, allowFailure: true})?.trim()
    const head = run('git', ['rev-parse', 'HEAD'], {capture: true}).trim()
    if (taggedCommit && taggedCommit !== head) throw new Error(`${tag} already exists on a different commit.`)
    if (!taggedCommit) run('git', ['tag', tag])
    else console.log(`${tag} already points to HEAD.`)
    console.log(`Release complete. Push with: git push origin ${branch ? `${branch} ` : ''}${tag}`)
}

async function release() {
    const {dryRun, register} = parseArguments(process.argv.slice(2))
    await copyFile(
        resolve(repositoryDirectory, 'packages/kite3d/template/AGENTS.md'),
        resolve(repositoryDirectory, 'docs/agents.md'),
    )
    const version = await validateLockstepVersion()
    const branch = verifyGitState(version, dryRun)
    const npm = await createNpmEnvironment()

    console.log(`${dryRun ? 'Dry-running' : 'Publishing'} Kite3D ${version}`)
    try {
        run('npm', ['run', 'build'], {environment: npm.environment})
        run('npm', ['run', 'typecheck'], {environment: npm.environment})
        run('npm', ['run', 'lint'], {environment: npm.environment})
        run('npm', ['run', 'test:kite3d'], {environment: npm.environment})
        run('npm', ['run', 'test:runtime'], {environment: npm.environment})

        for (const name of publishOrder) {
            const manifest = await readJson(`packages/${name}/package.json`)
            publishPackage({
                name: manifest.name,
                version: manifest.version,
                workspace: `packages/${name}`,
                dryRun,
                environment: npm.environment,
            })
        }

        const registered = !dryRun || register
        if (registered) {
            await registerRuntime()
            await uploadAgentsMd()
        }
        finishTag(version, branch, dryRun, registered)
    } finally {
        await npm.cleanup()
    }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
    try {
        await release()
    } catch (error) {
        console.error(`release: ${error.message}`)
        process.exitCode = 1
    }
}
