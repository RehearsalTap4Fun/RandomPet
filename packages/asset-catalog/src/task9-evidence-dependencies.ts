import { lstat, readdir, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import type { Task9EvidenceDependency } from './evidence-root.js'
import {
  canonicalBipedGuideFiles,
  type InterfaceSourceManifest,
} from './interface-source-schema.js'
import {
  assertPortableRepositoryLeaf,
  readTrustedRepositoryFile,
} from './trusted-repository-file.js'

export interface Task9DependencySeed { path: string; group: string }

const EVIDENCE_MANIFEST_PATH = 'packages/asset-catalog/audit/v0.3.0/evidence-manifest.json'
export const TASK9_TRACKED_DEPENDENCIES_PATH = 'packages/asset-catalog/audit/v0.3.0/task9-tracked-dependencies.json'

export const TASK9_EVIDENCE_SEED_FILES: readonly Task9DependencySeed[] = [
  ...['catalog.json', 'parts.json', 'semantic-traits.json', 'themes.json', 'rigs.json', 'modifiers.json']
    .map(name => ({ path: `packages/asset-catalog/catalog/v0.3.0/${name}`, group: 'catalog' })),
  { path: 'packages/asset-catalog/source-index-v0.3.0.json', group: 'source-index' },
  { path: 'asset-source/v0.3.0/interface-manifest.json', group: 'interface-manifest' },
  { path: 'asset-source/v0.3.0/production/processed-index.json', group: 'processed-index' },
  { path: 'asset-source/v0.3.0/provenance/retained-v0.2-nonstructural.json', group: 'retained-provenance' },
  { path: 'asset-source/v0.3.0/provenance/v0.3-structural-union-color-masks.json', group: 'color-provenance' },
  { path: 'asset-source/v0.3.0/retained-v0.2/coordinate-metadata.json', group: 'retained-coordinate-metadata' },
  { path: 'asset-source/v0.3.0/retained-v0.2/structural-union-alpha-index.json', group: 'color-structural-union' },
  { path: 'packages/asset-catalog/audit/v0.3.0/task9-composition-statistics.json', group: 'composition-statistics' },
  { path: 'packages/asset-catalog/audit/v0.3.0/task9-pipeline-fixed-point.json', group: 'pipeline-fixed-point' },
  { path: 'packages/asset-catalog/audit/v0.3.0/task9-stale-runtime-removal.json', group: 'stale-removal' },
  { path: 'scripts/render-tail-extra-structural-matrices.ts', group: 'task9-live-renderer' },
  { path: 'scripts/task9-structural-identities.ts', group: 'task9-live-renderer' },
  { path: 'scripts/render-limb-contact-sheets.ts', group: 'task9-live-renderer' },
  { path: 'apps/creator-web/src/render-test.ts', group: 'task9-live-renderer' },
  { path: 'packages/renderer-canvas/src/render.ts', group: 'task9-live-renderer' },
  { path: 'packages/renderer-canvas/src/types.ts', group: 'task9-live-renderer' },
  ...[
    'packages/asset-catalog/src/bridge-render-review-provenance.ts',
    'packages/asset-catalog/src/cli.ts',
    'packages/asset-catalog/src/evidence-root.ts',
    'packages/asset-catalog/src/production-validation.ts',
    'packages/asset-catalog/src/source-rich-validation.ts',
    'packages/asset-catalog/src/task9-evidence-dependencies.ts',
    'packages/asset-catalog/src/trusted-repository-file.ts',
    'packages/generator-core/src/catalog-schema.ts',
    'scripts/build-task9-evidence-manifest.ts',
    'scripts/prepare-tail-extra-assets.ts',
    'scripts/task8-stable-projection.ts',
    'tests/render/production-composition.spec.ts',
    'vitest.coverage.config.ts',
  ].map(path => ({ path, group: 'task9-validation' })),
  ...[
    'review-record.json', 'biped-vertical-slice-acceptance.json', 'task6-approved-input-integrity.json',
    'body-head-contact-sheets-acceptance.json', 'body-head-review-record.json', 'body-head-connector-amendment.json',
    'limb-contact-sheets-acceptance.json', 'limb-review-record.json', 'visible-limb-threshold-amendment.json',
    'tail-extra-review-record.json', 'rework-record.json', 'structural-matrix-index.json',
  ].map(name => ({ path: `packages/asset-catalog/review/v0.3.0/${name}`, group: 'task6-9-review' })),
]

export const TASK9_EVIDENCE_RECURSIVE_DIRECTORIES: readonly Task9DependencySeed[] = [
  { path: 'asset-source/v0.3.0/generation/task9-candidates', group: 'task9-generation' },
  { path: 'asset-source/v0.3.0/generation/task9-extracted', group: 'task9-generation' },
  { path: 'asset-source/v0.3.0/generation/task9-normalized', group: 'task9-generation' },
  { path: 'asset-source/v0.3.0/generation/task9-review', group: 'task9-generation-review' },
  { path: 'asset-source/v0.3.0/production', group: 'production-provenance' },
  { path: 'asset-source/v0.3.0/provenance', group: 'production-provenance' },
  { path: 'packages/asset-catalog/review/v0.3.0/superseded', group: 'task9-superseded-review' },
]

function portable(path: string): string {
  return path.replaceAll('\\', '/')
}

function contained(root: string, target: string): boolean {
  const remainder = relative(root, target)
  return remainder === '' || (!remainder.startsWith('..') && !isAbsolute(remainder))
}

function normalizeReference(path: string): string | undefined {
  const normalized = portable(path)
  if (normalized.startsWith('assets/v0.3.0/')) return `packages/asset-catalog/${normalized}`
  if (/^(?:asset-source|packages|scripts|apps|tests|docs)\//u.test(normalized)) return normalized
  return undefined
}

function referencedPaths(value: unknown, key = ''): string[] {
  if (Array.isArray(value)) return value.flatMap(item => referencedPaths(item, key))
  if (value === null || typeof value !== 'object') {
    if (typeof value !== 'string' || !(key === 'path' || key.toLowerCase().endsWith('path'))) return []
    const normalized = normalizeReference(value)
    return normalized === undefined ? [] : [normalized]
  }
  return Object.entries(value).flatMap(([childKey, child]) => referencedPaths(child, childKey))
}

async function recursiveFiles(repositoryRoot: string, directory: string): Promise<string[]> {
  assertPortableRepositoryLeaf(directory)
  const root = await realpath(resolve(repositoryRoot))
  const lexicalDirectory = resolve(root, directory)
  if (!contained(root, lexicalDirectory)) throw new Error(`Task 9 dependency directory escapes repository root: ${directory}`)
  const directoryMetadata = await lstat(lexicalDirectory)
  if (directoryMetadata.isSymbolicLink() || !directoryMetadata.isDirectory()) {
    throw new Error(`Task 9 dependency directory must be a direct directory: ${directory}`)
  }
  const files: string[] = []
  const visit = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const target = resolve(current, entry.name)
      const path = portable(relative(root, target))
      if (!contained(root, target)) throw new Error(`Task 9 recursive dependency escapes repository root: ${path}`)
      const metadata = await lstat(target)
      if (metadata.isSymbolicLink()) throw new Error(`Task 9 dependency tree contains a symbolic link: ${path}`)
      if (metadata.isDirectory()) await visit(target)
      else if (metadata.isFile()) files.push(path)
      else throw new Error(`Task 9 dependency tree contains a non-regular entry: ${path}`)
    }
  }
  await visit(lexicalDirectory)
  return files
}

