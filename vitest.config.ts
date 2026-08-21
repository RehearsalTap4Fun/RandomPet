import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    projects: [
      {
        test: {
          name: 'packages-node',
          environment: 'node',
          include: ['packages/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'creator-jsdom',
          environment: 'jsdom',
          include: ['apps/**/*.test.tsx'],
          setupFiles: ['apps/creator-web/src/test/setup.ts'],
        },
      },
    ],
  },
})
