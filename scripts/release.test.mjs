import assert from 'node:assert/strict'
import {test} from 'node:test'

import {publishPackage} from './release.mjs'

const packageDetails = {
    name: '@kite3d/engine',
    version: '1.2.3',
    workspace: 'packages/engine',
}

test('skips a package version that is already published', () => {
    const calls = []
    const messages = []
    const environment = {NPM_CONFIG_USERCONFIG: '/tmp/test-npmrc'}
    const commandRunner = (command, arguments_, options) => {
        calls.push({command, arguments_, options})
        return '1.2.3\n'
    }

    const published = publishPackage({
        ...packageDetails,
        dryRun: false,
        environment,
        commandRunner,
        logger: message => messages.push(message),
    })

    assert.equal(published, false)
    assert.deepEqual(calls, [{
        command: 'npm',
        arguments_: ['view', '@kite3d/engine@1.2.3', 'version'],
        options: {environment, capture: true, allowFailure: true},
    }])
    assert.deepEqual(messages, ['@kite3d/engine@1.2.3 already published, skipping'])
})

test('publishes an unpublished package in real and dry-run modes', () => {
    for (const dryRun of [false, true]) {
        const calls = []
        const environment = {NPM_CONFIG_USERCONFIG: '/tmp/test-npmrc'}
        const commandRunner = (command, arguments_, options) => {
            calls.push({command, arguments_, options})
            return arguments_[0] === 'view' ? null : undefined
        }

        const published = publishPackage({
            ...packageDetails,
            dryRun,
            environment,
            commandRunner,
        })

        assert.equal(published, true)
        assert.deepEqual(calls, [{
            command: 'npm',
            arguments_: ['view', '@kite3d/engine@1.2.3', 'version'],
            options: {environment, capture: true, allowFailure: true},
        }, {
            command: 'npm',
            arguments_: [
                'publish',
                '--workspace',
                'packages/engine',
                '--access',
                'public',
                ...(dryRun ? ['--dry-run'] : []),
            ],
            options: {environment},
        }])
    }
})
