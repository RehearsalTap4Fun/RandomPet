import { CatalogRegistry } from '@qmonster/asset-catalog'
import {
  parseMonsterSpec,
  validateMonsterSpecAgainstCatalog,
  type Catalog,
  type Diagnostic,
  type MonsterSpec,
} from '@qmonster/generator-core'

const MAX_SPEC_FILE_BYTES = 1024 * 1024

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

export async function parseSpecFile(
  file: File,
  registry: CatalogRegistry,
  currentCatalogVersion = '0.1.0',
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
  if (parsed.value.catalogVersion !== currentCatalogVersion) {
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
