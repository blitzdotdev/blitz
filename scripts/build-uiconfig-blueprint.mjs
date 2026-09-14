#!/usr/bin/env node

import {execFileSync} from 'node:child_process'
import {rm} from 'node:fs/promises'
import {resolve} from 'node:path'

const repositoryDirectory = resolve(import.meta.dirname, '..')
const uiDirectory = resolve(repositoryDirectory, 'packages/uiconfig-blueprint')
const outputDirectory = resolve(uiDirectory, 'lib')

function run(script, args, cwd) {
    execFileSync(process.execPath, [script, ...args], {cwd, stdio: 'inherit'})
}

await rm(outputDirectory, {recursive: true, force: true})
run(resolve(repositoryDirectory, 'node_modules/typescript/bin/tsc'), ['-p', './src'], uiDirectory)
run(resolve(repositoryDirectory, 'node_modules/@blueprintjs/node-build-scripts/sass-compile.mjs'), [
    resolve(uiDirectory, 'src'),
    '--output',
    resolve(outputDirectory, 'css'),
], repositoryDirectory)
run(resolve(uiDirectory, 'scripts/fix-css-imports.mjs'), [], uiDirectory)
