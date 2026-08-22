import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { pruneStaleFiles, resolveOutputPath } from './safe-output.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('safe production outputs', () => {
  it('rejects any output path that escapes its resolved known root', () => {
    expect(() => resolveOutputPath('C:/repo/runtime', '..', 'outside.png')).toThrow(/escapes output root/)
    expect(resolveOutputPath('C:/repo/runtime', 'parts', 'inside.png').replaceAll('\\', '/')).toBe('C:/repo/runtime/parts/inside.png')
  })

  it('prunes only stale allowed files and is idempotent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-safe-output-'))
    temporaryDirectories.push(root)
    await mkdir(join(root, 'parts'))
    await writeFile(join(root, 'parts', 'kept.png'), 'keep')
    await writeFile(join(root, 'parts', 'stale.webp'), 'stale')
    await writeFile(join(root, 'parts', 'notes.txt'), 'user-owned')

    await expect(pruneStaleFiles({ root, directory: 'parts', expected: new Set(['parts/kept.png']), extensions: new Set(['.png', '.webp']) })).resolves.toEqual(['parts/stale.webp'])
    await expect(pruneStaleFiles({ root, directory: 'parts', expected: new Set(['parts/kept.png']), extensions: new Set(['.png', '.webp']) })).resolves.toEqual([])
    await expect(readFile(join(root, 'parts', 'notes.txt'), 'utf8')).resolves.toBe('user-owned')
  })
})
