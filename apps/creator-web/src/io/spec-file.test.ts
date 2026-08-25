import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CatalogRegistry } from '@qmonster/asset-catalog/registry'
import {
  makeCompositionCatalogFixture,
  makeValidCatalogFixture,
  makeValidCompositionSpecFixture,
  makeValidMonsterSpecFixture,
} from '@qmonster/generator-core/test-fixtures'
import type { Catalog, MonsterSpec } from '@qmonster/generator-core'
import { downloadSpec, parseSpecFile } from './spec-file.js'

const ONE_MIB = 1024 * 1024

function createRegistry(...catalogs: Catalog[]): CatalogRegistry {
  return new CatalogRegistry(new Map(
    catalogs.map(catalog => [catalog.version, async () => catalog]),
  ))
}

function createSpecFile(spec: MonsterSpec): File {
  return new File([JSON.stringify(spec)], 'monster.json', { type: 'application/json' })
}

function installDownloadSpies() {
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:qmonster-spec')
  const revokeObjectURL = vi.fn((_url: string) => undefined)
  Object.defineProperties(URL, {
    createObjectURL: { configurable: true, value: createObjectURL },
    revokeObjectURL: { configurable: true, value: revokeObjectURL },
  })
  let clickedAnchor: HTMLAnchorElement | undefined
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clickedAnchor = this
  })
  return {
    createObjectURL,
    revokeObjectURL,
    click,
    get clickedAnchor() { return clickedAnchor },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('parseSpecFile', () => {
  let currentCatalog: Catalog
  let registry: CatalogRegistry

  beforeEach(() => {
    currentCatalog = makeValidCatalogFixture()
    registry = createRegistry(currentCatalog)
  })

  it('rejects over 1 MiB before reading or parsing', async () => {
    const file = new File(['x'.repeat(ONE_MIB + 1)], 'large.json')
    const read = vi.fn(() => Promise.resolve(JSON.stringify(makeValidMonsterSpecFixture())))
    Object.defineProperty(file, 'text', { configurable: true, value: read })

    expect(await parseSpecFile(file, registry)).toEqual({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'SPEC_FILE_TOO_LARGE' })],
    })
    expect(read).not.toHaveBeenCalled()
  })

  it('accepts a file exactly 1 MiB and reports its invalid content', async () => {
    const file = new File(['x'.repeat(ONE_MIB)], 'boundary.json')

    const result = await parseSpecFile(file, registry)

    expect(result).toEqual({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'SPEC_FILE_INVALID_JSON' })],
    })
  })

  it('returns a diagnostic for invalid JSON without exposing a partial value', async () => {
    const result = await parseSpecFile(
      new File(['{"schemaVersion":'], 'broken.json', { type: 'application/json' }),
      registry,
    )

    expect(result).toEqual({
      ok: false,
      diagnostics: [expect.objectContaining({
        severity: 'error',
        code: 'SPEC_FILE_INVALID_JSON',
      })],
    })
    expect('value' in result).toBe(false)
  })

  it('returns a read diagnostic without parsing when the file cannot be read', async () => {
    const file = new File(['unavailable'], 'unavailable.json')
    const read = vi.fn(() => Promise.reject(new DOMException('denied', 'NotReadableError')))
    Object.defineProperty(file, 'text', { configurable: true, value: read })

    const result = await parseSpecFile(file, registry)

    expect(result).toEqual({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'SPEC_FILE_READ_FAILED' })],
    })
    expect('value' in result).toBe(false)
  })

  it.each([
    ['schemaVersion', '9.9.9', 'SPEC_SCHEMA_VERSION_UNSUPPORTED'],
    ['rendererVersion', '9.9.9', 'SPEC_RENDERER_VERSION_UNSUPPORTED'],
  ] as const)('rejects an unsupported %s', async (field, version, code) => {
    const spec = makeValidMonsterSpecFixture()
    spec[field] = version

    const result = await parseSpecFile(createSpecFile(spec), registry)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.diagnostics).toContainEqual(expect.objectContaining({ code }))
  })

  it('returns the exact missing-catalog diagnostic without a partial value', async () => {
    const spec = makeValidMonsterSpecFixture()
    spec.catalogVersion = '0.0.8'

    const result = await parseSpecFile(createSpecFile(spec), registry)

    expect(result).toEqual({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'CATALOG_VERSION_MISSING' })],
    })
    expect('value' in result).toBe(false)
  })

  it('returns a catalog diagnostic when the exact installed loader fails', async () => {
    const failedRegistry = new CatalogRegistry(new Map([
      ['0.1.0', async () => Promise.reject(new Error('catalog unavailable'))],
    ]))

    const result = await parseSpecFile(
      createSpecFile(makeValidMonsterSpecFixture()),
      failedRegistry,
    )

    expect(result).toEqual({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'CATALOG_LOAD_FAILED' })],
    })
    expect('value' in result).toBe(false)
  })

  it('loads the exact catalog and rejects semantic invalidity', async () => {
    const spec = makeValidMonsterSpecFixture()
    spec.visualSlots.legs.rigId = 'floating'
    const legs = currentCatalog.parts.find(part => part.slotId === 'legs')!
    legs.compatibleRigs = ['blob']

    const result = await parseSpecFile(createSpecFile(spec), registry)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.diagnostics.map(item => item.code)).toContain('SPEC_RIG_INCOMPATIBLE')
    }
  })

  it('loads an installed old catalog and warns only after complete validation succeeds', async () => {
    const oldCatalog = makeValidCatalogFixture()
    const spec = makeValidMonsterSpecFixture()

    const result = await parseSpecFile(createSpecFile(spec), createRegistry(oldCatalog))

    expect(result).toEqual({
      ok: true,
      value: { spec, catalog: oldCatalog },
      diagnostics: [expect.objectContaining({
        severity: 'warning',
        code: 'CATALOG_VERSION_OLD',
      })],
    })
  })

  it.each([
    ['0.1.0', '0.1.0', false],
    ['0.1.0', '0.2.0', true],
    ['0.2.0', '0.1.0', false],
    ['0.2.0', '0.2.0', false],
  ] as const)(
    'warns only when exact installed catalog %s is older than %s',
    async (catalogVersion, currentVersion, expectOldWarning) => {
      const catalog = catalogVersion === '0.2.0'
        ? makeCompositionCatalogFixture()
        : makeValidCatalogFixture()
      const spec = catalogVersion === '0.2.0'
        ? makeValidCompositionSpecFixture(catalog)
        : makeValidMonsterSpecFixture()

      const result = await parseSpecFile(createSpecFile(spec), createRegistry(catalog), currentVersion)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.diagnostics.some(item => item.code === 'CATALOG_VERSION_OLD')).toBe(
          expectOldWarning,
        )
      }
    },
  )

  it.each(['0.0.9', '0.1.0-alpha.1', '0.1.0+build.7'] as const)(
    'rejects unsupported exact catalog version %s without an old-catalog warning',
    async catalogVersion => {
      const catalog = makeValidCatalogFixture()
      const spec = makeValidMonsterSpecFixture()
      catalog.version = catalogVersion
      spec.catalogVersion = catalogVersion

      const result = await parseSpecFile(createSpecFile(spec), createRegistry(catalog), '0.2.0')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.diagnostics).toContainEqual(expect.objectContaining({
          severity: 'error',
          code: 'SPEC_CATALOG_VERSION_UNSUPPORTED',
        }))
        expect(result.diagnostics).not.toContainEqual(expect.objectContaining({
          code: 'CATALOG_VERSION_OLD',
        }))
      }
    },
  )

  it('does not return the old-catalog warning when semantic validation fails', async () => {
    const oldCatalog = makeValidCatalogFixture()
    oldCatalog.parts.find(part => part.slotId === 'legs')!.compatibleRigs = ['biped']
    const spec = makeValidMonsterSpecFixture()

    const result = await parseSpecFile(createSpecFile(spec), createRegistry(oldCatalog))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.diagnostics).toContainEqual(expect.objectContaining({
        code: 'SPEC_RIG_INCOMPATIBLE',
      }))
      expect(result.diagnostics).not.toContainEqual(expect.objectContaining({
        code: 'CATALOG_VERSION_OLD',
      }))
    }
  })

  it('round-trips a valid spec with its exact catalog and legacy warning', async () => {
    const spec = makeValidMonsterSpecFixture()

    await expect(parseSpecFile(createSpecFile(spec), registry)).resolves.toEqual({
      ok: true,
      value: { spec, catalog: currentCatalog },
      diagnostics: [expect.objectContaining({ code: 'CATALOG_VERSION_OLD' })],
    })
  })

  it('uses 0.2.0 as the default current catalog for legacy import warnings', async () => {
    const oldCatalog = makeValidCatalogFixture()
    const spec = makeValidMonsterSpecFixture()

    const result = await parseSpecFile(createSpecFile(spec), createRegistry(oldCatalog))

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'CATALOG_VERSION_OLD',
    }))
  })
})

