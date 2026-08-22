import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        synthetic: resolve(import.meta.dirname, 'render-test.html'),
        production: resolve(import.meta.dirname, 'production-render-test.html'),
      },
    },
  },
})
