import { defineConfig } from 'vitest/config'
export default defineConfig({ resolve: { tsconfigPaths: true }, test: { include: ['packages/**/*.test.ts'], testTimeout: 30000, hookTimeout: 30000 } })
