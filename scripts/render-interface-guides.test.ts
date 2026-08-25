import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { renderInterfaceGuides } from './render-interface-guides.js'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))))

describe('renderInterfaceGuides', () => {
  it('renders neck shoulder and hip guides with literal connector IDs and transparent binary masks', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'qmonster-interface-guides-'))
    roots.push(outputRoot)
    await mkdir(outputRoot, { recursive: true })
    const connectorIds = ['neck', 'shoulderLeft', 'shoulderRight', 'hipLeft', 'hipRight']
    const result = await renderInterfaceGuides({
      outputRoot,
      rigId: 'biped',
      profiles: connectorIds.map((id, index) => ({
        assetId: 'body_biped_peanut', id, role: 'receiver' as const,
        connectorClass: id.startsWith('shoulder') ? 'shoulder' as const : id.startsWith('hip') ? 'hip' as const : 'neck' as const,
        origin: { x: 700 + index * 150, y: 900 + index * 60 },
        tangent: { x: 1, y: 0 }, outwardNormal: { x: 0, y: -1 }, width: 220, depth: 100,
      })),
    })

    expect(result.connectorIds).toEqual(connectorIds)
    const guide = await sharp(result.guidePaths.neck).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const mask = await sharp(result.maskPaths.neck).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    expect(guide.info).toMatchObject({ width: 2048, height: 2048, channels: 4 })
    expect(mask.info).toMatchObject({ width: 2048, height: 2048, channels: 4 })
    const guideAlpha = [...guide.data].filter((_value, index) => index % 4 === 3)
    const maskAlpha = [...mask.data].filter((_value, index) => index % 4 === 3)
    expect(guideAlpha.some(alpha => alpha === 0)).toBe(true)
    expect(guideAlpha.some(alpha => alpha > 0)).toBe(true)
    expect(new Set(maskAlpha)).toEqual(new Set([0, 255]))
  }, 20_000)

  it('is deterministic for the same connector geometry', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'qmonster-interface-guides-'))
    roots.push(outputRoot)
    const fixture = {
      outputRoot, rigId: 'biped' as const,
      profiles: [{
        assetId: 'head_round_dome', id: 'neck', role: 'plug' as const, connectorClass: 'neck' as const,
        origin: { x: 1024, y: 1400 }, tangent: { x: 1, y: 0 }, outwardNormal: { x: 0, y: 1 }, width: 300, depth: 160,
      }],
    }
    const first = await renderInterfaceGuides(fixture)
    const second = await renderInterfaceGuides(fixture)
    expect(second.files).toEqual(first.files)
  })
})
