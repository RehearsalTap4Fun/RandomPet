import { describe, expect, it } from 'vitest'
import * as renderer from './index.js'
import type { MaterialOperationV1, V09SurfaceSlotId } from '@qmonster/generator-core'

const slots: V09SurfaceSlotId[] = ['bodyColor', 'surfacePattern', 'surfaceTexture', 'forepawDetail', 'hindpawDetail', 'tailSurface']
const rgba = (...pixels: number[][]) => { const bytes = new Uint8Array(2048 * 2048 * 4); pixels.forEach((pixel, i) => bytes.set(pixel, i * 4)); return bytes }
const lut = (pixel: number[]) => Array.from({ length: 256 }, () => pixel).flat()
function input() {
  return {
    neutralMaster: rgba([127, 128, 201, 73], [9, 10, 11, 255]),
    materialMap: rgba([7, 0, 0, 255], [8, 0, 0, 255]),
    materialRegistry: { fur: 7, nose: 8 },
    operations: slots.map(slotId => ({ slotId, operation: { schemaVersion: 'qmonster-material-v1', ownerMaterialId: 'fur', colorLut: lut([0, 0, 0, 0]), alphaPolicy: 'preserve-skeleton-alpha', blendMode: 'replace-color' } as MaterialOperationV1, colorMap: undefined as Uint8Array | undefined })),
  }
}

describe('v0.9 exact material arithmetic', () => {
  it('exports the isolated material entry point', () => { expect(renderer).toHaveProperty('applyV09MaterialOperations', expect.any(Function)) })
  it.each([
    ['replace-color', 255, [100, 180, 33, 73]],
    ['multiply', 255, [50, 90, 26, 73]],
    ['overlay', 255, [100, 180, 161, 73]],
    ['replace-color', 128, [113, 154, 117, 73]],
    ['multiply', 128, [88, 109, 113, 73]],
    ['overlay', 128, [113, 154, 181, 73]],
  ] as const)('rounds %s with alpha %s in sRGB bytes', (blendMode, alpha, expected) => {
    const data = input(); Object.assign(data.operations[0]!.operation, { blendMode, colorLut: lut([100, 180, 33, alpha]) })
    const output = renderer.applyV09MaterialOperations(data)
    expect([...output.slice(0, 4)]).toEqual(expected)
    expect([...output.slice(4, 8)]).toEqual([9, 10, 11, 255])
    expect([...data.neutralMaster.slice(0, 4)]).toEqual([127, 128, 201, 73])
  })
  it('indexes LUT by current R, then by colorMap R and multiplies source alphas', () => {
    const data = input(); data.operations[0]!.operation.colorLut![127 * 4] = 42; data.operations[0]!.operation.colorLut![127 * 4 + 3] = 255
    const second = data.operations[1]!; second.colorMap = rgba([17, 99, 99, 128]); second.operation.colorMap = { resourceId: `sha256:${'a'.repeat(64)}` as any, sha256: 'a'.repeat(64), mediaType: 'image/png', width: 2048, height: 2048 }
    second.operation.colorLut!.splice(17 * 4, 4, 200, 100, 50, 128)
    expect([...renderer.applyV09MaterialOperations(data).slice(0, 4)]).toEqual([82, 25, 13, 73])
  })
  it('uses colorMap directly with no LUT', () => {
    const data = input(); const first = data.operations[0]!; delete first.operation.colorLut
    first.operation.colorMap = { resourceId: `sha256:${'a'.repeat(64)}` as any, sha256: 'a'.repeat(64), mediaType: 'image/png', width: 2048, height: 2048 }; first.colorMap = rgba([1, 2, 3, 255])
    expect([...renderer.applyV09MaterialOperations(data).slice(0, 4)]).toEqual([1, 2, 3, 73])
  })
  it.each(['g', 'b', 'alpha', 'hole', 'outside', 'length'])('rejects invalid material-map %s', mode => {
    const data = input()
    if (mode === 'g') data.materialMap[1] = 1
    if (mode === 'b') data.materialMap[2] = 1
    if (mode === 'alpha') data.materialMap[3] = 128
    if (mode === 'hole') data.materialMap[3] = 0
    if (mode === 'outside') data.materialMap[11] = 255
    if (mode === 'length') data.materialMap = new Uint8Array(4)
    expect(() => renderer.applyV09MaterialOperations(data)).toThrowError(expect.objectContaining({ code: 'SURFACE_OWNER_VIOLATION' }))
  })
  it.each(['missing', 'duplicate', 'range', 'fraction', 'blank', 'owner'])('rejects registry %s', mode => {
    const data: any = input()
    if (mode === 'missing') delete data.materialRegistry
    if (mode === 'duplicate') data.materialRegistry.nose = 7
    if (mode === 'range') data.materialRegistry.fur = 256
    if (mode === 'fraction') data.materialRegistry.fur = 7.1
    if (mode === 'blank') data.materialRegistry[' '] = 9
    if (mode === 'owner') data.operations[0].operation.ownerMaterialId = 'missing'
    expect(() => renderer.applyV09MaterialOperations(data)).toThrowError(expect.objectContaining({ code: 'SURFACE_OWNER_VIOLATION' }))
  })
  it.each([[], [0, 1], Array(1025).fill(0), Array(1024).fill(0.5), Array(1024).fill(256), Array(1024).fill(-1)])('rejects malformed RGBA8 LUT %#', colorLut => {
    const data = input(); data.operations[0]!.operation.colorLut = colorLut
    expect(() => renderer.applyV09MaterialOperations(data)).toThrowError(expect.objectContaining({ code: 'SURFACE_OWNER_VIOLATION' }))
  })
  it('rejects source alpha outside exact owner instead of clipping', () => {
    const data = input(); const operation = data.operations[0]!; operation.operation.colorMap = { resourceId: `sha256:${'a'.repeat(64)}` as any, sha256: 'a'.repeat(64), mediaType: 'image/png', width: 2048, height: 2048 }; operation.colorMap = rgba([1, 1, 1, 255], [1, 1, 1, 1])
    expect(() => renderer.applyV09MaterialOperations(data)).toThrowError(expect.objectContaining({ code: 'SURFACE_OWNER_VIOLATION' }))
  })
  it('preserves every alpha byte across all six sequential operations deterministically', () => {
    const data = input(); data.operations.forEach((entry, i) => { entry.operation.colorLut = lut([40 + i, 50, 60, 255]) })
    const first = renderer.applyV09MaterialOperations(data); const second = renderer.applyV09MaterialOperations(data)
    expect([...first.slice(0, 4)]).toEqual([45, 50, 60, 73])
    expect(Buffer.compare(Buffer.from(first), Buffer.from(second))).toBe(0)
    let alphaMismatch = false; for (let i = 3; i < first.length; i += 4) if (first[i] !== data.neutralMaster[i]) alphaMismatch = true
    expect(alphaMismatch).toBe(false)
  })
  it.each(['order', 'missing', 'neither', 'alpha-policy'])('rejects invalid operation %s', mode => {
    const data = input()
    if (mode === 'order') data.operations.reverse()
    if (mode === 'missing') data.operations.pop()
    if (mode === 'neither') delete data.operations[0]!.operation.colorLut
    if (mode === 'alpha-policy') (data.operations[0]!.operation as any).alphaPolicy = 'replace'
    expect(() => renderer.applyV09MaterialOperations(data)).toThrow()
  })
})
