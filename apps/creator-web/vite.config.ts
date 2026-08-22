import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        synthetic: resolve(import.meta.dirname, 'render-test.html'),
        production: resolve(import.meta.dirname, 'production-render-test.html'),
      },
    },
  },
})
