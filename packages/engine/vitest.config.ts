import {defineConfig} from 'vitest/config'

export default defineConfig({
    test: {
        environment: 'node',
        include: ['test/unit/**/*.test.ts'],
        setupFiles: ['./test/unit/setup.ts'],
    },
})
