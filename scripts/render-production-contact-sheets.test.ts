import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { loadCommittedProductionCatalog } from './build-production-catalog.js'
import { productionPaths } from './production-paths.js'
import { contactCompositeOrder, contactPlacement, measureRearLayerVisibility, planContactSheets, renderContactCell } from './render-production-contact-sheets.js'

describe('production contact-sheet plan', () => {
  it('places every visual candidate on every declared compatible rig exactly once', async () => {
    const { catalog } = await loadCommittedProductionCatalog({ version: '0.1.0' })
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
    const { catalog } = await loadCommittedProductionCatalog({ version: '0.1.0' })
    const rendererFrame = await sharp({ create: { width: 280, height: 280, channels: 4, background: '#ff0000ff' } }).png().toBuffer()
    const cell = await renderContactCell(catalog, 'blob', 'eyes_glossy_pair', rendererFrame)
    await expect(sharp(cell).metadata()).resolves.toMatchObject({ width: 300, height: 340, hasAlpha: true })
    const pixel = await sharp(cell).extract({ left: 150, top: 140, width: 1, height: 1 }).raw().toBuffer()
    expect([...pixel.slice(0, 3)]).toEqual([255, 0, 0])
  })

  it('reviews rear appendages behind the locked base and body candidates standalone', () => {
    expect(contactCompositeOrder('rearAppendage', 'tail')).toEqual(['candidate', 'base'])
    expect(contactCompositeOrder('body', 'bodyFrame')).toEqual(['candidate'])
    expect(contactCompositeOrder('faceAndHeadwear', 'eyes')).toEqual(['base', 'candidate'])
  })

  it('keeps broad biped moth wings clearly visible outside the body in renderer placement', async () => {
    const { catalog } = await loadCommittedProductionCatalog({ version: '0.1.0' })
    const audit = await measureRearLayerVisibility(catalog, 'biped', 'extra_moth_wings', productionPaths('0.1.0'))
    expect(audit.visibleFraction).toBeGreaterThan(0.3)
    expect(audit.clippedForegroundPixels).toBe(0)
  })

  it('uses renderer placement for representative body, head, mouth, appendage, and tail parts', async () => {
    const { catalog } = await loadCommittedProductionCatalog({ version: '0.1.0' })
    const rig = catalog.rigs.find(candidate => candidate.id === 'blob')!
    const placement = (id: string) => contactPlacement(
      catalog.parts.find(candidate => candidate.id === id)!,
      rig,
    )
    expect(placement('body_blob_round')).toEqual({ x: 512, y: 512, scaleX: 1, scaleY: 1 })
    expect(placement('head_round_dome')).toEqual({ x: 512, y: 188, scaleX: 1, scaleY: 1 })
    expect(placement('mouth_wide_grin')).toEqual({ x: 512, y: 188, scaleX: 1, scaleY: 1 })
    expect(placement('arms_short_plush')).toEqual({ x: 512, y: 512, scaleX: 1, scaleY: 1 })
    expect(placement('tail_soft_curl')).toEqual({ x: 998, y: 748, scaleX: 1, scaleY: 1 })
  })
})