export async function collectCanonicalInterfaceGuideSeeds(
  repositoryRoot: string,
  manifest: InterfaceSourceManifest,
): Promise<Task9DependencySeed[]> {
  const seeds = canonicalBipedGuideFiles(manifest).map(name => ({
    path: `asset-source/v0.3.0/guides/${name}`,
    group: 'interface-guides',
  }))
  for (const seed of seeds) {
    try {
      await readTrustedRepositoryFile(repositoryRoot, seed.path)
    } catch {
      throw new Error(`Missing canonical interface guide dependency: ${seed.path}`)
    }
  }
  return seeds
}

export async function collectEvidenceDependencyClosure(input: {
  repositoryRoot: string
  seedFiles: readonly Task9DependencySeed[]
  recursiveDirectories: readonly Task9DependencySeed[]
}): Promise<Task9EvidenceDependency[]> {
  const repositoryRoot = await realpath(resolve(input.repositoryRoot))
  const groups = new Map<string, Set<string>>()
  const documentQueue: string[] = []
  const parsedDocuments = new Set<string>()
  const add = (path: string, group: string): void => {
    const normalized = portable(path)
    assertPortableRepositoryLeaf(normalized)
    if (normalized === EVIDENCE_MANIFEST_PATH) {
      throw new Error('Task 9 evidence dependency graph must not contain its own manifest.')
    }
    const existing = groups.get(normalized) ?? new Set<string>()
    existing.add(group)
    groups.set(normalized, existing)
    if (normalized.endsWith('.json')) documentQueue.push(normalized)
  }
  for (const seed of input.seedFiles) add(seed.path, seed.group)
  for (const directory of input.recursiveDirectories) {
    for (const path of await recursiveFiles(repositoryRoot, directory.path)) add(path, directory.group)
  }
  while (documentQueue.length > 0) {
    const documentPath = documentQueue.shift()!
    if (parsedDocuments.has(documentPath)) continue
    parsedDocuments.add(documentPath)
    const document = JSON.parse((await readTrustedRepositoryFile(repositoryRoot, documentPath)).bytes.toString('utf8')) as unknown
    const inheritedGroups = [...groups.get(documentPath)!]
    for (const reference of referencedPaths(document)) {
      for (const group of inheritedGroups) add(reference, group)
    }
  }
  return Promise.all([...groups].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(async ([path, pathGroups]) => {
      const trusted = await readTrustedRepositoryFile(repositoryRoot, path)
      return { path, sha256: trusted.sha256, groups: [...pathGroups].sort() }
    }))
}

export async function collectExpectedTask9EvidenceDependencies(repositoryRoot: string): Promise<Task9EvidenceDependency[]> {
  const manifestFile = await readTrustedRepositoryFile(repositoryRoot, 'asset-source/v0.3.0/interface-manifest.json')
  const interfaceManifest = JSON.parse(manifestFile.bytes.toString('utf8')) as InterfaceSourceManifest
  const guideSeeds = await collectCanonicalInterfaceGuideSeeds(repositoryRoot, interfaceManifest)
  return collectEvidenceDependencyClosure({
    repositoryRoot,
    seedFiles: [...TASK9_EVIDENCE_SEED_FILES, ...guideSeeds],
    recursiveDirectories: TASK9_EVIDENCE_RECURSIVE_DIRECTORIES,
  })
}

export function expectedTask9TrackedDependencyPaths(dependencies: readonly Task9EvidenceDependency[]): string[] {
  return [...dependencies.map(item => item.path), EVIDENCE_MANIFEST_PATH].sort()
}
