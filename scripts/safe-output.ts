import { readdir, unlink } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve } from 'node:path'

export function resolveOutputPath(root: string, ...segments: string[]): string {
  const resolvedRoot = resolve(root)
  const target = resolve(resolvedRoot, ...segments)
  const remainder = relative(resolvedRoot, target)
  if (remainder.startsWith('..') || isAbsolute(remainder)) {
    throw new Error(`Resolved path escapes output root: ${target}`)
  }
  return target
}

export async function pruneStaleFiles(input: {
  root: string
  directory: string
  expected: ReadonlySet<string>
  extensions: ReadonlySet<string>
}): Promise<string[]> {
  const directoryPath = resolveOutputPath(input.root, input.directory)
  let entries
  try {
    entries = await readdir(directoryPath, { withFileTypes: true })
  } catch {
    return []
  }
  const removed: string[] = []
  for (const entry of entries) {
    if (!entry.isFile() && !entry.isSymbolicLink()) continue
    const relativePath = `${input.directory.replaceAll('\\', '/').replace(/\/$/, '')}/${entry.name}`
    if (!input.extensions.has(extname(entry.name).toLowerCase()) || input.expected.has(relativePath)) continue
    await unlink(resolveOutputPath(input.root, input.directory, entry.name))
    removed.push(relativePath)
  }
  return removed.sort()
}
