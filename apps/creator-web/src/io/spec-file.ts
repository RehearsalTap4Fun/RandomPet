import type { CatalogRegistry } from '@qmonster/asset-catalog/registry'
import {
  parseMonsterSpec,
  validateMonsterSpecAgainstCatalog,
  type Catalog,
  type Diagnostic,
  type MonsterSpec,
} from '@qmonster/generator-core'

const MAX_SPEC_FILE_BYTES = 1024 * 1024
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

interface SemanticVersion {
  major: bigint
  minor: bigint
  patch: bigint
  prerelease: string[] | null
}

export type SpecFileResult =
  | { ok: true; value: { spec: MonsterSpec; catalog: Catalog }; diagnostics: Diagnostic[] }
  | { ok: false; diagnostics: Diagnostic[] }

function fileError(code: string, message: string): Diagnostic {
  return { severity: 'error', code, path: [], message }
}

function oldCatalogWarning(version: string, currentVersion: string): Diagnostic {
  return {
    severity: 'warning',
    code: 'CATALOG_VERSION_OLD',
    path: ['catalogVersion'],
    message: `Catalog version ${version} is installed but older than ${currentVersion}.`,
  }
}

function parseSemanticVersion(version: string): SemanticVersion | undefined {
  const match = SEMVER_PATTERN.exec(version)
  const major = match?.[1]
  const minor = match?.[2]
  const patch = match?.[3]
  if (major === undefined || minor === undefined || patch === undefined) return undefined
  const prerelease = match?.[4]?.split('.') ?? null
  if (prerelease?.some(identifier => /^\d+$/.test(identifier) && /^0\d/.test(identifier))) {
    return undefined
  }
  return {
    major: BigInt(major),
    minor: BigInt(minor),
    patch: BigInt(patch),
    prerelease,
  }
}

function comparePrerelease(left: readonly string[], right: readonly string[]): number {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const leftIdentifier = left[index]!
    const rightIdentifier = right[index]!
    if (leftIdentifier === rightIdentifier) continue
    const leftNumeric = /^\d+$/.test(leftIdentifier)
    const rightNumeric = /^\d+$/.test(rightIdentifier)
    if (leftNumeric && rightNumeric) {
      return BigInt(leftIdentifier) < BigInt(rightIdentifier) ? -1 : 1
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
    return leftIdentifier < rightIdentifier ? -1 : 1
  }
  return Math.sign(left.length - right.length)
}

function isSemanticVersionOlder(version: string, currentVersion: string): boolean {
  const candidate = parseSemanticVersion(version)
  const current = parseSemanticVersion(currentVersion)
  if (candidate === undefined || current === undefined) return false

  for (const field of ['major', 'minor', 'patch'] as const) {
    if (candidate[field] !== current[field]) return candidate[field] < current[field]
  }
  if (candidate.prerelease === null) return false
  if (current.prerelease === null) return true
  return comparePrerelease(candidate.prerelease, current.prerelease) < 0
}

export async function parseSpecFile(
  file: File,
  registry: CatalogRegistry,
  currentCatalogVersion = '0.3.0',
): Promise<SpecFileResult> {
  if (file.size > MAX_SPEC_FILE_BYTES) {
    return {
      ok: false,
      diagnostics: [fileError(
        'SPEC_FILE_TOO_LARGE',
        'MonsterSpec files must not exceed 1 MiB.',
      )],
    }
  }

  let serialized: string
  try {
    serialized = await file.text()
  } catch {
    return {
      ok: false,
      diagnostics: [fileError(
        'SPEC_FILE_READ_FAILED',
        'The selected MonsterSpec file could not be read.',
      )],
    }
  }

  let input: unknown
  try {
    input = JSON.parse(serialized) as unknown
  } catch {
    return {
      ok: false,
      diagnostics: [fileError(
        'SPEC_FILE_INVALID_JSON',
        'The selected MonsterSpec file is not valid JSON.',
      )],
    }
  }

  const parsed = parseMonsterSpec(input)
  if (!parsed.ok) return parsed

  const loaded = await registry.load(parsed.value.catalogVersion)
  if (!loaded.ok) return loaded

  const diagnostics = validateMonsterSpecAgainstCatalog(parsed.value, loaded.value)
  if (diagnostics.some(diagnostic => diagnostic.severity === 'error')) {
    return { ok: false, diagnostics }
  }
  if (isSemanticVersionOlder(parsed.value.catalogVersion, currentCatalogVersion)) {
    diagnostics.push(oldCatalogWarning(parsed.value.catalogVersion, currentCatalogVersion))
  }

  return {
    ok: true,
    value: { spec: parsed.value, catalog: loaded.value },
    diagnostics,
  }
}

export function downloadSpec(spec: MonsterSpec): void {
  const blob = new Blob([`${JSON.stringify(spec, null, 2)}\n`], { type: 'application/json' })
  const objectUrl = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = `qmonster-${spec.themeId}-${spec.seed}.json`
    anchor.click()
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
