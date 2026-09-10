import {resolve} from 'node:path'
import {defineConfig} from 'vite'
import dts from 'vite-plugin-dts'

const external = ['threepipe', 'uiconfig.js', 'ts-browser-helpers', 'cannon-es', 'jsonc-parser']

export default defineConfig({
    build: {
        lib: {
            entry: {
                index: resolve(__dirname, 'src/index.ts'),
                fileTypes: resolve(__dirname, 'src/fileTypes.ts'),
                paths: resolve(__dirname, 'src/paths.ts'),
                version: resolve(__dirname, 'src/runtime/version.ts'),
            },
            formats: ['es'],
            fileName: (_format, entryName) => `${entryName}.js`,
        },
        sourcemap: true,
        rollupOptions: {external},
    },
    plugins: [dts({
        tsconfigPath: resolve(__dirname, 'tsconfig.json'),
        entryRoot: resolve(__dirname, 'src'),
        outDir: resolve(__dirname, 'dist'),
    })],
})
