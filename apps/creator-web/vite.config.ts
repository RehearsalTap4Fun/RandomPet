import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import { createReadStream, existsSync } from 'node:fs'

const CONTENT_HASH = /^[a-f0-9]{64}$/u
const contentResourceRoot = resolve(import.meta.dirname, '../../packages/asset-catalog/resources/by-sha256')

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'qmonster-content-resources',
      configureServer(server) {
        server.middlewares.use('/@qmonster-v09-resource/', (request, response, next) => {
          const hash = request.url?.slice(1).split('?', 1)[0]
          if (hash === undefined || !CONTENT_HASH.test(hash)) return next()
          const resourcePath = resolve(contentResourceRoot, hash)
          if (!existsSync(resourcePath)) return next()
          response.setHeader('Content-Type', 'application/octet-stream')
          response.setHeader('Cache-Control', 'no-store')
          createReadStream(resourcePath).pipe(response)
        })
      },
    },
  ],
  resolve: { tsconfigPaths: true },
  assetsInclude: ['**/packages/asset-catalog/resources/by-sha256/*'],
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        catalogReport: resolve(import.meta.dirname, 'catalog-report.html'),
        synthetic: resolve(import.meta.dirname, 'render-test.html'),
        production: resolve(import.meta.dirname, 'production-render-test.html'),
        v09Preview: resolve(import.meta.dirname, 'v09-preview-test.html'),
      },
    },
  },
})
