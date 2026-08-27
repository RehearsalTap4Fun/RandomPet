import { lstat, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pruneStaleFiles, resolveExistingContainedPath, resolveOutputPath } from './safe-output.js'

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, realpath: vi.fn(actual.realpath) }
})

const temporaryDirectories: string[] = []

afterEach(async () => {
  const canonicalTemporaryRoot = await realpath(tmpdir())
  await Promise.all(temporaryDirectories.splice(0).map(async path => {
    const canonicalPath = await realpath(path)
    const remainder = relative(canonicalTemporaryRoot, canonicalPath)
    if (!remainder || remainder.startsWith('..') || isAbsolute(remainder)) {
      throw new Error(`Refusing to recursively remove non-temporary path: ${canonicalPath}`)
    }
    await rm(canonicalPath, { recursive: true, force: true })
  }))
})

function isLinkPrivilegeError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return code === 'EPERM' || code === 'EACCES'
}

describe('safe production outputs', () => {
  it('rejects any output path that escapes its resolved known root', () => {
    expect(() => resolveOutputPath('C:/repo/runtime', '..', 'outside.png')).toThrow(/escapes output root/)
    expect(resolveOutputPath('C:/repo/runtime', 'parts', 'inside.png').replaceAll('\\', '/')).toBe('C:/repo/runtime/parts/inside.png')
  })

  it('rejects an existing read target reached through a junction outside the trust root', async ({ skip }) => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-read-root-'))
    const outside = await mkdtemp(join(tmpdir(), 'qmonster-read-outside-'))
    temporaryDirectories.push(root, outside)
    await writeFile(join(outside, 'input.json'), '{}')
    try {
      await symlink(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      if (isLinkPrivilegeError(error)) skip(`directory links unavailable: ${(error as NodeJS.ErrnoException).code}`)
      throw error
    }
    await expect(resolveExistingContainedPath(root, 'linked', 'input.json'))
      .rejects.toThrow(/escapes output root/i)
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

  it('propagates ENOENT after the cleanup directory is confirmed present', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-root-'))
    temporaryDirectories.push(root)
    await mkdir(join(root, 'parts'))
    const canonicalizationError = Object.assign(new Error('directory disappeared during canonicalization'), { code: 'ENOENT' })
    vi.mocked(realpath).mockRejectedValueOnce(canonicalizationError)

    await expect(pruneStaleFiles({
      root,
      directory: 'parts',
      expected: new Set(),
      extensions: new Set(['.png']),
    })).rejects.toBe(canonicalizationError)
  })

  it('does not prune through a linked output directory', async ({ skip }) => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-root-'))
    const outside = await mkdtemp(join(tmpdir(), 'qmonster-outside-'))
    temporaryDirectories.push(root, outside)
    await writeFile(join(outside, 'keep.png'), 'outside')
    try {
      await symlink(outside, join(root, 'parts'), process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      if (isLinkPrivilegeError(error)) skip(`directory links unavailable: ${(error as NodeJS.ErrnoException).code}`)
      throw error
    }

    await expect(pruneStaleFiles({
      root,
      directory: 'parts',
      expected: new Set(),
      extensions: new Set(['.png']),
    })).rejects.toThrow(/symbolic link|junction|escapes output root/i)
    expect((await lstat(join(root, 'parts'))).isSymbolicLink()).toBe(true)
    await expect(readFile(join(outside, 'keep.png'), 'utf8')).resolves.toBe('outside')
  })

  it('rejects an ordinary cleanup directory reached through a linked ancestor', async ({ skip }) => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-root-'))
    const outside = await mkdtemp(join(tmpdir(), 'qmonster-outside-'))
    temporaryDirectories.push(root, outside)
    await mkdir(join(outside, 'parts'))
    await writeFile(join(outside, 'parts', 'keep.png'), 'outside')
    try {
      await symlink(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      if (isLinkPrivilegeError(error)) skip(`directory links unavailable: ${(error as NodeJS.ErrnoException).code}`)
      throw error
    }

    expect((await lstat(join(root, 'linked', 'parts'))).isSymbolicLink()).toBe(false)
    await expect(pruneStaleFiles({
      root,
      directory: 'linked/parts',
      expected: new Set(['linked/parts/keep.png']),
      extensions: new Set(['.png']),
    })).rejects.toThrow(/escapes output root/i)
    await expect(readFile(join(outside, 'parts', 'keep.png'), 'utf8')).resolves.toBe('outside')
  })

  it('does not prune a linked file inside an output directory', async ({ skip }) => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-root-'))
    const outside = await mkdtemp(join(tmpdir(), 'qmonster-outside-'))
    temporaryDirectories.push(root, outside)
    await mkdir(join(root, 'parts'))
    const outsideFile = join(outside, 'keep.png')
    const linkedFile = join(root, 'parts', 'stale.png')
    await writeFile(outsideFile, 'outside')
    try {
      await symlink(outsideFile, linkedFile, 'file')
    } catch (error) {
      if (isLinkPrivilegeError(error)) skip(`file links unavailable: ${(error as NodeJS.ErrnoException).code}`)
      throw error
    }

    await expect(pruneStaleFiles({
      root,
      directory: 'parts',
      expected: new Set(),
      extensions: new Set(['.png']),
    })).rejects.toThrow(/symbolic link|junction|escapes output root/i)
    expect((await lstat(linkedFile)).isSymbolicLink()).toBe(true)
    await expect(readFile(outsideFile, 'utf8')).resolves.toBe('outside')
  })
})
