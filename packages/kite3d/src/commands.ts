import {resolve} from 'node:path'
import openBrowser from 'open'
import {createDevServer, type DevServer} from './server.ts'
import {screenshotProject, type ScreenshotOptions, type ScreenshotResult} from './screenshot.ts'

export async function runDev(options: {
    projectRoot?: string
    port?: number
    strictPort?: boolean
    noOpen?: boolean
} = {}): Promise<DevServer> {
    const server = await createDevServer({
        projectRoot: resolve(options.projectRoot || process.cwd()),
        port: options.port,
        strictPort: options.strictPort,
    })
    try {
        if (!options.noOpen) await openBrowser(server.url)
        return server
    } catch (error) {
        await server.close()
        throw error
    }
}

export function screenshotFromDisk(
    projectRoot = process.cwd(),
    options: ScreenshotOptions = {},
): Promise<ScreenshotResult> {
    return screenshotProject(projectRoot, options)
}
