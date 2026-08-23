import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    projects: [
      {
        test: {
          name: 'packages-node',
          environment: 'node',
          include: ['packages/**/*.test.ts', 'scripts/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'creator-state-node',
          environment: 'node',
          include: ['apps/creator-web/src/state/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'creator-jsdom',
          environment: 'jsdom',
          include: ['apps/**/*.test.tsx', 'apps/creator-web/src/io/**/*.test.ts'],
          setupFiles: ['apps/creator-web/src/test/setup.ts'],
        },
      },
    ],
  },
})
