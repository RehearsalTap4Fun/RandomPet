import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import candidatePointer from '../../../packages/asset-catalog/releases/candidate-v0.9.0.json'
import { loadActiveProductionRelease, type ProductionReleaseDocuments, type ProductionV09Release } from './v09-production-release.js'

export function candidateProductionReleaseOptions(overrides: ProductionReleaseDocuments = {}): ProductionReleaseDocuments {
  return {
    pointer: candidatePointer,
    loadResourceBytes: async resourceId => new Uint8Array(await readFile(join(
      process.cwd(), 'packages', 'asset-catalog', 'resources', 'by-sha256', resourceId.slice('sha256:'.length),
    ))),
    ...overrides,
  }
}

export function loadCandidateProductionRelease(): Promise<ProductionV09Release> {
  return loadActiveProductionRelease(candidateProductionReleaseOptions())
}
