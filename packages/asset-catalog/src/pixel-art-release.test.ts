import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { requirePixelArtCatalog, generatablePixelPhenotypes, restorePixelAppearance, savePixelAppearance } from './pixel-art-catalog.js'

const root = new URL('../pixel/v1/', import.meta.url)
const read = async (file: string) => JSON.parse(await readFile(new URL(file, root), 'utf8'))

it('promotes exactly the fourteen reviewed appearances without changing their pixels', async () => {
  const approved = requirePixelArtCatalog(await read('catalog.approved.json'))
  const candidate = requirePixelArtCatalog(await read('catalog.candidate.json'))
  expect(approved.coverage).toHaveLength(14)
  expect(approved.artVersion).toBe('1.1.0')
  expect(generatablePixelPhenotypes(approved)).toHaveLength(14)
  expect(approved.coverage.every(c => c.review === 'approved')).toBe(true)
  expect(approved.coverage.map(({ id, phenotype, rgbaSha256 }) => ({ id, phenotype, rgbaSha256 })))
    .toEqual(candidate.coverage.map(({ id, phenotype, rgbaSha256 }) => ({ id, phenotype, rgbaSha256 })))
  expect(approved.profiles).toEqual(candidate.profiles)
  expect(approved.resources).toEqual(candidate.resources)
})

it('keeps both old catalogs pinned for saved appearance replay', async () => {
  const approval = JSON.parse(await readFile(new URL('../../../docs/qa/flat-source-trial/stage2/approval.json', import.meta.url), 'utf8'))
  for (const [name, expected] of Object.entries(approval.previousCatalogSha256)) {
    const bytes = await readFile(new URL(name, root))
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(expected)
    const catalog = requirePixelArtCatalog(JSON.parse(bytes.toString()))
    const saved = savePixelAppearance(catalog.coverage.at(-1)!.phenotype, catalog)
    expect(restorePixelAppearance(saved, catalog)).toEqual(saved.phenotype)
  }
})
