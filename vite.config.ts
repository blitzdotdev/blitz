import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import replace from '@rollup/plugin-replace';
import { importMapPlugin } from 'importmap-vite-plugin'

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
    // https: true,
  }, // Not needed for Vite 5+
  plugins: [
      react(),
      replace({
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
        preventAssignment: true
      }),

      // basicSsl(),

    importMapPlugin({
      imports: {
        // Map to local modules (these will be bundled)
        'threepipe': './src/import-map/threepipe',
        'uiconfig.js': './src/import-map/threepipe',
        'ts-browser-helpers': './src/import-map/threepipe',
        '@threepipe/plugin-gltf-transform': 'https://esm.sh/@threepipe/plugin-gltf-transform?external=threepipe',
        '@threepipe/plugin-geometry-generator': 'https://esm.sh/@threepipe/plugin-geometry-generator?external=threepipe',

        // 'threepipe': 'https://esm.sh/threepipe',
        // 'react-dom': './src/import-map/react-dom',
        // 'react/jsx-runtime': './src/import-map/react/jsx-runtime',

        // Map to external URLs (these remain external)
        // 'framer-motion': 'https://esm.sh/framer-motion?external=react',
        // '@motionone/dom': 'https://esm.sh/@motionone/dom?external=react',
        // 'framer': 'https://esm.sh/unframer@latest/esm/framer.js?external=react',
      }
    })

  ],
})
