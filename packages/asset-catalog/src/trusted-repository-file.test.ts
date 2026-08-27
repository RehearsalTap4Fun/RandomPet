import { createHash } from 'node:crypto'
import { link, lstat, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { readTrustedRepositoryFile } from './trusted-repository-file.js'

describe('readTrustedRepositoryFile', () => {
  it('reads a contained direct single-link regular file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-trusted-file-'))
    try {
      const bytes = Buffer.from('trusted bytes')
      await writeFile(join(root, 'input.json'), bytes)

      await expect(readTrustedRepositoryFile(root, 'input.json')).resolves.toMatchObject({
        bytes,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects an external hardlink before any content read', async ({ skip }) => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-trusted-hardlink-root-'))
    const outside = join(dirname(root), `${basename(root)}-outside.json`)
    await writeFile(outside, 'external untrusted content')
    const lexical = join(root, 'linked.json')
    try {
      try {
        await link(outside, lexical)
      } catch (error) {
        if (['EPERM', 'EACCES', 'EXDEV'].includes((error as NodeJS.ErrnoException).code ?? '')) {
          skip('hardlinks unavailable')
        }
        throw error
      }
      const read = vi.fn(readFile)
      await expect(readTrustedRepositoryFile(root, 'linked.json', {
        lstat, stat, realpath, readFile: read,
      })).rejects.toThrow('single-link regular file')
      expect(read).not.toHaveBeenCalled()
    } finally {
      await Promise.all([
        rm(root, { recursive: true, force: true }),
        rm(outside, { force: true }),
      ])
    }
  })

  it('rejects lexical traversal before reading', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-trusted-traversal-root-'))
    try {
      await expect(readTrustedRepositoryFile(root, '../outside.json')).rejects.toThrow('portable lexical leaf')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects symlink leaves before reading', async ({ skip }) => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-trusted-symlink-root-'))
    const outside = join(dirname(root), `${basename(root)}-outside.json`)
    await writeFile(outside, 'outside')
    try {
      try {
        await symlink(outside, join(root, 'linked.json'), 'file')
      } catch (error) {
        if (['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) {
          skip('symlinks unavailable')
        }
        throw error
      }
      const read = vi.fn(readFile)
      await expect(readTrustedRepositoryFile(root, 'linked.json', {
        lstat, stat, realpath, readFile: read,
      })).rejects.toThrow('symbolic link')
      expect(read).not.toHaveBeenCalled()
    } finally {
      await Promise.all([
        rm(root, { recursive: true, force: true }),
        rm(outside, { force: true }),
      ])
    }
  })
})
