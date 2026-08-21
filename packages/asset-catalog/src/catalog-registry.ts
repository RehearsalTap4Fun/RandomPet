import type { Catalog, Diagnostic, ParseResult } from '@qmonster/generator-core'

function missingVersionDiagnostic(version: string): Diagnostic {
  return {
    severity: 'error',
    code: 'CATALOG_VERSION_MISSING',
    path: ['catalogVersion'],
    message: `Catalog version ${version} is not installed.`,
  }
}

export class CatalogRegistry {
  public constructor(private readonly loaders: Map<string, () => Promise<Catalog>>) {}

  public has(version: string): boolean {
    return this.loaders.has(version)
  }

  public async load(version: string): Promise<ParseResult<Catalog>> {
    const loader = this.loaders.get(version)
    if (loader === undefined) return { ok: false, diagnostics: [missingVersionDiagnostic(version)] }
    return { ok: true, value: await loader() }
  }
}
