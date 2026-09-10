import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
import replace from '@rollup/plugin-replace'
import {resolve} from 'node:path'

export default defineConfig({
    build: {
        sourcemap: true,
        rollupOptions: {
            preserveEntrySignatures: 'strict',
            input: {
                app: resolve(__dirname, 'index.html'),
                'editor-runtime': resolve(__dirname, 'src/editorRuntime.ts'),
            },
            output: {
                entryFileNames: (chunk) => chunk.name === 'editor-runtime'
                    ? 'editor-runtime.js'
                    : 'assets/[name]-[hash].js',
            },
        },
    },
    css: {
        postcss: {
            plugins: [{
                postcssPlugin: 'modify-css-content',
                Once(root) {
                    // Reference selector repair for duplicated Blueprint theme roots.
                    root.walkRules((rule) => {
                        rule.selector = rule.selector.replace(/:root.bpx-(.*) :root/g, ':root.bpx-$1')
                    })
                },
            }],
        },
    },
    plugins: [
        react(),
        replace({
            'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
            preventAssignment: true,
        }),
    ],
})
