import {expect, test, type Page} from '@playwright/test'
import {mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {initProject, publishFromDisk, runDev} from '../../../kite3d/src/commands.ts'
import {closeFixtureSteps} from './fixtureClose.ts'

async function withSourceEditor(page: Page, run: (root: string) => Promise<void>) {
    const root = await mkdtemp(resolve(tmpdir(), 'kite3d-source-editor-'))
    await initProject(root)
    const packagePath = resolve(root, 'package.json')
    const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as {kite3d: {scripts?: string[]}}
    packageJson.kite3d.scripts = ['./Hot.script.js']
    await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)
    await writeFile(resolve(root, 'Hot.script.js'), hotScript('v1'))
    await writeFile(resolve(root, 'notes.txt'), 'first line\nsecond line\n')
    await writeFile(resolve(root, 'module.mjs'), 'export const example = true\n')
    await writeFile(resolve(root, 'source.md'), '# Source\n')
    await writeFile(resolve(root, 'styles.css'), 'body { color: white; }\n')
    await writeFile(resolve(root, 'source.html'), '<main>Source</main>\n')
    await writeFile(resolve(root, 'large.txt'), 'x'.repeat(1024 * 1024 + 1))
    await writeFile(resolve(root, 'pixel.png'), new Uint8Array([0x89, 0x50, 0x4e, 0x47]))

    const engineRoot = fileURLToPath(new URL('../../../engine/', import.meta.url))
    await mkdir(resolve(root, 'node_modules/@kite3d/engine/dist'), {recursive: true})
    await writeFile(resolve(root, 'node_modules/@kite3d/engine/package.json'), await readFile(resolve(engineRoot, 'package.json')))
    await writeFile(resolve(root, 'node_modules/@kite3d/engine/dist/runtime.js'), await readFile(resolve(engineRoot, 'dist/runtime.js')))
    await symlink(resolve(engineRoot, '../../node_modules/threepipe'), resolve(root, 'node_modules/threepipe'))

    const server = await runDev({projectRoot: root, port: 0, noOpen: true})
    try {
        const eventStream = page.waitForResponse((response) =>
            response.url().startsWith(`${new URL(server.url).origin}/api/events?`))
        await page.goto(server.url)
        await expect(page.getByText('Project loaded')).toBeVisible({timeout: 20_000})
        expect((await eventStream).status()).toBe(200)
        await run(root)
    } finally {
        try {
            await closeFixtureSteps([{name: 'source editor dev server', close: () => server.close()}])
        } finally {
            await rm(root, {recursive: true, force: true})
        }
    }
}

async function openSource(page: Page, path: string) {
    await page.getByTestId('project-files').getByRole('button', {name: path, exact: true}).click()
    const editor = page.getByLabel(`Source editor: ${path}`)
    await expect(editor).toBeVisible()
    return editor
}

test('opens UTF-8 project files in the Inspector and shows binary metadata only', async ({page}) => {
    await withSourceEditor(page, async () => {
        await page.getByRole('tab', {name: 'Settings'}).click()
        for (const path of [
            'Hot.script.js', 'module.mjs', 'package.json', 'assets/main.scene.gltf',
            'source.md', 'styles.css', 'source.html', 'notes.txt',
        ]) await openSource(page, path)
        const editor = page.getByLabel('Source editor: notes.txt')
        await expect(page.getByRole('tab', {name: 'Inspector'})).toHaveAttribute('aria-selected', 'true')
        await expect(editor).toHaveValue('first line\nsecond line\n')
        await expect(page.locator('.source-line-numbers')).toHaveText('1\n2\n3')

        await page.getByTestId('project-files').getByRole('button', {name: 'large.txt', exact: true}).click()
        await expect(page.getByTestId('file-metadata')).toContainText('1.0 MiB')
        await expect(page.getByText('This text file exceeds the 1 MiB source-editor limit.')).toBeVisible()
        await expect(page.locator('textarea[aria-label="Source editor: large.txt"]')).toHaveCount(0)

        await page.getByTestId('project-files').getByRole('button', {name: 'pixel.png', exact: true}).click()
        const metadata = page.getByTestId('file-metadata')
        await expect(metadata).toContainText('4 B')
        await expect(metadata).toContainText('image/png')
        await expect(page.locator('textarea[aria-label="Source editor: pixel.png"]')).toHaveCount(0)
    })
})

test('edits, reverts, saves with the keyboard, and hot reloads a saved script', async ({page}) => {
    await withSourceEditor(page, async (root) => {
        const editor = await openSource(page, 'Hot.script.js')
        await expect.poll(() => page.evaluate(() => (window as unknown as {
            __sourceEditorHotVersion?: string
        }).__sourceEditorHotVersion)).toBe('v1')

        await editor.fill('// discarded draft')
        await page.getByRole('button', {name: 'Revert', exact: true}).click()
        await expect(editor).toContainText("sourceEditorHotVersion = 'v1'")

        await editor.fill(hotScript('v2'))
        await page.keyboard.press('Meta+S')
        await expect(page.getByText('Saved.', {exact: true})).toBeVisible()
        await expect(page.getByTestId('source-editor-status')).toHaveText('Saved')
        expect(await readFile(resolve(root, 'Hot.script.js'), 'utf8')).toBe(hotScript('v2'))
        await expect.poll(() => page.evaluate(() => (window as unknown as {
            __sourceEditorHotVersion?: string
        }).__sourceEditorHotVersion)).toBe('v2')
        await expect(page.getByText('Hot.script.js reloaded')).toBeVisible()
    })
})

