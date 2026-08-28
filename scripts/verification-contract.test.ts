import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'

const COVERAGE_ONLY_EXCLUDES = [
  'packages/asset-catalog/src/production-validation.test.ts',
  'scripts/body-head-contact-metrics.test.ts',
  'scripts/prepare-tail-extra-assets.test.ts',
  'scripts/render-tail-extra-structural-matrices.test.ts',
  'scripts/retain-v02-nonstructural-assets.test.ts',
  'scripts/task8-review-integrity.test.ts',
  'scripts/validate-interface-slice.test.ts',
]

it('routes root verification through all three production catalog validators', async () => {
  const root = JSON.parse(await readFile('package.json', 'utf8'))
  const command = root.scripts['catalog:validate'] as string
  expect(command).toContain('validate:v0.1.0')
  expect(command).toContain('validate:v0.2.0')
  expect(command).toContain('validate:v0.3.0')
  expect(root.scripts.verify).toContain('npm run catalog:validate')
})

it('keeps the Task 9 technical gate separate from the exact v0.3 release approval', async () => {
  const root = JSON.parse(await readFile('package.json', 'utf8'))
  const technicalSteps = [
    'npm run typecheck',
    'npm test',
    'npm run test:coverage',
    'npm run catalog:validate',
    'npm run build',
    'npm run test:render-golden',
    'npm run test:e2e',
  ]
  expect(root.scripts['verify:task9']).toBe(technicalSteps.join(' && '))
  expect(root.scripts.verify).toBe(`${technicalSteps.join(' && ')} && npm run acceptance:generate && npm run acceptance:verify`)
  expect(root.scripts['acceptance:verify']).toBe(
    'tsx scripts/validate-composite-review.ts --version 0.3.0 --approval-sha256 4f2c8c359e53297077914a3c1fc72d943164d57632fbd9d41809a7445b3f1025 --generated-evidence-dir artifacts/acceptance/v0.3',
  )
})

it('keeps live reconstruction suites in full verification while coverage targets production code with fast tests', async () => {
  const root = JSON.parse(await readFile('package.json', 'utf8'))
  const assetCatalog = JSON.parse(await readFile('packages/asset-catalog/package.json', 'utf8'))
  const vitestConfig = (await import('../vitest.config.js')).default as any
  const coverageVitestConfig = await import('../vitest.coverage.config.js')
  const defaultConfig = await readFile('vitest.config.ts', 'utf8')
  const coverageConfig = await readFile('vitest.coverage.config.ts', 'utf8')
  const productionValidation = await readFile('scripts/validate-interface-slice.ts', 'utf8')

  expect(root.scripts.test).not.toContain('vitest.coverage.config.ts')
  expect(root.scripts.test).toContain('--project=packages-node')
  expect(root.scripts.test).toContain('--project=interface-review-heavy')
  expect(root.scripts.test).toContain('--project=production-browser-v03')
  expect(root.scripts.test).toContain('--maxWorkers=1')
  expect(root.scripts['test:e2e']).toContain('--workers=4')
  expect(root.scripts['test:coverage']).toContain('--config vitest.coverage.config.ts')
  expect(root.scripts.verify.indexOf('npm test')).toBeLessThan(root.scripts.verify.indexOf('npm run test:coverage'))
  expect(root.scripts.verify.indexOf('npm run test:coverage')).toBeLessThan(root.scripts.verify.indexOf('npm run catalog:validate'))
  expect(assetCatalog.scripts['validate:v0.3.0']).toContain('validate-interface-slice.ts --version 0.3.0 --production')
  expect(assetCatalog.scripts.validate).toBe('npm run validate:v0.3.0')
  expect(productionValidation).toContain('bodyHeadApprovalEntriesChecked')
  expect(productionValidation).toContain('limbApprovalEntriesChecked')
  expect(productionValidation).toContain('tailExtraEntriesChecked')

  expect(defaultConfig).toContain("include: ['packages/**/*.test.ts', 'scripts/**/*.test.ts']")
  expect(defaultConfig).toContain("include: ['packages/asset-catalog/src/production-validation.test.ts']")
  expect(defaultConfig).toContain("name: 'interface-review-heavy'")
  for (const path of COVERAGE_ONLY_EXCLUDES) expect(coverageConfig).toContain(`'${path}'`)
  for (const path of COVERAGE_ONLY_EXCLUDES.slice(1)) expect(defaultConfig).toContain(`'${path}'`)
  expect(coverageConfig).toContain("'packages/*/src/**/*.{ts,tsx}'")
  expect(coverageConfig).toContain("'apps/creator-web/src/**/*.{ts,tsx}'")
  expect(coverageConfig).toContain("'scripts/**/*.ts'")
  expect(defaultConfig).not.toContain('thresholds:')
  expect(coverageConfig).toContain('thresholds: GLOBAL_COVERAGE_THRESHOLDS')
  expect(coverageVitestConfig.GLOBAL_COVERAGE_THRESHOLDS).toEqual({
    statements: 44,
    branches: 44,
    functions: 49,
    lines: 47,
  })

  const projects = new Map(vitestConfig.test.projects.map((project: any) => [project.test.name, project.test]))
  expect(projects.get('packages-node')?.exclude).toEqual(COVERAGE_ONLY_EXCLUDES)
  expect(projects.get('asset-production-heavy')?.include).toEqual([COVERAGE_ONLY_EXCLUDES[0]])
  expect(projects.get('interface-review-heavy')?.include).toEqual(COVERAGE_ONLY_EXCLUDES.slice(1))

  const discovered = execFileSync('rg', ['--files', 'packages', 'scripts', 'apps'], { encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(path => /\.test\.tsx?$/.test(path))
    .map(path => path.replaceAll('\\', '/'))
  discovered.push('tests/render/production-composition.spec.ts')
  expect(discovered).toHaveLength(88)

  const configured = [
    ...discovered.filter(path => /^(packages|scripts)\//.test(path) && !COVERAGE_ONLY_EXCLUDES.includes(path)),
    ...COVERAGE_ONLY_EXCLUDES,
    ...discovered.filter(path => path.startsWith('apps/creator-web/src/state/') && path.endsWith('.test.ts')),
    ...discovered.filter(path => path.startsWith('apps/') && path.endsWith('.test.tsx')),
    ...discovered.filter(path => path.startsWith('apps/creator-web/src/io/') && path.endsWith('.test.ts')),
    'tests/render/production-composition.spec.ts',
  ]
  const collectionCounts = new Map(configured.map(path => [path, configured.filter(candidate => candidate === path).length]))
  expect([...collectionCounts].filter(([, count]) => count !== 1)).toEqual([])
  expect([...collectionCounts.keys()].sort()).toEqual([...discovered].sort())
})
