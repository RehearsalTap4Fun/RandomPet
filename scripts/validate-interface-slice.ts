import { readFile, readdir, stat, realpath, mkdtemp, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, relative, resolve, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { parseCatalog, validateCatalogStructure, type Diagnostic } from '@qmonster/generator-core'
import { parseInterfaceSourceManifest, type InterfaceSourceManifest } from './interface-source-schema.js'
import { productionPaths } from './production-paths.js'
import { renderInterfaceGuides } from './render-interface-guides.js'
import { tmpdir } from 'node:os'

function error(code: string, path: string[], message: string): Diagnostic {
  return { severity: 'error', code, path, message }
}

async function inspectPng(path: string, mask: boolean): Promise<string | null> {
  try {
    const bytes = await readFile(path)
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'must have the native PNG signature'
    const metadata = await sharp(bytes).metadata()
    if (metadata.format !== 'png' || metadata.hasAlpha !== true) return 'must be a native PNG with an alpha channel'
    const decoded = await sharp(bytes).raw().toBuffer({ resolveWithObject: true })
    if (decoded.info.width !== 2048 || decoded.info.height !== 2048 || decoded.info.channels !== 4) return 'must be a 2048x2048 RGBA PNG'
    const alphas = new Set<number>()
    for (let index = 3; index < decoded.data.length; index += 4) alphas.add(decoded.data[index]!)
    if (mask && ([...alphas].some(alpha => alpha !== 0 && alpha !== 255) || !alphas.has(0) || !alphas.has(255))) return 'machine mask alpha must be binary and contain transparent and opaque pixels'
    if (!mask && (!alphas.has(0) || ![...alphas].some(alpha => alpha > 0))) return 'guide must contain meaningful transparent and visible pixels'
    return null
  } catch (caught) {
    return caught instanceof Error ? caught.message : String(caught)
  }
}

export async function validateInterfaceSlice(input: { manifestPath: string; guideRoot: string; repositoryRoot?: string }): Promise<{
  ok: boolean
  diagnostics: Diagnostic[]
  productionAssetsChecked: 0
}> {
  const diagnostics: Diagnostic[] = []
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(input.manifestPath, 'utf8'))
  } catch {
    return { ok: false, diagnostics: [error('INTERFACE_MANIFEST_MISSING', [input.manifestPath], 'Cannot read interface source manifest.')], productionAssetsChecked: 0 }
  }
  const parsed = parseInterfaceSourceManifest(raw)
  if (!parsed.ok) return { ok: false, diagnostics: parsed.diagnostics, productionAssetsChecked: 0 }
  const lexicalRepositoryRoot = resolve(input.repositoryRoot ?? process.cwd())
  const repositoryRoot = await realpath(lexicalRepositoryRoot).catch(() => lexicalRepositoryRoot)
  const promptClaims = new Map<string, { hashes: Set<string>; ids: Set<string> }>()
  for (const evidence of [
    ...parsed.value.assets.map(asset => asset.promptEvidence),
    ...parsed.value.bridges.map(bridge => bridge.promptEvidence),
  ]) {
    const claim = promptClaims.get(evidence.promptPath) ?? { hashes: new Set<string>(), ids: new Set<string>() }
    claim.hashes.add(evidence.promptSha256)
    claim.ids.add(evidence.promptId)
    promptClaims.set(evidence.promptPath, claim)
  }
  for (const [portablePath, claim] of promptClaims) {
    const target = resolve(repositoryRoot, portablePath)
    let canonicalTarget: string
    try {
      canonicalTarget = await realpath(target)
    } catch {
      diagnostics.push(error('INTERFACE_PROMPT_MISSING', [portablePath], 'Cannot read the declared prompt evidence file.'))
      continue
    }
    const remainder = relative(repositoryRoot, canonicalTarget)
    if (remainder.startsWith('..') || isAbsolute(remainder)) {
      diagnostics.push(error('INTERFACE_PROMPT_PATH_INVALID', [portablePath], 'Prompt evidence path escapes the repository root.'))
      continue
    }
    try {
      const bytes = await readFile(canonicalTarget)
      const canonicalBytes = Buffer.from(bytes.toString('utf8').replaceAll('\r\n', '\n'))
      const actualHash = createHash('sha256').update(canonicalBytes).digest('hex')
      if (claim.hashes.size !== 1 || !claim.hashes.has(actualHash)) {
        diagnostics.push(error('INTERFACE_PROMPT_HASH_MISMATCH', [portablePath], 'Prompt evidence SHA-256 differs from the actual committed prompt catalog bytes.'))
      }
      const promptCatalog = JSON.parse(bytes.toString('utf8')) as { prompts?: Array<{ id?: unknown }> }
      const catalogIds = new Set((promptCatalog.prompts ?? []).flatMap(prompt => typeof prompt.id === 'string' ? [prompt.id] : []))
      for (const promptId of claim.ids) {
        if (!catalogIds.has(promptId)) diagnostics.push(error('INTERFACE_PROMPT_ID_MISSING', [portablePath, promptId], `Prompt catalog does not contain declared prompt ID ${promptId}.`))
      }
    } catch {
      diagnostics.push(error('INTERFACE_PROMPT_MISSING', [portablePath], 'Cannot read the declared prompt evidence file.'))
    }
  }
  const expected = new Set<string>()
  const regeneratedRoot = await mkdtemp(join(tmpdir(), 'qmonster-interface-guides-'))
  const regenerated = await renderInterfaceGuides({
    outputRoot: regeneratedRoot,
    rigId: 'biped',
    profiles: parsed.value.assets.flatMap(asset => asset.connectors.map(profile => ({ ...profile, assetId: asset.id }))),
  })
  const regeneratedByName = new Map(regenerated.files.flatMap(file => [file.guidePath, file.maskPath].map(path => [path.split(/[\\/]/u).at(-1)!, path] as const)))
  for (const asset of parsed.value.assets) {
    for (const connector of asset.connectors) {
      const stem = `${asset.id}-${connector.id}-${connector.role}`
      for (const [suffix, mask] of [['guide', false], ['mask', true]] as const) {
        const file = `${stem}-${suffix}.png`
        expected.add(file)
        const invalid = await inspectPng(join(input.guideRoot, file), mask)
        if (invalid !== null) diagnostics.push(error('INTERFACE_GUIDE_INVALID', [file], invalid))
        try {
          const expectedBytes = await readFile(regeneratedByName.get(file)!)
          const actualBytes = await readFile(join(input.guideRoot, file))
          if (!actualBytes.equals(expectedBytes)) diagnostics.push(error('INTERFACE_GUIDE_DRIFT', [file], 'Committed guide bytes and SHA-256 differ from deterministic regeneration.'))
        } catch {
          // The format/missing diagnostic above remains the primary failure.
        }
      }
    }
  }
  let actual: string[] = []
  try {
    actual = await readdir(input.guideRoot)
  } catch {
    diagnostics.push(error('INTERFACE_GUIDE_MISSING', [input.guideRoot], 'Cannot read interface guide directory.'))
  }
  for (const file of actual.filter(file => file.endsWith('.png'))) {
    if (!expected.has(file)) diagnostics.push(error('INTERFACE_GUIDE_STALE', [file], `Guide is not declared by the interface source manifest: ${file}`))
  }
  await rm(regeneratedRoot, { recursive: true, force: true })
  return { ok: diagnostics.length === 0, diagnostics, productionAssetsChecked: 0 }
}

