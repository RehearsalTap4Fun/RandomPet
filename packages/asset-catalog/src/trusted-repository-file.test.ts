import { createHash } from 'node:crypto'
import { link, lstat, mkdir, mkdtemp, open, readFile, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
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
      const opened = vi.fn(open)
      await expect(readTrustedRepositoryFile(root, 'linked.json', {
        lstat, stat, realpath, open: opened,
      })).rejects.toThrow('single-link regular file')
      expect(opened).not.toHaveBeenCalled()
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
      const opened = vi.fn(open)
      await expect(readTrustedRepositoryFile(root, 'linked.json', {
        lstat, stat, realpath, open: opened,
      })).rejects.toThrow('symbolic link')
      expect(opened).not.toHaveBeenCalled()
    } finally {
      await Promise.all([
        rm(root, { recursive: true, force: true }),
        rm(outside, { force: true }),
      ])
    }
  })

  it('rejects a linked trust root before reading through it', async ({ skip }) => {
    const parent = await mkdtemp(join(tmpdir(), 'qmonster-trusted-linked-root-'))
    const outside = join(parent, 'outside')
    const linkedRoot = join(parent, 'linked')
    try {
      await mkdir(outside)
      await writeFile(join(outside, 'input.json'), 'outside')
      try {
        await symlink(outside, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir')
      } catch (error) {
        if (['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) {
          skip('directory links unavailable')
        }
        throw error
      }
      const opened = vi.fn(open)
      await expect(readTrustedRepositoryFile(linkedRoot, 'input.json', {
        lstat, stat, realpath, open: opened,
      })).rejects.toThrow('trust root must be a direct directory')
      expect(opened).not.toHaveBeenCalled()
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })

  it('rejects a repository leaf replaced after its trusted handle is opened', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-trusted-race-root-'))
    const input = join(root, 'input.json')
    const held = join(root, 'held.json')
    const replacement = join(root, 'replacement.json')
    await writeFile(input, 'approved')
    await writeFile(replacement, 'attacker')
    try {
      await expect(readTrustedRepositoryFile(root, 'input.json', {
        lstat, stat, realpath,
        async open(path: string) {
          const handle = await open(path, 'r')
          await rename(path, held)
          await rename(replacement, path)
          return handle
        },
      } as never)).rejects.toThrow(/changed|identity|stable/iu)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
