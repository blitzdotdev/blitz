import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import replace from '@rollup/plugin-replace';

// https://vitejs.dev/config/
export default defineConfig({
  optimizeDeps: {
    exclude: ['ts-browser-helpers', 'uiconfig-blueprint', /*, 'threepipe'*/],
  },
  build: {
    commonjsOptions: {
      exclude: process.env.NODE_ENV === 'development' ? // for the error  "default" is not exported by ... "classnames" in blueprint/icons
          [/uiconfig-blueprint/, /ts-browser-helpers//*, /threepipe/*/] : [],
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
    // @ts-ignore
    https: true,
  }, // Not needed for Vite 5+
  plugins: [
      react(),
      replace({
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
        preventAssignment: true
      }),

      basicSsl()
  ],
})
