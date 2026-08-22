import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
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
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = []
  const resolvedPath = resolve(assetRoot, assetPath)
  if (!pathWithinRoot(assetRoot, resolvedPath)) {
    return [error('ASSET_PATH_OUTSIDE_ROOT', path, `Asset path escapes the asset root: ${assetPath}`)]
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
  }
  if (metadata.width !== metadata.height || (metadata.width !== 1024 && metadata.width !== 2048)) {
    diagnostics.push(error('ASSET_DIMENSION_INVALID', path, `Asset must be square 1024 or 2048 pixels: ${assetPath}`))
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

export async function validateCatalogFiles(catalog: Catalog, assetRoot: string): Promise<Diagnostic[]> {
  const lexicalRoot = resolve(assetRoot)
  const root = await realpath(lexicalRoot).catch(() => lexicalRoot)
  const checks = catalog.parts.flatMap((part, index) => [
    { assetPath: part.assetPath, expectedHash: part.assetSha256, path: ['parts', String(index), 'assetPath'] },
    ...(part.pngPath === undefined ? [] : [{ assetPath: part.pngPath, expectedHash: part.pngSha256, path: ['parts', String(index), 'pngPath'] }]),
    ...(part.maskPaths.primary === undefined ? [] : [{ assetPath: part.maskPaths.primary, expectedHash: part.maskSha256?.primary, path: ['parts', String(index), 'maskPaths', 'primary'] }]),
    ...(part.maskPaths.secondary === undefined ? [] : [{ assetPath: part.maskPaths.secondary, expectedHash: part.maskSha256?.secondary, path: ['parts', String(index), 'maskPaths', 'secondary'] }]),
  ])
  const results = await Promise.all(checks.map(check => validateAssetFile(root, check.assetPath, check.expectedHash, check.path)))
  return results.flat()
}
