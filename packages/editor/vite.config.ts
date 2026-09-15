import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import replace from '@rollup/plugin-replace';
import { resolve } from 'node:path'

// https://vitejs.dev/config/
export default defineConfig({
  optimizeDeps: {
    exclude: ['ts-browser-helpers', 'uiconfig-blueprint',  'threepipe', "three"],
  },
  build: {
    commonjsOptions: {
      exclude: process.env.NODE_ENV === 'development' ? // for the error  "default" is not exported by ... "classnames" in blueprint/icons
          [/uiconfig-blueprint/, /ts-browser-helpers/, /threepipe/, /three/] : [],
    },
    rollupOptions: {
      // The runtime entry keeps every export it declares, because project scripts import them by name.
      preserveEntrySignatures: 'strict',
      input: {
        app: resolve(__dirname, 'index.html'),
        'editor-runtime': resolve(__dirname, 'src/editorRuntime.ts'),
      },
      output: {
        // The dev server's import map points at /editor-runtime.js, so that name cannot carry a hash.
        entryFileNames: (chunk) => chunk.name === 'editor-runtime'
            ? 'editor-runtime.js'
            : 'assets/[name]-[hash].js',
      },
    },
  },
  css: {
    postcss: {
      plugins: [
        {
          postcssPlugin: 'modify-css-content',
          Once(root) {
            // Modify to fix :root.bpx-flat :root twice when imported in renderer.scss
            root.walkRules(rule => {
              rule.selector = rule.selector.replace(/:root.bpx-(.*) :root/g, ':root.bpx-$1');
            });
          },
        },
        // autoprefixer,
      ],
    }
  },
  server: {
    host: '0.0.0.0', // Listen on all network interfaces
  },
  plugins: [
      react(),
      replace({
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
        preventAssignment: true
      }),

      // basicSsl(),
  ],
})
