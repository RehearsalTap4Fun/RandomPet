import { createHash } from 'node:crypto'
import { lstat, readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, extname } from 'node:path'
import sharp, { type Metadata } from 'sharp'
import type { Catalog, Diagnostic } from '@qmonster/generator-core'

function error(code: string, path: string[], message: string): Diagnostic {
  return { severity: 'error', code, path, message }
}

function pathWithinRoot(root: string, candidate: string): boolean {
  const remainder = relative(root, candidate)
  return remainder === '' || (!remainder.startsWith('..') && !isAbsolute(remainder))
}

export async function validateAssetFile(
  assetRoot: string,
  assetPath: string,
  expectedHash: string | undefined,
  path: string[],
  options: { dimensions?: 'canonical' | 'trimmed-node' | 'transition-bridge' } = {},
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = []
  const resolvedPath = resolve(assetRoot, assetPath)
  if (!pathWithinRoot(assetRoot, resolvedPath)) {
    return [error('ASSET_PATH_OUTSIDE_ROOT', path, `Asset path escapes the asset root: ${assetPath}`)]
  }
  if (!/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.(?:png|webp)$/u.test(assetPath)) {
    return [error('ASSET_PATH_INVALID', path, `Asset path must use canonical portable segments without traversal, queries, or alternate separators: ${assetPath}`)]
  }
  const extension = extname(resolvedPath).toLowerCase()
  if (extension !== '.png' && extension !== '.webp') {
    return [error('ASSET_EXTENSION_INVALID', path, `Asset must be a PNG or WebP: ${assetPath}`)]
  }

  let canonicalPath: string
  try {
    canonicalPath = await realpath(resolvedPath)
  } catch {
    return [error('ASSET_FILE_MISSING', path, `Asset file does not exist: ${assetPath}`)]
  }
  if (!pathWithinRoot(assetRoot, canonicalPath)) {
    return [error('ASSET_PATH_OUTSIDE_ROOT', path, `Asset path escapes the asset root: ${assetPath}`)]
  }
  try {
    const [link, metadata] = await Promise.all([lstat(resolvedPath), stat(canonicalPath)])
    if (link.isSymbolicLink() || !metadata.isFile() || metadata.nlink !== 1) {
      return [error('ASSET_FILE_LINK_INVALID', path, `Asset must be a direct single-link regular file: ${assetPath}`)]
    }
  } catch {
    return [error('ASSET_FILE_MISSING', path, `Asset file does not exist: ${assetPath}`)]
  }

  let source: Buffer
  try {
    source = await readFile(canonicalPath)
  } catch {
    return [error('ASSET_FILE_MISSING', path, `Asset file does not exist: ${assetPath}`)]
  }

  let metadata: Metadata
  try {
    metadata = await sharp(source).metadata()
  } catch {
    return [error('ASSET_IMAGE_INVALID', path, `Asset cannot be decoded as an image: ${assetPath}`)]
  }
  if (metadata.format !== 'png' && metadata.format !== 'webp') {
    diagnostics.push(error('ASSET_FORMAT_INVALID', path, `Decoded asset format must be PNG or WebP: ${assetPath}`))
  } else if (`.${metadata.format}` !== extension) {
    diagnostics.push(error('ASSET_FORMAT_MISMATCH', path, `Decoded ${metadata.format.toUpperCase()} payload does not match declared ${extension} path: ${assetPath}`))
  }
  const dimensionsValid = options.dimensions === 'trimmed-node'
    ? metadata.width !== undefined && metadata.height !== undefined && metadata.width > 0 && metadata.height > 0 && metadata.width <= 2048 && metadata.height <= 2048
    : options.dimensions === 'transition-bridge'
      ? metadata.width === 512 && metadata.height === 256
      : metadata.width === metadata.height && (metadata.width === 1024 || metadata.width === 2048)
  if (!dimensionsValid) {
    const requirement = options.dimensions === 'trimmed-node'
      ? 'Composition node asset must have positive dimensions no larger than 2048 pixels per side'
      : options.dimensions === 'transition-bridge'
        ? 'Transition bridge asset must be exactly 512 by 256 pixels'
      : 'Asset must be square 1024 or 2048 pixels'
    diagnostics.push(error('ASSET_DIMENSION_INVALID', path, `${requirement}: ${assetPath}`))
  }
  if (!metadata.hasAlpha) {
    diagnostics.push(error('ASSET_ALPHA_MISSING', path, `Asset must include an alpha channel: ${assetPath}`))
  }
  if (expectedHash !== undefined) {
    const actualHash = createHash('sha256').update(source).digest('hex')
    if (actualHash !== expectedHash.toLowerCase()) {
      diagnostics.push(error('ASSET_HASH_MISMATCH', path, `Asset SHA-256 does not match catalog metadata: ${assetPath}`))
    }
  }
  return diagnostics
}

export function assetPathBelowVersionRoot(assetPath: string, version: string): string {
  const prefix = `assets/v${version}/`
  return assetPath.startsWith(prefix) ? assetPath.slice(prefix.length) : assetPath
}

export async function validateCatalogFiles(catalog: Catalog, assetRoot: string): Promise<Diagnostic[]> {
  const lexicalRoot = resolve(assetRoot)
  const root = await realpath(lexicalRoot).catch(() => lexicalRoot)
  const checks = catalog.parts.flatMap((part, index) => [
    ...(part.composition?.isNone === true && part.assetPath === '' ? [] : [
      { assetPath: part.assetPath, expectedHash: part.assetSha256, path: ['parts', String(index), 'assetPath'] },
    ]),
    ...(part.pngPath === undefined ? [] : [{ assetPath: part.pngPath, expectedHash: part.pngSha256, path: ['parts', String(index), 'pngPath'] }]),
    ...(part.maskPaths.primary === undefined ? [] : [{ assetPath: part.maskPaths.primary, expectedHash: part.maskSha256?.primary, path: ['parts', String(index), 'maskPaths', 'primary'] }]),
    ...(part.maskPaths.secondary === undefined ? [] : [{ assetPath: part.maskPaths.secondary, expectedHash: part.maskSha256?.secondary, path: ['parts', String(index), 'maskPaths', 'secondary'] }]),
    ...Object.entries(part.rigMaskPaths ?? {}).flatMap(([rigId, masks]) => (
      masks === undefined ? [] : (['primary', 'secondary', 'accent'] as const).map(maskName => ({
        assetPath: masks[maskName],
        expectedHash: part.rigMaskSha256?.[rigId as keyof typeof part.rigMaskSha256]?.[maskName],
        path: ['parts', String(index), 'rigMaskPaths', rigId, maskName],
      }))
    )),
  ])
  const results = await Promise.all(checks.map(check => validateAssetFile(
    root,
    assetPathBelowVersionRoot(check.assetPath, catalog.version),
    check.expectedHash,
    check.path,
  )))
  return results.flat()
}
