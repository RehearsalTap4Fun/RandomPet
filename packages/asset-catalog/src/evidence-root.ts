import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import type { Diagnostic } from '@qmonster/generator-core'

export const PRODUCTION_EVIDENCE_MANIFEST_VERSION = 'qmonster-production-evidence-v1' as const
export const PRODUCTION_EVIDENCE_CANONICALIZATION = 'json-object-keys-unicode-code-point-v1' as const

export interface ProductionEvidenceManifest {
  manifestVersion: typeof PRODUCTION_EVIDENCE_MANIFEST_VERSION
  canonicalization: typeof PRODUCTION_EVIDENCE_CANONICALIZATION
  catalogVersion: string
  sourceIndexPath: string
  evidenceRootSha256: string
  task9Evidence?: Task9ProductionEvidence
}

export interface Task9EvidenceDependency {
  path: string
  sha256: string
  groups: string[]
}

export interface Task9ProductionEvidence {
  schemaVersion: 'task9-production-evidence-v1'
  sourceEntryCount: number
  dependencyCount: number
  dependencies: Task9EvidenceDependency[]
  compositionStatistics: {
    seedCount: number
    optionalNoneRates: Record<string, number>
    maximumStrongFeatures: number
    maximumSurpriseSlots: number
    surpriseLimit: number
  }
  structuralMatrix: {
    entryCount: number
    failureCount: number
    entryCountByRig: { blob: number; biped: number; floating: number }
    observedExtrema: Record<string, number>
    diagnosticScope: {
      id: 'task9-tail-extra'
      activeVisualSlots: ['tail', 'extraAppendage']
      activeConnectorIds: ['tailRoot', 'extraLeft', 'extraRight']
      defaultRendererErrorCount: 188
      activeErrorCount: 0
      suppressedInactiveErrorCount: 188
      suppressedInactiveErrorCountByRig: { blob: 75; biped: 68; floating: 45 }
    }
  }
  pipelineFixedPoint: {
    sequence: string[]
    round1Sha256: string
    round2Sha256: string
  }
}

function unicodeScalarValues(value: string): number[] {
  const scalars: number[] = []
  for (let offset = 0; offset < value.length;) {
    const first = value.charCodeAt(offset)
    if (first >= 0xD800 && first <= 0xDBFF) {
      const second = value.charCodeAt(offset + 1)
      if (!(second >= 0xDC00 && second <= 0xDFFF)) {
        throw new Error(`Unpaired high surrogate at UTF-16 offset ${offset}.`)
      }
      scalars.push(0x10000 + (first - 0xD800) * 0x400 + (second - 0xDC00))
      offset += 2
      continue
    }
    if (first >= 0xDC00 && first <= 0xDFFF) {
      throw new Error(`Unpaired low surrogate at UTF-16 offset ${offset}.`)
    }
    scalars.push(first)
    offset += 1
  }
  return scalars
}