export async function validateInterfaceProductionReadiness(input: {
  repositoryRoot: string
  manifest: InterfaceSourceManifest
}): Promise<{ ok: boolean; diagnostics: Diagnostic[]; productionAssetsChecked: number }> {
  const diagnostics: Diagnostic[] = []
  const paths = productionPaths(input.manifest.catalogVersion)
  const lexicalRoot = resolve(input.repositoryRoot)
  const root = await realpath(lexicalRoot).catch(() => lexicalRoot)
  let productionAssetsChecked = 0
  const productionSources = [...new Set([
    ...input.manifest.assets.flatMap(asset => [asset.sourcePngPath, ...asset.renderNodes.map(node => node.sourcePngPath)]),
    ...input.manifest.bridges.map(bridge => bridge.sourcePngPath),
  ])]
  for (const [index, path] of productionSources.entries()) {
    const target = resolve(root, path)
    const remainder = relative(root, target)
    const portable = path.replaceAll('\\', '/')
    if (remainder.startsWith('..') || isAbsolute(remainder) || !portable.startsWith(`${paths.sourceRoot}/`)) {
      diagnostics.push(error('INTERFACE_PRODUCTION_SOURCE_PATH_INVALID', ['productionAssets', String(index)], `Production source must stay below ${paths.sourceRoot}: ${path}`))
      continue
    }
    try {
      const canonicalTarget = await realpath(target)
      const canonicalRemainder = relative(root, canonicalTarget)
      if (canonicalRemainder.startsWith('..') || isAbsolute(canonicalRemainder)) {
        diagnostics.push(error('INTERFACE_PRODUCTION_SOURCE_PATH_INVALID', ['productionAssets', String(index)], `Production source resolves outside ${paths.sourceRoot}: ${path}`))
        continue
      }
      const metadata = await stat(canonicalTarget)
      if (!metadata.isFile()) throw new Error('not a file')
      productionAssetsChecked += 1
    } catch {
      diagnostics.push(error('INTERFACE_PRODUCTION_ASSET_MISSING', ['productionAssets', String(index)], `Required v0.3 production source asset is missing: ${path}`))
    }
  }
  return { ok: diagnostics.length === 0, diagnostics, productionAssetsChecked }
}

