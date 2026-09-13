import {expect, test, type Locator, type Page} from '@playwright/test'
import {execFile} from 'node:child_process'
import {mkdir, mkdtemp, readFile, rm, symlink} from 'node:fs/promises'
import {homedir} from 'node:os'
import {resolve} from 'node:path'
import {promisify} from 'node:util'
import {initProject, runDev} from '../../../kite3d/src/commands.ts'
import {createHubServer, type HubServer} from '../../../kite3d/src/hub.ts'
import {readDevelopmentServer, stopDevelopmentServer} from '../../../kite3d/src/hubRoutes.ts'
import {registerProject} from '../../../kite3d/src/projectIndex.ts'
import type {DevServer} from '../../../kite3d/src/server.ts'

const executeFile = promisify(execFile)
const viewport = {width: 1400, height: 900}
const screenshotDirectory = resolve(import.meta.dirname, '../../test-results/hub')
const kite3dPackage = resolve(import.meta.dirname, '../../../kite3d')
const googleScriptUrl = 'https://accounts.google.com/gsi/client'

interface HubFixture {
    root: string
    home: string
    main: string
    feature: string
    detached: string
    detachedCommit: string
    loose: string
    nested: string
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
    const main = resolve(root, 'terminator')
    const feature = resolve(root, 'terminator-feature')
    const detached = resolve(root, 'terminator-detached')
    const loose = resolve(root, 'terminator-v2')
    const folders = resolve(root, 'folders')
    const nested = resolve(folders, 'nested')
    const tools = resolve(root, 'tools')
    const detachedPaths = new Set<string>()
    try {
        await initProject(main)
        await executeFile('git', ['-C', main, 'worktree', 'add', '-qb', 'hub-feature', feature])
        await executeFile('git', ['-C', main, 'worktree', 'add', '-q', '--detach', detached, 'HEAD'])
        const {stdout: detachedHead} = await executeFile('git', ['-C', detached, 'rev-parse', '--short=7', 'HEAD'])
        const detachedCommit = detachedHead.trim()
        await linkKite3d(main)
        await linkKite3d(feature)
        await initProject(loose, {git: false})
        await linkKite3d(loose)
        await registerProject(loose)
        await mkdir(nested, {recursive: true})
        await mkdir(tools)
        await executeFile('git', ['-C', tools, 'init', '-q'])
        const mainServer = await runDev({projectRoot: main, port: 0, noOpen: true})
        const hub = await createHubServer(0)
        fixture = {
            root, home, main, feature, detached, detachedCommit, loose, nested, hub, mainServer, detachedPaths,
            previousHome, previousGitCeiling,
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
        await stopDevelopmentServer(current.feature).catch(() => undefined)
        await stopDevelopmentServer(current.loose).catch(() => undefined)
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

test('hub mode shows active editors and projects without a viewport or ports', async ({page}) => {
    const current = requiredFixture()
    await page.goto(current.hub.url)
    const dialog = page.locator('#welcome-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', {name: 'Open a project'})).toBeVisible()
    await expect(dialog.locator('#welcome-sidebar-list-button-projects')).toHaveText('Projects')
    await expect(page.locator('.editorCanvasContainer')).toHaveCount(0)
    await expect(page.locator('.bp5-navbar')).toHaveText(/Kite 3D/)
    await expect(page.locator('.bp5-navbar button')).toHaveCount(1)

    await expect(dialog.getByText('Active editors', {exact: true})).toBeVisible()
    await expect(dialog.locator('.hub-active-row')).toHaveCount(1)
    await expect(dialog.locator('.hub-repo-group')).toHaveCount(1)
    await expect(dialog.locator('.hub-repo-group .hub-project-row.is-indented')).toHaveCount(3)
    await expect(dialog.getByText('hub-feature', {exact: true})).toBeVisible()
    const detachedTag = dialog.locator('.hub-branch-tag').filter({hasText: current.detachedCommit})
    await expect(detachedTag).toHaveText(current.detachedCommit)
    await expect(detachedTag).toHaveAttribute('title', 'detached')
    await expect(dialog.getByText('terminator-v2', {exact: true})).toBeVisible()
    await expect(dialog.getByText('Running', {exact: true})).toHaveCount(1)
    expect(await dialog.innerText()).not.toMatch(/:4\d{3}/)

    await mkdir(screenshotDirectory, {recursive: true})
    await page.screenshot({path: resolve(screenshotDirectory, 'dialog-lists.png')})
})

test('shows the server install instruction when an uninstalled worktree cannot start', async ({page}) => {
    const current = requiredFixture()
    await page.goto(current.hub.url)
    const worktree = page.locator('.hub-project-row.is-indented').filter({hasText: current.detachedCommit})
    await expect(worktree).toBeVisible()

    await worktree.getByRole('button', {name: 'Open'}).click()
    await expect(worktree.getByTestId('hub-project-error')).toHaveText(`Run npm install in ${current.detached} first.`)
})

test('opens a stopped worktree in a new page and stops its server', async ({page, context}) => {
    const current = requiredFixture()
    current.detachedPaths.add(current.feature)
    await page.goto(current.hub.url)
    const worktree = page.locator('.hub-project-row.is-indented').filter({hasText: 'hub-feature'})
    await expect(worktree).toBeVisible()

    const openedPromise = context.waitForEvent('page')
    await worktree.getByRole('button', {name: 'Open'}).click()
    const opened = await openedPromise
    await expect.poll(() => readDevelopmentServer(current.feature)).not.toBeNull()
    const expectedUrl = (await readDevelopmentServer(current.feature))!.url
    await expect.poll(() => opened.url()).toBe(expectedUrl)
    await opened.close()

    const active = page.locator('.hub-active-row').filter({hasText: 'hub-feature'})
    await expect(active).toBeVisible()
    await active.getByRole('button', {name: 'Stop'}).click()
    await expect.poll(() => readDevelopmentServer(current.feature)).toBeNull()
    await expect(active).toHaveCount(0)
})

test('folder list descends, ascends, and stops at the home folder', async ({page}) => {
    const current = requiredFixture()
    await page.goto(current.hub.url)
    await page.getByRole('button', {name: 'Open Project', exact: true}).click()
    const folderView = page.getByTestId('hub-open-project')
    await expect(folderView).toBeVisible()
    await expect(folderView.locator('.hub-path-bar code')).toContainText('kite3d editor hub')

    await folderView.locator('.hub-folder-row').filter({hasText: 'folders'}).click()
    await expect(folderView.locator('.hub-path-bar code')).toHaveText(/\/folders$/)
    await folderView.locator('.hub-folder-row').filter({hasText: 'nested'}).click()
    await expect(folderView.locator('.hub-path-bar code')).toHaveText(/\/folders\/nested$/)
    await folderView.getByRole('button', {name: 'Up', exact: true}).click()
    await expect(folderView.locator('.hub-path-bar code')).toHaveText(/\/folders$/)
    await folderView.getByRole('button', {name: 'Up', exact: true}).click()
    await expect(folderView.locator('.hub-path-bar code')).toHaveText(displayPath(current.root))
    await folderView.getByRole('button', {name: 'Up', exact: true}).click()
    await expect(folderView.locator('.hub-path-bar code')).toHaveText('~')
    await expect(folderView.getByRole('button', {name: 'Up', exact: true})).toBeDisabled()

    await folderView.getByRole('button', {name: 'Cancel'}).click()
    await page.getByRole('button', {name: 'Open Project', exact: true}).click()
    await expect(folderView.locator('.hub-folder-row').filter({hasText: 'tools'}).getByText('git repo, not a Kite3D project')).toBeVisible()
    await mkdir(screenshotDirectory, {recursive: true})
    await page.screenshot({path: resolve(screenshotDirectory, 'folder-list.png')})
})

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

test('project picker and Worktrees section open a worktree in a new page', async ({page, context}) => {
    const current = requiredFixture()
    current.detachedPaths.add(current.feature)
    await page.goto(current.mainServer.url)
    await expect(page.getByText('Project loaded', {exact: true})).toBeVisible({timeout: 20_000})
    await expect(page.locator('#welcome-dialog')).toHaveCount(0)

    await page.getByRole('tab', {name: 'Project'}).click()
    const section = page.locator('.kite3d-project-section').filter({hasText: 'Worktrees'})
    await expect(section).toBeVisible()
    await expect(section.locator('.kite3d-worktree-row')).toHaveCount(3)
    await expect(section.locator('.hub-branch-tag').filter({hasText: current.detachedCommit})).toHaveAttribute('title', 'detached')
    await expect(section.getByText('this tab', {exact: true})).toHaveCount(1)
    await expect(section.getByText('Running', {exact: true})).toHaveCount(1)
    await mkdir(screenshotDirectory, {recursive: true})
    await page.screenshot({path: resolve(screenshotDirectory, 'worktrees-section.png')})

    const picker = page.getByTestId('project-picker')
    await picker.click()
    const menu = page.getByTestId('hub-project-menu')
    await waitForProjectMenu(picker, menu)
    await expect(menu.getByText('Active editors', {exact: true})).toBeVisible()
    await expect(menu.getByText('Projects', {exact: true})).toBeVisible()
    await page.screenshot({path: resolve(screenshotDirectory, 'picker-menu.png')})

    await waitForProjectMenu(picker, menu)
    const openedPromise = context.waitForEvent('page')
    await menu.locator('.hub-worktree-menu-item').filter({hasText: 'hub-feature'}).click()
    const opened = await openedPromise
    const expectedUrl = (await readDevelopmentServer(current.feature))!.url
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

async function waitForProjectMenu(picker: Locator, menu: Locator): Promise<void> {
    await expect(menu).toBeVisible()
    const target = picker.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " bp5-popover-target ")]').first()
    await expect(target).toHaveClass(/bp5-popover-open/)
    const transition = menu.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " bp5-popover-transition-container ")]').first()
    await expect(transition).toHaveClass(/bp5-popover-enter-done/)
}

function requiredFixture(): HubFixture {
    if (!fixture) throw new Error('Hub fixture is not available')
    return fixture
}

function displayPath(path: string): string {
    return path.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, '~')
}