describe('downloadSpec', () => {
  it('downloads two-space JSON with a trailing newline and the exact filename', async () => {
    const spec = makeValidMonsterSpecFixture()
    const download = installDownloadSpies()

    downloadSpec(spec)

    const blob = download.createObjectURL.mock.calls[0]?.[0]
    expect(blob).toBeInstanceOf(Blob)
    expect(blob?.type).toBe('application/json')
    await expect(blob?.text()).resolves.toBe(`${JSON.stringify(spec, null, 2)}\n`)
    const anchor = download.clickedAnchor!
    expect(anchor.download).toBe('qmonster-fungal-84721937.json')
    expect(anchor.href).toBe('blob:qmonster-spec')
    expect(download.revokeObjectURL).toHaveBeenCalledWith('blob:qmonster-spec')
    expect(download.click.mock.invocationCallOrder[0]).toBeLessThan(
      download.revokeObjectURL.mock.invocationCallOrder[0]!,
    )
  })

  it('revokes the object URL in finally when the synthetic click throws', () => {
    const spec = makeValidMonsterSpecFixture()
    const { revokeObjectURL, click } = installDownloadSpies()
    const clickError = new Error('download blocked')
    click.mockImplementation(() => { throw clickError })

    expect(() => downloadSpec(spec)).toThrow(clickError)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:qmonster-spec')
  })
})
