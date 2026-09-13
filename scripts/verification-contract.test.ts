import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { matchesGlob } from 'node:path'
import { expect, it } from 'vitest'
import { task9HistoricalDependencySha256 } from '../packages/asset-catalog/src/task9-versioned-dependency-projection.js'

const HASH_BOUND_APPROVAL_FILES = [
  'asset-source/v0.3.0/prompts/task8-limb-prompts.json',
  'packages/asset-catalog/audit/v0.3.0/task8-blob-joint-shoulder-selection-proof.json',
  'asset-source/v0.4.0/interface-face-zone-overrides.json',
  'asset-source/v0.4.0/runtime-staging/parts/provenance.json',
  'packages/asset-catalog/source-index-v0.4.0.json',
  'packages/asset-catalog/review/v0.4.0/review-record.json',
  'packages/asset-catalog/audit/v0.4.0/evidence-manifest.json',
  'packages/asset-catalog/audit/v0.4.0/task7-composition-statistics.json',
  'packages/asset-catalog/audit/v0.4.0/task7-machine-acceptance.json',
  'asset-source/v0.5.0/prompts/long-tail-prompts.json',
  'packages/asset-catalog/audit/v0.5.0/evidence-manifest.json',
  'packages/asset-catalog/review/v0.5.0/long-tail-review-record.json',
  'asset-source/v0.6.0/prompts/feline-prompts.json',
  'packages/asset-catalog/catalog/v0.8.0/catalog.json',
  'packages/asset-catalog/source-index-v0.8.0.json',
] as const

const SHA256 = /^[0-9a-f]{64}$/i

function readHeadBlobs(paths: readonly string[]): Map<string, Buffer> {
  if (paths.length === 0) return new Map()
  const output = execFileSync('git', ['cat-file', '--batch'], {
    input: `${paths.map(path => `HEAD:${path}`).join('\n')}\n`,
    maxBuffer: 256 * 1024 * 1024,
  })
  const blobs = new Map<string, Buffer>()
  let offset = 0
  for (const path of paths) {
    const headerEnd = output.indexOf(0x0a, offset)
    if (headerEnd < 0) throw new Error(`Missing git cat-file header for ${path}`)
    const [, type, sizeText] = output.subarray(offset, headerEnd).toString('utf8').split(' ')
    const size = Number(sizeText)
    if (type !== 'blob' || !Number.isSafeInteger(size)) throw new Error(`Invalid git cat-file response for ${path}`)
    const start = headerEnd + 1
    const end = start + size
    blobs.set(path, output.subarray(start, end))
    offset = end + 1
  }
  return blobs
}

function discoverRawHashBoundJsonPaths(): string[] {
  const trackedJsonPaths = execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD', '--', '*.json'], { encoding: 'utf8' })
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
  const tracked = new Set(trackedJsonPaths)
  const referencedHashes = new Map<string, Set<string>>()

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (value === null || typeof value !== 'object') return
    const entries = Object.entries(value)
    for (const [pathKey, pathValue] of entries) {
      if (typeof pathValue !== 'string' || !pathValue.endsWith('.json')) continue
      const pathStem = pathKey.replace(/Path$/, '').toLowerCase()
      for (const [hashKey, hashValue] of entries) {
        if (typeof hashValue !== 'string' || !SHA256.test(hashValue)) continue
        const exactPair = pathKey === 'path' && hashKey === 'sha256'
        const namedPair = pathStem === hashKey.replace(/Sha256$/, '').toLowerCase()
        if (!exactPair && !namedPair) continue
        const portablePath = pathValue.replaceAll('\\', '/')
        const hashes = referencedHashes.get(portablePath) ?? new Set<string>()
        hashes.add(hashValue.toLowerCase())
        referencedHashes.set(portablePath, hashes)
      }
    }
    Object.values(value).forEach(visit)
  }

  for (const path of trackedJsonPaths) {
    try {
      visit(JSON.parse(readFileSync(path, 'utf8')))
    } catch {
      // Non-JSON or partial historical fixtures cannot declare a live hash binding.
    }
  }

  const candidates = [...referencedHashes].filter(([path]) => tracked.has(path))
  const committedBlobs = readHeadBlobs(candidates.map(([path]) => path))
  return candidates
    .filter(([path, hashes]) => hashes.has(createHash('sha256').update(committedBlobs.get(path)!).digest('hex')))
    .map(([path]) => path)
    .sort()
}

function task9EvidenceTextPaths(): string[] {
  const manifest = JSON.parse(readFileSync('packages/asset-catalog/audit/v0.3.0/evidence-manifest.json', 'utf8')) as {
    task9Evidence: { dependencies: Array<{ path: string }> }
  }
  return manifest.task9Evidence.dependencies
    .map(dependency => dependency.path)
    .filter(path => /\.(?:ts|txt)$/u.test(path))
    .sort()
}

