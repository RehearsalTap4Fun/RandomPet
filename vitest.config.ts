import { defineConfig } from 'vitest/config'

const INTERFACE_REVIEW_HEAVY_TESTS = [
  'scripts/body-head-contact-metrics.test.ts',
  'scripts/prepare-tail-extra-assets.test.ts',
  'scripts/render-tail-extra-structural-matrices.test.ts',
  'scripts/retain-v02-nonstructural-assets.test.ts',
  'scripts/task8-review-integrity.test.ts',
  'scripts/validate-interface-slice.test.ts',
]

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    projects: [
      {
        test: {
          name: 'packages-node',
          environment: 'node',
          include: ['packages/**/*.test.ts', 'scripts/**/*.test.ts'],
          exclude: [
            'packages/asset-catalog/src/production-validation.test.ts',
            ...INTERFACE_REVIEW_HEAVY_TESTS,
          ],
        },
      },
      {
        test: {
          name: 'asset-production-heavy',
          environment: 'node',
          include: ['packages/asset-catalog/src/production-validation.test.ts'],
          testTimeout: 20_000,
        },
      },
      {
        test: {
          name: 'interface-review-heavy',
          environment: 'node',
          include: INTERFACE_REVIEW_HEAVY_TESTS,
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
      {
        test: {
          name: 'production-browser-v03',
          environment: 'node',
          include: ['tests/render/production-composition.spec.ts'],
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
})
