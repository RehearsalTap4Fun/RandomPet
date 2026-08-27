import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { connectorMaskFractions, connectorProfileSize, derivePairedNodeOrigin, extractPairedLimbCandidate, limbNormalizationSpec, limbRenderTransform, normalizePairedLimb, rootPreservingDistalWarp } from './prepare-limb-assets.js'

describe('Task 8 limb preparation', () => {
  it('uses explicit per-identity normalization and rig grammar without seed or screenshot coordinates', () => {
    expect(limbNormalizationSpec({ rigId: 'blob', slotId: 'arms', partId: 'arms_short_plush' })).toEqual({ width: 400, height: 500, fit: 'inside' })
    expect(limbNormalizationSpec({ rigId: 'blob', slotId: 'legs', partId: 'legs_shadow_tiptoe' })).toEqual({ width: 480, height: 720, fit: 'inside' })
    expect(limbNormalizationSpec({ rigId: 'blob', slotId: 'arms', partId: 'arms_paddle' })).toEqual({ width: 520, height: 900, fit: 'fill' })
    expect(connectorProfileSize({ rigId: 'biped', slotId: 'arms' })).toEqual({ width: 230, depth: 130 })
    expect(connectorProfileSize({ rigId: 'biped', slotId: 'legs' })).toEqual({ width: 240, depth: 140 })
    expect(connectorMaskFractions({ rigId: 'biped', slotId: 'arms' })).toEqual({ tangent: 0.4, normal: 0.43 })
    expect(connectorMaskFractions({ rigId: 'biped', slotId: 'legs' })).toEqual({ tangent: 0.38, normal: 0.48 })
  })

  it('records the evidence-derived biped tall-leg scale as a manifest transform', () => {
    expect(limbRenderTransform({ rigId: 'biped', partId: 'legs_stub_feet' })).toEqual({ scale: 0.89, mirrorX: false })
    expect(limbRenderTransform({ rigId: 'biped', partId: 'legs_shadow_tiptoe' })).toEqual({ scale: 0.89, mirrorX: false })
    expect(limbRenderTransform({ rigId: 'biped', partId: 'legs_webbed' })).toBeUndefined()
  })

  it('uses one bounded exact-rig transform per blob identity across both bodies', () => {
    expect(limbRenderTransform({ rigId: 'blob', partId: 'arms_paddle' })).toBeUndefined()
    expect(limbRenderTransform({ rigId: 'blob', partId: 'arms_long_noodle' })).toBeUndefined()
    expect(limbRenderTransform({ rigId: 'blob', partId: 'legs_mushroom' })).toEqual({ scale: 1.15, mirrorX: false })
  })

  it('deterministically shrinks only distal bounds while preserving every root-envelope byte', () => {
    const width = 300; const height = 200; const anchor = { x: 220, y: 80 }
    const rgba = Buffer.alloc(width * height * 4)
    for (let y = 50; y <= 110; y += 1) for (let x = 20; x <= 270; x += 1) {
      const pixel = (y * width + x) * 4
      rgba[pixel] = x % 256; rgba[pixel + 1] = y; rgba[pixel + 2] = 91; rgba[pixel + 3] = 255
    }
    const input = { rgba, width, height, anchor, side: 'left' as const, connectorWidth: 100, connectorDepth: 60, distalRatio: 0.5 }
    const first = rootPreservingDistalWarp(input)
    const second = rootPreservingDistalWarp(input)
    expect(first).toEqual(second)
    for (let y = 50; y <= 110; y += 1) for (let x = 170; x <= 270; x += 1) {
      const pixel = (y * width + x) * 4
      expect(first.subarray(pixel, pixel + 4)).toEqual(rgba.subarray(pixel, pixel + 4))
    }
    const alphaXs: number[] = []
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) if (first[(y * width + x) * 4 + 3]! > 0) alphaXs.push(x)
    expect(Math.min(...alphaXs)).toBe(95)
    expect(Math.max(...alphaXs)).toBe(270)
  })

  it('derives staging capacity from the authored node and anchor without changing final relative geometry', () => {
    const placement = derivePairedNodeOrigin({
      preferredOrigin: { x: 1368, y: 480 },
      anchor: { x: 50, y: 502 },
      nodeSize: { width: 298, height: 900 },
      cell: { left: 1024, top: 0, width: 1024, height: 2048 },
    })

    expect(placement).toEqual({ origin: { x: 1368, y: 502 }, left: 1318, top: 0 })
    expect(placement.origin.x - placement.left).toBe(50)
    expect(placement.origin.y - placement.top).toBe(502)
  })

  it('keeps two authored components, leaves the torso channel empty, and covers both proximal anchors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-limb-prep-'))
    try {
      const candidate = join(root, 'candidate.png')
      const extracted = join(root, 'extracted.png')
      const checker = await sharp({ create: { width: 512, height: 512, channels: 3, background: '#eeeeee' } })
        .composite([
          { input: Buffer.from(`<svg width="150" height="300"><rect x="10" y="10" width="140" height="290" rx="65" fill="#a965df"/></svg>`), left: 55, top: 90 },
          { input: Buffer.from(`<svg width="150" height="300"><rect x="0" y="10" width="140" height="290" rx="65" fill="#59a8dd"/></svg>`), left: 307, top: 90 },
        ]).png().toBuffer()
      await writeFile(candidate, checker)

      const audit = await extractPairedLimbCandidate(candidate, extracted)
      const normalized = await normalizePairedLimb({ extractedPath: extracted, rigId: 'blob', slotId: 'arms' })

      expect(audit.componentCount).toBe(2)
      expect(normalized.nodes).toHaveLength(2)
      expect(normalized.anchorCoverage.every(value => value >= 0.9)).toBe(true)
      const master = await sharp(normalized.master).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      let centerAlpha = 0
      for (let y = 650; y < 1500; y += 1) for (let x = 900; x < 1148; x += 1) {
        centerAlpha += master.data[(y * master.info.width + x) * 4 + 3]!
      }
      expect(centerAlpha).toBe(0)
      expect(await readFile(extracted)).toEqual(expect.any(Buffer))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('anchors arms to the inward solid proximal root even when that root is below an upper paw mass', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-limb-low-root-'))
    try {
      const extracted = join(root, 'extracted.png')
      await sharp(Buffer.from(`<svg width="640" height="520" xmlns="http://www.w3.org/2000/svg">
        <path d="M40 30h120v230H95l45 55h100v205H140V365H90L40 260z" fill="#2456d8"/>
        <rect x="140" y="315" width="100" height="205" fill="#e34b3f"/>
        <path d="M600 30H480v230h65l-45 55H400v205h100V365h50l50-105z" fill="#2456d8"/>
        <rect x="400" y="315" width="100" height="205" fill="#e34b3f"/>
      </svg>`)).png().toFile(extracted)

      const normalized = await normalizePairedLimb({ extractedPath: extracted, rigId: 'blob', slotId: 'arms', partId: 'arms_short_plush' })
      for (const [index, origin] of normalized.origins.entries()) {
        const decoded = await sharp(normalized.nodes[index]!).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
        const pixel = (origin.y * decoded.info.width + origin.x) * 4
        expect(decoded.data[pixel]!).toBeGreaterThan(decoded.data[pixel + 2]!)
      }
      expect(normalized.anchorCoverage.every(value => value >= 0.9)).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
