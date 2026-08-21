import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertGoldenUpdateProject,
  isGoldenUpdateRequested,
  replaceGoldenPair,
  resolveGoldenPaths,
} from './render-golden-update.js'

describe('render golden update safety', () => {
  it('enables updates only for the explicit flag or fixed update script', () => {
    expect(isGoldenUpdateRequested({ UPDATE_GOLDENS: '1' })).toBe(true)
    expect(isGoldenUpdateRequested({ npm_lifecycle_event: 'test:render-golden:update' })).toBe(true)
    expect(isGoldenUpdateRequested({ npm_lifecycle_event: 'test:render-golden' })).toBe(false)
  })

  it('rejects update mode outside the Chromium project', () => {
    expect(() => assertGoldenUpdateProject(true, 'firefox')).toThrow(
      'Golden updates require the chromium project',
    )
    expect(() => assertGoldenUpdateProject(true, 'chromium')).not.toThrow()
    expect(() => assertGoldenUpdateProject(false, 'firefox')).not.toThrow()
  })

  it('resolves committed artifacts relative to the importing golden spec', () => {
    const paths = resolveGoldenPaths(new URL('../tests/render/golden.spec.ts', import.meta.url).href)

    expect(path.basename(paths.directory)).toBe('golden')
    expect(path.basename(paths.hash)).toBe('synthetic-1024.rgba.sha256')
    expect(path.basename(paths.review)).toBe('synthetic-1024.review.png')
    expect(path.resolve(paths.directory)).toBe(path.dirname(paths.hash))
  })

  it('leaves both reviewed artifacts untouched if either temporary write fails', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'qmonster-golden-'))
    const hashPath = path.join(directory, 'golden.sha256')
    const reviewPath = path.join(directory, 'review.png')
    await writeFile(hashPath, 'old-hash\n')
    await writeFile(reviewPath, 'old-review')

    await expect(replaceGoldenPair({
      hashPath,
      reviewPath,
      hash: 'new-hash',
      async writeReview() {
        throw new Error('screenshot failed')
      },
    })).rejects.toThrow('screenshot failed')

    await expect(readFile(hashPath, 'utf8')).resolves.toBe('old-hash\n')
    await expect(readFile(reviewPath, 'utf8')).resolves.toBe('old-review')
  })

  it('replaces hash and review only after both temporary outputs succeed', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'qmonster-golden-'))
    const hashPath = path.join(directory, 'golden.sha256')
    const reviewPath = path.join(directory, 'review.png')
    await writeFile(hashPath, 'old-hash\n')
    await writeFile(reviewPath, 'old-review')

    await replaceGoldenPair({
      hashPath,
      reviewPath,
      hash: 'new-hash',
      async writeReview(temporaryPath) {
        await writeFile(temporaryPath, 'new-review')
      },
    })

    await expect(readFile(hashPath, 'utf8')).resolves.toBe('new-hash\n')
    await expect(readFile(reviewPath, 'utf8')).resolves.toBe('new-review')
  })
})
