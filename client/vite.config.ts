import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'

// The dev server proxies /api to the Node server so one origin serves both.
// The port matches server/src/config's DASHBOARD_PORT default.
export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:4180', changeOrigin: false },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
})