const COVERAGE_ONLY_EXCLUDES = [
  'packages/asset-catalog/src/production-validation.test.ts',
  'scripts/body-head-contact-metrics.test.ts',
  'scripts/prepare-tail-extra-assets.test.ts',
  'scripts/render-tail-extra-structural-matrices.test.ts',
  'scripts/retain-v02-nonstructural-assets.test.ts',
  'scripts/task8-review-integrity.test.ts',
  'scripts/validate-interface-slice.test.ts',
]

const ASSET_PRODUCTION_HEAVY_TESTS = [
  'packages/asset-catalog/src/evidence-root.test.ts',
  'packages/asset-catalog/src/production-validation.test.ts',
  'packages/asset-catalog/src/v04-interface-face-zone-overlay.test.ts',
  'packages/asset-catalog/src/v09-production-validation.test.ts',
  'scripts/assemble-v04-catalog.test.ts',
  'scripts/prepare-v04-single-face-assets.test.ts',
  'scripts/assemble-v05-catalog.test.ts',
  'scripts/prepare-v05-long-tail-assets.test.ts',
  'scripts/prepare-v06-feline-assets.test.ts',
  'scripts/prepare-v09-feline-masters.test.ts',
  'scripts/prepare-v09-feline-traits.test.ts',
]

it('routes root verification through all three production catalog validators', async () => {
  const root = JSON.parse(await readFile('package.json', 'utf8'))
  const command = root.scripts['catalog:validate'] as string
  expect(command).toContain('validate:v0.1.0')
  expect(command).toContain('validate:v0.2.0')
  expect(command).toContain('validate:v0.3.0')
  expect(command).toContain('validate:v0.4.0')
  expect(command).toContain('validate:v0.5.0')
  expect(root.scripts.verify).toContain('npm run catalog:validate')
})

it('keeps final verification and active audit read-only and separate from one-shot generation', async () => {
  const root = JSON.parse(await readFile('package.json', 'utf8'))
  expect(root.scripts['gate:v0.9']).toContain('--gate')
  expect(root.scripts['verify-final:v0.9']).toContain('--final-verify')
  expect(root.scripts['verify-active:v0.9']).toContain('--verify-active')
  expect(root.scripts['batch:v0.9:user-review']).not.toContain('--final-verify')
  expect(root.scripts['batch:v0.9:user-review']).not.toContain('--verify-active')
})

it('keeps the sealed v0.8 release gate independent of its untracked authoring source', async () => {
  const assetCatalog = JSON.parse(await readFile('packages/asset-catalog/package.json', 'utf8'))
  const command = assetCatalog.scripts['validate:v0.8.0'] as string
  expect(execFileSync('git', ['ls-files', '--', 'asset-source/v0.8.0'], { encoding: 'utf8' }).trim()).toBe('')
  expect(command).not.toContain('--source-root')
  expect(command).toContain('--production')
  expect(command).toContain('--source-index packages/asset-catalog/source-index-v0.8.0.json')
  expect(command).toContain('--evidence-manifest packages/asset-catalog/audit/v0.8.0/evidence-manifest.json')

  const validator = await readFile('packages/asset-catalog/src/v08-production-validation.ts', 'utf8')
  const authoringAuditGuard = validator.indexOf('if (sourceIndex !== null && sourceRoot !== undefined)')
  expect(authoringAuditGuard).toBeGreaterThan(0)
  for (const releaseClosureCheck of [
    'validateCatalogFiles(catalog, assetRoot)',
    'validateAssetFile(assetRoot',
    'const actualFiles = await listFiles(assetRoot)',
    'sourceIndexBytes = await readFile(sourceIndexPath)',
    'const evidence = await readJson(evidencePath)',
  ]) {
    expect(validator.indexOf(releaseClosureCheck), releaseClosureCheck).toBeGreaterThan(0)
    expect(validator.indexOf(releaseClosureCheck), releaseClosureCheck).toBeLessThan(authoringAuditGuard)
  }
})

it('keeps every raw-hash-bound approval JSON byte-identical to its committed blob', async () => {
  const paths = [...new Set([...HASH_BOUND_APPROVAL_FILES, ...discoverRawHashBoundJsonPaths()])]
  const attributes = execFileSync('git', ['check-attr', '--stdin', 'text'], {
    encoding: 'utf8',
    input: `${paths.join('\n')}\n`,
  }).trim().split(/\r?\n/)
  const committedBlobs = readHeadBlobs(paths)
  expect(attributes).toHaveLength(paths.length)
  for (const [index, path] of paths.entries()) {
    expect(attributes[index]).toBe(`${path}: text: unset`)
    const worktreeSha256 = createHash('sha256').update(readFileSync(path)).digest('hex')
    const committedSha256 = createHash('sha256')
      .update(committedBlobs.get(path)!)
      .digest('hex')
    expect(worktreeSha256, path).toBe(committedSha256)
  }
})

