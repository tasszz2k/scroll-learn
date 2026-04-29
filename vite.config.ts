import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import { resolve } from 'path';
import manifest from './manifest.json';

export default defineConfig({
  plugins: [
    react(),
    crx({ manifest }),
  ],
  base: './',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        dashboard: resolve(__dirname, 'index.html'),
        sidebar: resolve(__dirname, 'src/sidebar/sidebar.html'),
        // The offscreen page is invoked at runtime via
        // chrome.offscreen.createDocument and isn't referenced from the
        // manifest, so we list it here explicitly to make Rollup emit it.
        kokoroOffscreen: resolve(__dirname, 'src/offscreen/kokoroOffscreen.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: {
      port: 5173,
    },
  },
});