test('rejects a late read after the user starts typing in the current draft', async ({page}) => {
    await withSourceEditor(page, async () => {
        const current = await openSource(page, 'Hot.script.js')
        let readStarted!: () => void
        const started = new Promise<void>((resolveStarted) => { readStarted = resolveStarted })
        let releaseRead!: () => void
        const held = new Promise<void>((resolveHeld) => { releaseRead = resolveHeld })
        let readFinished!: () => void
        const finished = new Promise<void>((resolveFinished) => { readFinished = resolveFinished })
        await page.route('**/files/notes.txt*', async (route) => {
            readStarted()
            await held
            const response = await route.fetch()
            await route.fulfill({response})
            readFinished()
        }, {times: 1})

        await page.getByTestId('project-files').getByRole('button', {name: 'notes.txt', exact: true}).click()
        await started
        await page.getByTestId('project-files').getByRole('button', {name: 'Hot.script.js', exact: true}).click()
        await current.fill('// newest human draft')
        releaseRead()
        await finished

        await expect(current).toHaveValue('// newest human draft')
        await expect(page.getByTestId('source-editor-status')).toHaveText('Unsaved changes')
    })
})

test('snapshots a save so typing during the request remains unsaved', async ({page}) => {
    await withSourceEditor(page, async (root) => {
        const editor = await openSource(page, 'notes.txt')
        let writeStarted!: () => void
        const started = new Promise<void>((resolveStarted) => { writeStarted = resolveStarted })
        let releaseWrite!: () => void
        const held = new Promise<void>((resolveHeld) => { releaseWrite = resolveHeld })
        await page.route('**/files/notes.txt*', async (route) => {
            if (route.request().method() !== 'PUT') {
                await route.continue()
                return
            }
            writeStarted()
            await held
            await route.continue()
        }, {times: 1})

        await editor.fill('// snapshot being saved')
        await page.getByTestId('source-editor').getByRole('button', {name: 'Save', exact: true}).click()
        await started
        await editor.fill('// newer human draft')
        releaseWrite()

        await expect(page.getByText('Saved the earlier draft. Your newer edits are still unsaved.')).toBeVisible()
        await expect(editor).toHaveValue('// newer human draft')
        await expect(page.getByTestId('source-editor-status')).toHaveText('Unsaved changes')
        await expect(page.getByTestId('source-editor').getByRole('button', {name: 'Save', exact: true})).toBeEnabled()
        await expect.poll(() => readFile(resolve(root, 'notes.txt'), 'utf8')).toBe('// snapshot being saved')
    })
})

test('reloads an external change silently while the draft is clean', async ({page}) => {
    await withSourceEditor(page, async (root) => {
        const editor = await openSource(page, 'notes.txt')
        await expect(page.getByTestId('source-editor-status')).toHaveText('Saved')
        await writeFile(resolve(root, 'notes.txt'), '// external clean update')

        await expect(editor).toHaveValue('// external clean update', {timeout: 10_000})
        await expect(page.getByText('This file changed on disk.')).toHaveCount(0)
        await expect(page.getByTestId('source-editor-status')).toHaveText('Saved')
    })
})

test('preserves a dirty draft on external change and resolves conflicts with Reload or Overwrite', async ({page}) => {
    await withSourceEditor(page, async (root) => {
        const editor = await openSource(page, 'notes.txt')
        await editor.fill('// local draft')
        await expect(page.getByTestId('source-editor-status')).toHaveText('Unsaved changes')
        await writeFile(resolve(root, 'notes.txt'), '// external dirty update')

        await expect(page.getByText(/Your unsaved draft has been preserved/)).toBeVisible({timeout: 10_000})
        await expect(editor).toHaveValue('// local draft')
        await expect(page.getByTestId('source-editor').getByRole('button', {name: 'Save', exact: true})).toBeDisabled()
        await page.getByRole('button', {name: 'Reload', exact: true}).click()
        await expect(editor).toHaveValue('// external dirty update')
        await expect(page.getByTestId('source-editor-status')).toHaveText('Saved')

        await page.route('**/files/notes.txt*', async (route) => {
            if (route.request().method() === 'PUT') await writeFile(resolve(root, 'notes.txt'), '// raced disk update')
            await route.continue()
        }, {times: 1})
        await editor.fill('// explicit overwrite')
        await expect(page.getByTestId('source-editor-status')).toHaveText('Unsaved changes')
        await page.getByTestId('source-editor').getByRole('button', {name: 'Save', exact: true}).click()
        await expect(page.getByText(/Reload it or overwrite the current disk version/)).toBeVisible()
        await expect(editor).toHaveValue('// explicit overwrite')
        await page.getByRole('button', {name: 'Overwrite', exact: true}).click()
        await expect(page.getByText('Saved.', {exact: true})).toBeVisible()
        await expect(page.getByTestId('source-editor').getByRole('button', {name: 'Save', exact: true}))
            .not.toHaveClass(/bp5-loading/)
        await expect.poll(() => readFile(resolve(root, 'notes.txt'), 'utf8')).toBe('// explicit overwrite')
    })
})

test('marks the editor state dirty so kite3d publish refuses an unsaved source draft', async ({page}) => {
    await withSourceEditor(page, async (root) => {
        const editor = await openSource(page, 'notes.txt')
        await editor.fill('// save before publishing')
        await expect.poll(async () => JSON.parse(await readFile(resolve(root, '.kite3d/state.json'), 'utf8')).dirty).toBe(true)

        await expect(publishFromDisk(root, {slug: 'dirty-source-draft', noCheck: true, noVerify: true}))
            .rejects.toThrow('Save the unsaved editor draft before publishing.')
    })
})

function hotScript(version: string): string {
    return `
window.__sourceEditorHotVersion = '${version}'
import {Object3DComponent} from 'threepipe'
export class SourceEditorHotComponent extends Object3DComponent {
    static ComponentType = 'SourceEditorHotComponent'
}
`
}
