import { defineConfig } from 'vitest/config'

/**
 * These suites reconstruct committed PNG review matrices or run the complete
 * production catalog validator. They remain part of the default `npm test`
 * collection and the 20/60/39 production acceptance in `catalog:validate`.
 * Re-running them under V8 instrumentation only duplicates that acceptance and
 * creates enough CPU contention to invalidate their deliberately tight clocks.
 */
export const COVERAGE_ONLY_INTEGRATION_EXCLUDES = [
  'packages/asset-catalog/src/production-validation.test.ts',
  'scripts/body-head-contact-metrics.test.ts',
  'scripts/prepare-tail-extra-assets.test.ts',
  'scripts/render-tail-extra-structural-matrices.test.ts',
  'scripts/retain-v02-nonstructural-assets.test.ts',
  'scripts/task8-review-integrity.test.ts',
  'scripts/validate-interface-slice.test.ts',
]

// Task 9 locks these global floors to the measured stable baseline. Keep the
// named projection so verification can reject removing or silently lowering a
// threshold without coupling the default (non-coverage) test configuration to
// V8 instrumentation.
export const GLOBAL_COVERAGE_THRESHOLDS = {
  statements: 44,
  branches: 44,
  functions: 49,
  lines: 47,
} as const

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    maxWorkers: 4,
    coverage: {
      provider: 'v8',
      all: true,
      include: [
        'packages/*/src/**/*.{ts,tsx}',
        'apps/creator-web/src/**/*.{ts,tsx}',
        'scripts/**/*.ts',
      ],
      exclude: [
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.spec.ts',
        '**/test-fixtures.ts',
      ],
      thresholds: GLOBAL_COVERAGE_THRESHOLDS,
    },
    projects: [
      {
        test: {
          name: 'packages-node-coverage',
          environment: 'node',
          include: ['packages/**/*.test.ts', 'scripts/**/*.test.ts'],
          exclude: COVERAGE_ONLY_INTEGRATION_EXCLUDES,
          testTimeout: 60_000,
        },
      },
      {
        test: {
          name: 'creator-state-node-coverage',
          environment: 'node',
          include: ['apps/creator-web/src/state/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'creator-jsdom-coverage',
          environment: 'jsdom',
          include: ['apps/**/*.test.tsx', 'apps/creator-web/src/io/**/*.test.ts'],
          setupFiles: ['apps/creator-web/src/test/setup.ts'],
        },
      },
    ],
  },
})
