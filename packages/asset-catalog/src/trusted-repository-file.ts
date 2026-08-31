import { createHash } from 'node:crypto'
import {
  lstat as nodeLstat,
  open as nodeOpen,
  realpath as nodeRealpath,
  stat as nodeStat,
} from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

export interface TrustedRepositoryFileIo {
  lstat(path: string): Promise<Stats>
  stat(path: string): Promise<Stats>
  realpath(path: string): Promise<string>
  open(path: string, flags: 'r'): Promise<{
    stat(): Promise<Stats>
    readFile(): Promise<Buffer>
    close(): Promise<void>
  }>
}

const defaultIo: TrustedRepositoryFileIo = {
  lstat: nodeLstat,
  stat: nodeStat,
  realpath: nodeRealpath,
  open: nodeOpen,
}

const portableLexicalLeaf = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/u

function contained(root: string, target: string): boolean {
  const remainder = relative(root, target)
  return remainder !== '' && !remainder.startsWith('..') && !isAbsolute(remainder)
}

function sameIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

function sameStableFile(left: Stats, right: Stats): boolean {
  return sameIdentity(left, right)
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs
    && left.nlink === right.nlink
}

export function assertPortableRepositoryLeaf(path: string): void {
  if (!portableLexicalLeaf.test(path) || path.split('/').some(segment => segment === '.' || segment === '..')) {
    throw new Error(`Trusted repository path must be a portable lexical leaf: ${path}`)
  }
}

export async function readTrustedRepositoryFile(
  repositoryRoot: string,
  path: string,
  io: TrustedRepositoryFileIo = defaultIo,
): Promise<{ lexicalPath: string, canonicalPath: string, bytes: Buffer, sha256: string }> {
  assertPortableRepositoryLeaf(path)
  const resolvedRoot = resolve(repositoryRoot)
  const rootMetadata = await io.lstat(resolvedRoot)
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    throw new Error(`Trusted repository trust root must be a direct directory: ${repositoryRoot}`)
  }
  const canonicalRoot = await io.realpath(resolvedRoot)
  const lexicalPath = resolve(canonicalRoot, path)
  if (!contained(canonicalRoot, lexicalPath)) {
    throw new Error(`Trusted repository file escapes its repository root: ${path}`)
  }

  const lexicalMetadata = await io.lstat(lexicalPath)
  if (lexicalMetadata.isSymbolicLink()) {
    throw new Error(`Trusted repository file must not be a symbolic link: ${path}`)
  }
  if (!lexicalMetadata.isFile() || lexicalMetadata.nlink !== 1) {
    throw new Error(`Trusted repository file must be a direct single-link regular file: ${path}`)
  }

  const canonicalPath = await io.realpath(lexicalPath)
  if (!contained(canonicalRoot, canonicalPath)) {
    throw new Error(`Trusted repository file escapes its canonical repository root: ${path}`)
  }
  const canonicalMetadata = await io.stat(canonicalPath)
  if (!canonicalMetadata.isFile() || canonicalMetadata.nlink !== 1) {
    throw new Error(`Trusted repository file must resolve to a single-link regular file: ${path}`)
  }

  const handle = await io.open(canonicalPath, 'r')
  let bytes: Buffer
  try {
    const beforeRead = await handle.stat()
    if (!beforeRead.isFile() || beforeRead.nlink !== 1 || !sameIdentity(canonicalMetadata, beforeRead)) {
      throw new Error(`Trusted repository file identity changed before read: ${path}`)
    }
    bytes = await handle.readFile()
    const afterRead = await handle.stat()
    if (!afterRead.isFile() || afterRead.nlink !== 1 || !sameStableFile(beforeRead, afterRead)) {
      throw new Error(`Trusted repository file was not stable during read: ${path}`)
    }
    const [lexicalAfterRead, canonicalAfterRead] = await Promise.all([
      io.lstat(lexicalPath),
      io.realpath(lexicalPath),
    ])
    if (
      lexicalAfterRead.isSymbolicLink()
      || !lexicalAfterRead.isFile()
      || lexicalAfterRead.nlink !== 1
      || !contained(canonicalRoot, canonicalAfterRead)
    ) {
      throw new Error(`Trusted repository file identity changed after read: ${path}`)
    }
    const pathAfterRead = await io.stat(canonicalAfterRead)
    if (!sameStableFile(afterRead, pathAfterRead)) {
      throw new Error(`Trusted repository file identity changed after read: ${path}`)
    }
  } finally {
    await handle.close()
  }
  return {
    lexicalPath,
    canonicalPath,
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}
