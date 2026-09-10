/// <reference types="node" />

import {defineConfig, devices} from '@playwright/test'

export default defineConfig({
    testDir: './test/runtime',
    testMatch: 'runtime.spec.ts',
    fullyParallel: false,
    reporter: 'line',
    timeout: 30_000,
    use: {
        baseURL: 'http://127.0.0.1:4177',
        trace: 'retain-on-failure',
    },
    projects: [{
        name: 'chromium',
        use: {
            ...devices['Desktop Chrome'],
            launchOptions: {
                args: [
                    '--use-angle=swiftshader',
                    '--enable-unsafe-swiftshader',
                    '--ignore-gpu-blocklist',
                ],
            },
        },
    }],
    webServer: {
        command: 'node test/runtime/server.mjs 4177',
        url: 'http://127.0.0.1:4177',
        reuseExistingServer: false,
        timeout: 30_000,
        stdout: 'pipe',
        stderr: 'pipe',
    },
})
