import {resolve} from 'node:path'
import {defineConfig} from 'vite'

export default defineConfig({
    define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
    },
    build: {
        emptyOutDir: false,
        lib: {
            entry: resolve(__dirname, 'src/runtime/index.ts'),
            formats: ['es'],
            fileName: () => 'runtime.js',
        },
        rollupOptions: {
            output: {
                inlineDynamicImports: true,
            },
        },
    },
})
