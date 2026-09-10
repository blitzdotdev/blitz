import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
import replace from '@rollup/plugin-replace'
import {importMapPlugin} from 'importmap-vite-plugin'

export default defineConfig({
    build: {sourcemap: true},
    plugins: [
        react(),
        replace({
            'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
            preventAssignment: true,
        }),
        importMapPlugin({
            imports: {
                '@blitzdev/engine': '/_blitz/runtime.js',
                threepipe: '/_blitz/runtime.js',
                three: '/_blitz/runtime.js',
                'uiconfig.js': '/_blitz/runtime.js',
                'ts-browser-helpers': '/_blitz/runtime.js',
            },
        }),
    ],
})
