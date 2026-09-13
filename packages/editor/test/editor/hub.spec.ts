import {expect, test, type Page} from '@playwright/test'
import {mkdir, mkdtemp, readFile, rm, symlink} from 'node:fs/promises'
import {homedir} from 'node:os'
import {resolve} from 'node:path'
import {initProject, runDev} from '../../../kite3d/src/commands.ts'
import {createHubServer, type HubServer} from '../../../kite3d/src/hub.ts'
import {readDevelopmentServer, stopDevelopmentServer} from '../../../kite3d/src/hubRoutes.ts'
import type {DevServer} from '../../../kite3d/src/server.ts'

const viewport = {width: 1400, height: 900}

const kite3dPackage = resolve(import.meta.dirname, '../../../kite3d')

const googleScriptUrl = 'https://accounts.google.com/gsi/client'

interface HubFixture {
    root: string
    hub: HubServer
    mainServer: DevServer
    detachedPaths: Set<string>
    previousHome: string | undefined
    previousGitCeiling: string | undefined
}

let fixture: HubFixture | undefined

test.beforeEach(async ({page}) => {
    test.setTimeout(90_000)
    const previousHome = process.env.KITE3D_HOME
    const previousGitCeiling = process.env.GIT_CEILING_DIRECTORIES
    const root = await mkdtemp(resolve(homedir(), 'kite3d editor hub '))
    const home = resolve(root, '.kite3d-home')
    process.env.KITE3D_HOME = home
    process.env.GIT_CEILING_DIRECTORIES = root
    const detachedPaths = new Set<string>()
    try {
        const main = resolve(root, 'fixture-project')
        await initProject(main)
        await linkKite3d(main)
        const mainServer = await runDev({projectRoot: main, port: 0, noOpen: true})
        const hub = await createHubServer(0)
        fixture = {
            root, hub, mainServer, detachedPaths, previousHome, previousGitCeiling,
        }
        await page.setViewportSize(viewport)
        await mockGoogle(page)
    } catch (error) {
        if (previousHome === undefined) delete process.env.KITE3D_HOME
        else process.env.KITE3D_HOME = previousHome
        if (previousGitCeiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES
        else process.env.GIT_CEILING_DIRECTORIES = previousGitCeiling
        await rm(root, {recursive: true, force: true})
        throw error
    }
})

test.afterEach(async () => {
    if (!fixture) return
    const current = fixture
    fixture = undefined
    try {
        for (const path of current.detachedPaths) await stopDevelopmentServer(path).catch(() => undefined)
        await current.hub.close().catch(() => undefined)
        await current.mainServer.close().catch(() => undefined)
    } finally {
        if (current.previousHome === undefined) delete process.env.KITE3D_HOME
        else process.env.KITE3D_HOME = current.previousHome
        if (current.previousGitCeiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES
        else process.env.GIT_CEILING_DIRECTORIES = current.previousGitCeiling
        await rm(current.root, {recursive: true, force: true})
    }
})

// Guards the core manual workflow: project creation starts and opens the installed editor.
test('creates a named project and opens its installed fixture server', async ({page, context}) => {
    const current = requiredFixture()
    const createdPath = resolve(current.root, 'created-game')
    await page.route('**/api/hub/projects/start', async (route) => {
        const body = route.request().postDataJSON() as {path: string}
        if (body.path === createdPath) {
            await linkKite3d(createdPath)
            current.detachedPaths.add(createdPath)
        }
        await route.continue()
    })
    await page.goto(current.hub.url)
    await page.getByRole('button', {name: 'New Project', exact: true}).click()
    const newView = page.getByTestId('hub-new-project')
    await expect(newView.locator('.hub-folder-row').first()).toBeVisible()
    await expect(newView.getByLabel('Project name')).toHaveValue('my-game')
    await newView.getByLabel('Project name').fill('created-game')

    const openedPromise = context.waitForEvent('page')
    await newView.getByRole('button', {name: 'Create'}).click()
    const opened = await openedPromise
    await expect.poll(async () => JSON.parse(await readFile(resolve(createdPath, 'package.json'), 'utf8')).name).toBe('created-game')
    const expectedUrl = (await readDevelopmentServer(createdPath))!.url
    await expect.poll(() => opened.url()).toBe(expectedUrl)
})

async function linkKite3d(project: string): Promise<void> {
    await mkdir(resolve(project, 'node_modules'), {recursive: true})
    await symlink(kite3dPackage, resolve(project, 'node_modules/kite3d'), 'dir')
}

async function mockGoogle(page: Page): Promise<void> {
    await page.route(googleScriptUrl, async (route) => {
        await route.fulfill({
            contentType: 'text/javascript',
            body: 'window.google = {accounts: {id: {initialize() {}, renderButton() {}, prompt() {}}}}',
        })
    })
}

function requiredFixture(): HubFixture {
    if (!fixture) throw new Error('Hub fixture is not available')
    return fixture
}
