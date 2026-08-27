import { lstat, readdir, realpath, stat, unlink } from 'node:fs/promises'
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path'

function assertContained(root: string, target: string): void {
  const remainder = relative(root, target)
  if (remainder.startsWith('..') || isAbsolute(remainder)) {
    throw new Error(`Resolved path escapes output root: ${target}`)
  }
}

function isMissingPath(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

export function resolveOutputPath(root: string, ...segments: string[]): string {
  const resolvedRoot = resolve(root)
  const target = resolve(resolvedRoot, ...segments)
  assertContained(resolvedRoot, target)
  return target
}

export async function resolveExistingContainedPath(root: string, ...segments: string[]): Promise<string> {
  const canonicalRoot = await realpath(resolve(root))
  const lexicalTarget = resolveOutputPath(canonicalRoot, ...segments)
  const [link, canonicalTarget] = await Promise.all([
    lstat(lexicalTarget),
    realpath(lexicalTarget),
  ])
  assertContained(canonicalRoot, canonicalTarget)
  const metadata = await stat(canonicalTarget)
  if (link.isSymbolicLink() || !metadata.isFile() || metadata.nlink < 1) {
    throw new Error(`Existing input must be a direct linked regular file inside output root: ${lexicalTarget}`)
  }
  return canonicalTarget
}

export async function pruneStaleFiles(input: {
  root: string
  directory: string
  expected: ReadonlySet<string>
  extensions: ReadonlySet<string>
}): Promise<string[]> {
  const directoryPath = resolveOutputPath(input.root, input.directory)
  let directoryStats
  try {
    directoryStats = await lstat(directoryPath)
  } catch (error) {
    if (isMissingPath(error)) return []
    throw error
  }
  if (directoryStats.isSymbolicLink()) {
    throw new Error(`Refusing to prune symbolic link or junction output directory: ${directoryPath}`)
  }
  const [canonicalRoot, canonicalDirectory] = await Promise.all([
    realpath(resolve(input.root)),
    realpath(directoryPath),
  ])
  assertContained(canonicalRoot, canonicalDirectory)
  const entries = await readdir(canonicalDirectory, { withFileTypes: true })
  const removed: string[] = []
  for (const entry of entries) {
    if (!entry.isFile() && !entry.isSymbolicLink()) continue
    const relativePath = `${input.directory.replaceAll('\\', '/').replace(/\/$/, '')}/${entry.name}`
    if (!input.extensions.has(extname(entry.name).toLowerCase()) || input.expected.has(relativePath)) continue
    const target = resolveOutputPath(input.root, input.directory, entry.name)
    const targetStats = await lstat(target)
    if (targetStats.isSymbolicLink()) {
      throw new Error(`Refusing to prune symbolic link: ${target}`)
    }
    const canonicalParent = await realpath(dirname(target))
    assertContained(canonicalRoot, canonicalParent)
    if (canonicalParent !== canonicalDirectory) {
      throw new Error(`Output directory changed during pruning: ${dirname(target)}`)
    }
    await unlink(target)
    removed.push(relativePath)
  }
  return removed.sort()
}