it('keeps every Task 9 text dependency stable or explicitly projected on every host', () => {
  const paths = task9EvidenceTextPaths()
  const attributes = execFileSync('git', ['check-attr', '--stdin', 'text'], {
    encoding: 'utf8',
    input: `${paths.join('\n')}\n`,
  }).trim().split(/\r?\n/)
  const manifest = JSON.parse(readFileSync('packages/asset-catalog/audit/v0.3.0/evidence-manifest.json', 'utf8')) as {
    task9Evidence: { dependencies: Array<{ path: string, sha256: string }> }
  }
  const expected = new Map(manifest.task9Evidence.dependencies.map(dependency => [dependency.path, dependency.sha256]))
  expect(attributes).toHaveLength(paths.length)
  for (const [index, path] of paths.entries()) {
    expect(attributes[index]).toBe(`${path}: text: unset`)
    const worktreeSha256 = createHash('sha256').update(readFileSync(path)).digest('hex')
    expect(task9HistoricalDependencySha256(path, worktreeSha256), path).toBe(expected.get(path))
  }
})

it('keeps the hash-bound v0.9 release evidence byte-stable on every host', () => {
  const evidenceRoot = 'artifacts/acceptance/v0.9.0-feline'
  const evidence = JSON.parse(readFileSync(`${evidenceRoot}/release-evidence.json`, 'utf8')) as {
    artifacts: Array<{ path: string }>
    finalVerification: { results: Array<{ log: string }> }
    preactivation: { commands: Array<{ log: string }> }
  }
  const trackedEvidenceText = execFileSync('git', ['ls-files', '--', evidenceRoot], { encoding: 'utf8' })
    .trim()
    .split(/\r?\n/)
    .filter(path => /\.(?:json|log)$/u.test(path))
  const paths = [...new Set([
    ...trackedEvidenceText,
    ...evidence.artifacts.map(artifact => artifact.path).filter(path => path.endsWith('.json')),
    ...evidence.finalVerification.results.map(result => result.log),
    ...evidence.preactivation.commands.map(result => result.log),
  ])].sort()
  const attributes = execFileSync('git', ['check-attr', '--stdin', 'text'], {
    encoding: 'utf8',
    input: `${paths.join('\n')}\n`,
  }).trim().split(/\r?\n/)
  expect(attributes).toHaveLength(paths.length)
  for (const [index, path] of paths.entries()) expect(attributes[index]).toBe(`${path}: text: unset`)
})

it('keeps the Task 9 technical gate separate from the exact v0.3 release approval', async () => {
  const root = JSON.parse(await readFile('package.json', 'utf8'))
  const technicalSteps = [
    'npm run typecheck',
    'npm test',
    'npm run test:coverage',
    'npm run catalog:validate',
    'npm run build',
    'npm run test:production-smoke:prebuilt',
    'npm run test:render-golden',
    'npm run test:e2e',
  ]
  expect(root.scripts['verify:task9']).toBe(technicalSteps.filter(step => step !== 'npm run test:production-smoke:prebuilt').join(' && '))
  expect(root.scripts.verify).toBe(`${technicalSteps.join(' && ')} && npm run acceptance:generate && npm run acceptance:verify`)
  expect(root.scripts['acceptance:verify']).toBe(
    'tsx scripts/validate-composite-review.ts --version 0.3.0 --approval-sha256 2cca1f60478b79b730e598ec83c4a7ae1297a8a75a94e1738c9e7aaaed043881 --generated-evidence-dir artifacts/acceptance/v0.3',
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
  expect(defaultConfig).toContain('const ASSET_PRODUCTION_HEAVY_TESTS = [')
  expect(defaultConfig).toContain('include: ASSET_PRODUCTION_HEAVY_TESTS')
  for (const path of ASSET_PRODUCTION_HEAVY_TESTS) expect(defaultConfig).toContain(`'${path}'`)
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
  expect(projects.get('packages-node')?.exclude).toEqual([
    ...ASSET_PRODUCTION_HEAVY_TESTS,
    ...COVERAGE_ONLY_EXCLUDES.slice(1),
  ])
  expect(projects.get('asset-production-heavy')?.include).toEqual(ASSET_PRODUCTION_HEAVY_TESTS)
  expect(projects.get('interface-review-heavy')?.include).toEqual(COVERAGE_ONLY_EXCLUDES.slice(1))

  const discovered = execFileSync('rg', ['--files', 'packages', 'scripts', 'apps'], { encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(path => /\.test\.tsx?$/.test(path))
    .map(path => path.replaceAll('\\', '/'))
  discovered.push('tests/render/production-composition.spec.ts', 'tests/render/v04-face-zone-regression.spec.ts')

  // Inventory evolves; verify real project routing rather than a historical file count.
  const configured = vitestConfig.test.projects.flatMap((project: any) => discovered.filter(path =>
    project.test.include.some((pattern: string) => matchesGlob(path, pattern))
    && !(project.test.exclude ?? []).some((pattern: string) => matchesGlob(path, pattern)),
  )) as string[]
  const collectionCounts = new Map(configured.map(path => [path, configured.filter(candidate => candidate === path).length]))
  expect([...collectionCounts].filter(([, count]) => count !== 1)).toEqual([])
  expect([...collectionCounts.keys()].sort()).toEqual([...discovered].sort())
})
