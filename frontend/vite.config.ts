import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Resolve the shared workspace package to its TS source so Vite transpiles it.
      '@ticktaskdone/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    // Dev proxy: same-origin /api calls forwarded to the Express backend.
    proxy: {
      '/api': {
        // 127.0.0.1, not localhost: on Windows `localhost` resolves to ::1 (IPv6)
        // first and can stall on a fallback to IPv4 — an intermittent multi-second lag.
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  optimizeDeps: {
    // `zod` is only imported deep inside the aliased `shared` source, so Vite's
    // startup scan misses it and would re-optimize mid-session (a multi-second dev
    // freeze that stalls even proxied API calls). Pre-bundle it up front.
    include: ['zod'],
  },
})
