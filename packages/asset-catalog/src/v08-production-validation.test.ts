import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { validateV08ProductionTrait } from './v08-production-validation.js'

async function writeAlpha(path: string, points: Array<[number, number]>): Promise<void> {
  const pixels = Buffer.alloc(2048 * 2048 * 4)
  for (const [x, y] of points) {
    const offset = (y * 2048 + x) * 4
    pixels[offset] = 255
    pixels[offset + 1] = 255
    pixels[offset + 2] = 255
    pixels[offset + 3] = 255
  }
  await sharp(pixels, { raw: { width: 2048, height: 2048, channels: 4 } }).png().toFile(path)
}

describe('v0.8 production release validation', () => {
  it('rejects a packaged trait that leaks outside its immutable owner mask', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-v08-production-'))
    const traitPath = join(root, 'trait.png')
    const maskPath = join(root, 'mask.png')
    await writeAlpha(traitPath, [[100, 100], [1800, 1800]])
    await writeAlpha(maskPath, [[100, 100]])

    const diagnostics = await validateV08ProductionTrait(traitPath, maskPath, false)

    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'V08_OWNER_MASK_LEAK' }))
  })
})
