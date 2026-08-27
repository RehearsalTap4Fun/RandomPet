import { createHash } from 'node:crypto'
import {
  lstat as nodeLstat,
  readFile as nodeReadFile,
  realpath as nodeRealpath,
  stat as nodeStat,
} from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

export interface TrustedRepositoryFileIo {
  lstat(path: string): Promise<Stats>
  stat(path: string): Promise<Stats>
  realpath(path: string): Promise<string>
  readFile(path: string): Promise<Buffer>
}

const defaultIo: TrustedRepositoryFileIo = {
  lstat: nodeLstat,
  stat: nodeStat,
  realpath: nodeRealpath,
  readFile: nodeReadFile,
}

const portableLexicalLeaf = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/u

function contained(root: string, target: string): boolean {
  const remainder = relative(root, target)
  return remainder !== '' && !remainder.startsWith('..') && !isAbsolute(remainder)
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
  const canonicalRoot = await io.realpath(resolve(repositoryRoot))
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

  const bytes = await io.readFile(canonicalPath)
  return {
    lexicalPath,
    canonicalPath,
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}
