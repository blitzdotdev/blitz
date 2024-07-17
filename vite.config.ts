import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// https://vitejs.dev/config/
export default defineConfig({
  optimizeDeps: {
    exclude: ['uiconfig-blueprint', 'ts-browser-helpers'],
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
  server: { https: true }, // Not needed for Vite 5+
  plugins: [react(), basicSsl()],
})
