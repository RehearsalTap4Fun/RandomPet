import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { buildProductionCatalog } from './build-production-catalog.js'
import { contactCompositeOrder, contactPlacement, planContactSheets, renderContactCell } from './render-production-contact-sheets.js'

describe('production contact-sheet plan', () => {
  it('places every visual candidate on every declared compatible rig exactly once', async () => {
    const { catalog } = await buildProductionCatalog({ write: false })
    const plan = planContactSheets(catalog)
    const expectedPlacements = catalog.parts.reduce((count, part) => count + part.compatibleRigs.length, 0)

    expect(plan.map(sheet => sheet.rigId)).toEqual(['blob', 'biped', 'floating'])
    expect(plan.flatMap(sheet => sheet.partIds)).toHaveLength(expectedPlacements)
    for (const part of catalog.parts) {
      for (const rigId of part.compatibleRigs) {
        expect(plan.find(sheet => sheet.rigId === rigId)?.partIds.filter(id => id === part.id)).toHaveLength(1)
      }
    }
  })

  it('composites a compatible part and rig into one review cell', async () => {
    const { catalog } = await buildProductionCatalog({ write: false })
    const cell = await renderContactCell(catalog, 'blob', 'eyes_glossy_pair')
    await expect(sharp(cell).metadata()).resolves.toMatchObject({ width: 300, height: 340, hasAlpha: true })
  })

  it('reviews rear appendages behind the locked base and body candidates standalone', () => {
    expect(contactCompositeOrder('rearAppendage', 'tail')).toEqual(['candidate', 'base'])
    expect(contactCompositeOrder('body', 'bodyFrame')).toEqual(['candidate'])
    expect(contactCompositeOrder('faceAndHeadwear', 'eyes')).toEqual(['base', 'candidate'])
  })

  it('uses the catalog socket and origin on the renderer 2048 master canvas', async () => {
    const { catalog } = await buildProductionCatalog({ write: false })
    const rig = catalog.rigs.find(candidate => candidate.id === 'blob')!
    const tail = catalog.parts.find(candidate => candidate.id === 'tail_soft_curl')!
    expect(contactPlacement(tail, rig)).toEqual({ left: 1126, top: 748 })
  })
})
