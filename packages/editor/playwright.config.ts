import {defineConfig, devices} from '@playwright/test'

export default defineConfig({
    testDir: './test/editor',
    fullyParallel: false,
    reporter: 'line',
    timeout: 45_000,
    projects: [{
        name: 'chromium',
        use: {
            ...devices['Desktop Chrome'],
            launchOptions: {args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']},
        },
    }],
})