function compareUnicodeScalarSequences(left: readonly number[], right: readonly number[]): number {
  const commonLength = Math.min(left.length, right.length)
  for (let index = 0; index < commonLength; index += 1) {
    if (left[index] !== right[index]) return left[index]! - right[index]!
  }
  return left.length - right.length
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'string') {
    unicodeScalarValues(value)
    return JSON.stringify(value)
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Production evidence contains a non-finite number.')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => ({ key, item, scalars: unicodeScalarValues(key) }))
      .sort((left, right) => compareUnicodeScalarSequences(left.scalars, right.scalars))
    return `{${entries.map(({ key, item }) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  throw new Error(`Production evidence contains unsupported ${typeof value}.`)
}

export function computeProductionEvidenceRoot(sourceIndex: unknown): string {
  return createHash('sha256').update(canonicalJson(sourceIndex)).digest('hex')
}

export function productionEvidenceSourceIndexPath(version: string): string {
  return version === '0.1.0'
    ? 'packages/asset-catalog/source-index.json'
    : `packages/asset-catalog/source-index-v${version}.json`
}

export function buildProductionEvidenceManifest(sourceIndex: { catalogVersion?: unknown }): ProductionEvidenceManifest {
  if (typeof sourceIndex.catalogVersion !== 'string' || sourceIndex.catalogVersion === '') {
    throw new Error('Production source-index needs catalogVersion before evidence-root generation.')
  }
  return {
    manifestVersion: PRODUCTION_EVIDENCE_MANIFEST_VERSION,
    canonicalization: PRODUCTION_EVIDENCE_CANONICALIZATION,
    catalogVersion: sourceIndex.catalogVersion,
    sourceIndexPath: productionEvidenceSourceIndexPath(sourceIndex.catalogVersion),
    evidenceRootSha256: computeProductionEvidenceRoot(sourceIndex),
  }
}

export function validateProductionEvidenceManifest(
  sourceIndex: { catalogVersion?: unknown },
  manifest: unknown,
): Diagnostic[] {
  const catalogVersion = typeof sourceIndex.catalogVersion === 'string' ? sourceIndex.catalogVersion : ''
  const path = ['audit', `v${catalogVersion}`, 'evidence-manifest.json']
  if (
    manifest === null
    || typeof manifest !== 'object'
    || (manifest as Record<string, unknown>).manifestVersion !== PRODUCTION_EVIDENCE_MANIFEST_VERSION
    || (manifest as Record<string, unknown>).canonicalization !== PRODUCTION_EVIDENCE_CANONICALIZATION
    || (manifest as Record<string, unknown>).catalogVersion !== sourceIndex.catalogVersion
    || (manifest as Record<string, unknown>).sourceIndexPath !== productionEvidenceSourceIndexPath(catalogVersion)
    || !/^[a-f0-9]{64}$/u.test(String((manifest as Record<string, unknown>).evidenceRootSha256 ?? ''))
  ) {
    return [{
      severity: 'error',
      code: 'PRODUCTION_EVIDENCE_MANIFEST_INVALID',
      path,
      message: `Production evidence manifest must use ${PRODUCTION_EVIDENCE_MANIFEST_VERSION} and the canonical source-index anchor.`,
    }]
  }
  const expected = computeProductionEvidenceRoot(sourceIndex)
  if ((manifest as ProductionEvidenceManifest).evidenceRootSha256 !== expected) {
    return [{
      severity: 'error',
      code: 'PRODUCTION_EVIDENCE_ROOT_MISMATCH',
      path: [...path, 'evidenceRootSha256'],
      message: 'Committed source-index differs from the independently anchored production evidence root.',
    }]
  }
  if (catalogVersion === '0.3.0') {
    const task9 = (manifest as ProductionEvidenceManifest).task9Evidence
    const dependencies = task9?.dependencies
    const statistics = task9?.compositionStatistics
    const optionalRates = statistics?.optionalNoneRates ?? {}
    const expectedOptionalSlots = ['effect', 'extraAppendage', 'headAppendage', 'tail']
    const validDependencies = Array.isArray(dependencies)
      && dependencies.length > 0
      && dependencies.every((item, index) => (
        /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/u.test(item.path)
        && item.path !== 'packages/asset-catalog/audit/v0.3.0/evidence-manifest.json'
        && /^[a-f0-9]{64}$/u.test(item.sha256)
        && Array.isArray(item.groups) && item.groups.length > 0 && item.groups.every(nonempty => typeof nonempty === 'string' && nonempty !== '')
        && (index === 0 || dependencies[index - 1]!.path < item.path)
      ))
    const validRates = Object.keys(optionalRates).sort().join(',') === expectedOptionalSlots.join(',')
      && Object.values(optionalRates).every(rate => Number.isFinite(rate) && rate >= 0.35 && rate <= 0.5)
    if (
      task9?.schemaVersion !== 'task9-production-evidence-v1'
      || task9.sourceEntryCount !== 102
      || task9.sourceEntryCount !== (Array.isArray((sourceIndex as { sources?: unknown }).sources) ? (sourceIndex as { sources: unknown[] }).sources.length : -1)
      || task9.dependencyCount !== dependencies?.length
      || !validDependencies
      || statistics?.seedCount !== 10_000
      || !validRates
      || !Number.isFinite(statistics?.maximumStrongFeatures)
      || (statistics?.maximumStrongFeatures ?? -1) < 0
      || (statistics?.maximumStrongFeatures ?? Number.POSITIVE_INFINITY) > 2
      || !Number.isFinite(statistics?.maximumSurpriseSlots)
      || (statistics?.maximumSurpriseSlots ?? -1) < 0
      || (statistics?.maximumSurpriseSlots ?? Number.POSITIVE_INFINITY) > 3
      || !Number.isFinite(statistics?.surpriseLimit)
      || (statistics?.surpriseLimit ?? -1) < 0
      || (statistics?.surpriseLimit ?? Number.POSITIVE_INFINITY) > 3
      || task9.structuralMatrix?.entryCount !== 39
      || task9.structuralMatrix?.failureCount !== 0
      || task9.structuralMatrix?.entryCountByRig?.blob !== 15
      || task9.structuralMatrix?.entryCountByRig?.biped !== 15
      || task9.structuralMatrix?.entryCountByRig?.floating !== 9
      || task9.structuralMatrix?.diagnosticScope?.id !== 'task9-tail-extra'
      || task9.structuralMatrix.diagnosticScope.activeVisualSlots?.join(',') !== 'tail,extraAppendage'
      || task9.structuralMatrix.diagnosticScope.activeConnectorIds?.join(',') !== 'tailRoot,extraLeft,extraRight'
      || task9.structuralMatrix.diagnosticScope.defaultRendererErrorCount !== 188
      || task9.structuralMatrix.diagnosticScope.activeErrorCount !== 0
      || task9.structuralMatrix.diagnosticScope.suppressedInactiveErrorCount !== 188
      || task9.structuralMatrix.diagnosticScope.suppressedInactiveErrorCountByRig?.blob !== 75
      || task9.structuralMatrix.diagnosticScope.suppressedInactiveErrorCountByRig?.biped !== 68
      || task9.structuralMatrix.diagnosticScope.suppressedInactiveErrorCountByRig?.floating !== 45
      || !Array.isArray(task9.pipelineFixedPoint?.sequence)
      || task9.pipelineFixedPoint.sequence.join('>') !== 'build-runtime-assets>build-color-scheme-masks>build-interface-catalog'
      || !/^[a-f0-9]{64}$/u.test(task9.pipelineFixedPoint.round1Sha256)
      || task9.pipelineFixedPoint.round1Sha256 !== task9.pipelineFixedPoint.round2Sha256
    ) return [{
      severity: 'error',
      code: 'PRODUCTION_TASK9_EVIDENCE_INVALID',
      path: [...path, 'task9Evidence'],
      message: 'v0.3 production evidence must bind the acyclic Task 9 dependency, distribution, structural-matrix, and pipeline fixed-point contracts.',
    }]
  }
  return []
}

export async function validateProductionEvidenceDependencies(
  manifest: unknown,
  repositoryRoot: string,
): Promise<Diagnostic[]> {
  if (manifest === null || typeof manifest !== 'object') return []
  const task9 = (manifest as ProductionEvidenceManifest).task9Evidence
  if (!Array.isArray(task9?.dependencies)) return []
  const diagnostics: Diagnostic[] = []
  const root = await realpath(resolve(repositoryRoot)).catch(() => resolve(repositoryRoot))
  const verified = new Map<string, { bytes: Buffer, sha256: string }>()
  for (const dependency of task9.dependencies) {
    const path = ['task9Evidence', 'dependencies', dependency.path]
    try {
      const target = await realpath(resolve(root, dependency.path))
      const remainder = relative(root, target)
      if (remainder.startsWith('..') || isAbsolute(remainder)) {
        diagnostics.push({
          severity: 'error', code: 'PRODUCTION_EVIDENCE_DEPENDENCY_PATH_INVALID', path,
          message: `Task 9 evidence dependency escapes the repository root: ${dependency.path}`,
        })
        continue
      }
      const metadata = await stat(target)
      if (!metadata.isFile() || metadata.nlink !== 1) {
        diagnostics.push({
          severity: 'error', code: 'PRODUCTION_EVIDENCE_DEPENDENCY_FILE_INVALID', path,
          message: `Task 9 evidence dependency must resolve to a linked regular file: ${dependency.path}`,
        })
        continue
      }
      const bytes = await readFile(target)
      const actualHash = createHash('sha256').update(bytes).digest('hex')
      verified.set(dependency.path, { bytes, sha256: actualHash })
      if (actualHash !== dependency.sha256) diagnostics.push({
        severity: 'error', code: 'PRODUCTION_EVIDENCE_DEPENDENCY_HASH_MISMATCH', path,
        message: `Task 9 evidence dependency differs from its final recorded SHA-256: ${dependency.path}`,
      })
    } catch {
      diagnostics.push({
        severity: 'error', code: 'PRODUCTION_EVIDENCE_DEPENDENCY_MISSING', path,
        message: `Task 9 evidence dependency cannot be read from its canonical repository path: ${dependency.path}`,
      })
    }
  }
  const reworkPath = 'packages/asset-catalog/review/v0.3.0/rework-record.json'
  const rework = verified.get(reworkPath)
  if (rework !== undefined) {
    const closureDiagnostic = (field: string, message: string): void => {
      diagnostics.push({
        severity: 'error', code: 'PRODUCTION_TASK9_REVIEW_CLOSURE_MISMATCH',
        path: ['task9Evidence', 'reviewClosure', field], message,
      })
    }
    try {
      const record = JSON.parse(rework.bytes.toString('utf8')) as {
        structuralMatrixReview?: {
          indexPath?: unknown, indexSha256?: unknown,
          tailExtraReviewRecordPath?: unknown, tailExtraReviewRecordSha256?: unknown,
        }
      }
      const review = record.structuralMatrixReview
      const references = [
        ['index', review?.indexPath, review?.indexSha256],
        ['tailExtraReviewRecord', review?.tailExtraReviewRecordPath, review?.tailExtraReviewRecordSha256],
      ] as const
      for (const [field, path, expectedHash] of references) {
        const actual = typeof path === 'string' ? verified.get(path) : undefined
        if (actual === undefined || expectedHash !== actual.sha256) {
          closureDiagnostic(`${field}Sha256`, `Task 9 rework review ${field} reference does not match the verified dependency bytes.`)
        }
      }
      const tailPath = typeof review?.tailExtraReviewRecordPath === 'string'
        ? review.tailExtraReviewRecordPath : ''
      const tail = verified.get(tailPath)
      if (tail !== undefined) {
        const tailRecord = JSON.parse(tail.bytes.toString('utf8')) as {
          structuralMatrixReview?: { indexPath?: unknown, indexSha256?: unknown }
        }
        const tailIndexPath = tailRecord.structuralMatrixReview?.indexPath
        const tailIndex = typeof tailIndexPath === 'string' ? verified.get(tailIndexPath) : undefined
        if (tailIndex === undefined || tailRecord.structuralMatrixReview?.indexSha256 !== tailIndex.sha256) {
          closureDiagnostic('tailExtraReviewRecord.indexSha256', 'Task 9 tail/extra review index reference does not match the verified dependency bytes.')
        }
      }
    } catch {
      closureDiagnostic('reworkRecord', 'Task 9 review closure records must be valid JSON with verified internal hashes.')
    }
  }
  return diagnostics
}