async function main(): Promise<void> {
  const versionIndex = process.argv.indexOf('--version')
  const version = versionIndex === -1 ? undefined : process.argv[versionIndex + 1]
  const production = process.argv.includes('--production')
  const catalogIndex = process.argv.indexOf('--catalog-if-present')
  const catalogPath = catalogIndex === -1 ? undefined : process.argv[catalogIndex + 1]
  if (version !== '0.3.0') throw new Error('Usage: tsx scripts/validate-interface-slice.ts --version 0.3.0 [--production]')
  const paths = productionPaths(version)
  const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
  const manifestPath = join(repositoryRoot, paths.sourceRoot, 'interface-manifest.json')
  const slice = await validateInterfaceSlice({ manifestPath, guideRoot: join(repositoryRoot, paths.sourceRoot, 'guides'), repositoryRoot })
  const diagnostics = [...slice.diagnostics]
  if (catalogPath !== undefined) {
    try {
      const parsedCatalog = parseCatalog(JSON.parse(await readFile(resolve(catalogPath), 'utf8')))
      if (!parsedCatalog.ok) diagnostics.push(...parsedCatalog.diagnostics)
      else diagnostics.push(...validateCatalogStructure(parsedCatalog.value))
    } catch (caught: any) {
      if (caught?.code !== 'ENOENT') diagnostics.push(error('INTERFACE_CATALOG_INVALID', [catalogPath], 'Cannot parse the optional built v0.3 catalog.'))
    }
  }
  let productionAssetsChecked = 0
  if (diagnostics.length === 0 && production) {
    const parsed = parseInterfaceSourceManifest(JSON.parse(await readFile(manifestPath, 'utf8')))
    if (parsed.ok) {
      const readiness = await validateInterfaceProductionReadiness({ repositoryRoot, manifest: parsed.value })
      diagnostics.push(...readiness.diagnostics)
      productionAssetsChecked = readiness.productionAssetsChecked
    }
  }
  for (const diagnostic of diagnostics) console.error(`ERROR ${diagnostic.code} ${diagnostic.path.join('.')}: ${diagnostic.message}`)
  console.log(JSON.stringify({ version, sliceGuides: slice.ok, productionAssetsChecked }))
  if (diagnostics.length > 0) process.exitCode = 1
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) void main()
