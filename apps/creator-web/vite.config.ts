import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import { qmonsterContentResources } from './vite-content-resources.js'

export default defineConfig({
  plugins: [
    react(),
    qmonsterContentResources(resolve(import.meta.dirname, '../../packages/asset-catalog/resources/by-sha256')),
  ],
  resolve: { tsconfigPaths: true },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        catalogReport: resolve(import.meta.dirname, 'catalog-report.html'),
        synthetic: resolve(import.meta.dirname, 'render-test.html'),
        production: resolve(import.meta.dirname, 'production-render-test.html'),
        v09Preview: resolve(import.meta.dirname, 'v09-preview-test.html'),
        v09Acceptance: resolve(import.meta.dirname, 'v09-user-review.html'),
        legacyAcceptance: resolve(import.meta.dirname, 'acceptance-render.html'),
      },
    },
  },
})
