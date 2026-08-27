import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

const MANIFEST_PATH = 'asset-source/v0.3.0/interface-manifest.json'
export const TASK8_PRODUCTION_PATH = 'asset-source/v0.3.0/generation/task8-limb-production.json'
const THRESHOLD_AMENDMENT_PATH = 'packages/asset-catalog/review/v0.3.0/visible-limb-threshold-amendment.json'

function portable(path: string): string { return path.replaceAll('\\', '/') }

async function ordinaryRepositoryFile(repositoryRoot: string, path: string): Promise<string> {
  const lexicalRoot = resolve(repositoryRoot)
  const canonicalRoot = await realpath(lexicalRoot)
  const target = resolve(canonicalRoot, path)
  const remainder = relative(canonicalRoot, target)
  if (remainder.startsWith('..') || isAbsolute(remainder)) throw new Error(`TASK8_SOURCE_PATH_INVALID:${path}`)
  const canonicalTarget = await realpath(target)
  const canonicalRemainder = relative(canonicalRoot, canonicalTarget)
  const metadata = await stat(canonicalTarget)
  if (canonicalRemainder.startsWith('..') || isAbsolute(canonicalRemainder) || !metadata.isFile() || metadata.nlink !== 1) {
    throw new Error(`TASK8_SOURCE_PATH_INVALID:${path}`)
  }
  return portable(relative(canonicalRoot, canonicalTarget))
}

/**
 * Returns the minimal committed authoring dependency closure for Task 8.
 * Runtime assets and review artifacts are deliberately excluded because they
 * are already tracked by the production catalog; rejected candidates remain
 * included because the production record makes them part of the provenance.
 */
export async function collectTask8DependencyPaths(repositoryRoot: string): Promise<string[]> {
  const root = resolve(repositoryRoot)
  const manifest = JSON.parse(await readFile(resolve(root, MANIFEST_PATH), 'utf8')) as {
    assets: Array<{ id: string; slotId: string; variants: Array<{ rigId: string; sourcePngPath: string; promptEvidence: { promptPath: string }; renderNodes: Array<{ sourcePngPath: string }> }> }>
  }
  const production = JSON.parse(await readFile(resolve(root, TASK8_PRODUCTION_PATH), 'utf8')) as {
    assets: Record<string, { candidatePaths: string[] }>
  }
  const selectedKeys = new Set(Object.keys(production.assets))
  if (selectedKeys.size !== 17) throw new Error(`TASK8_SOURCE_SET_INVALID:expected 17 exact-rig assets, received ${selectedKeys.size}`)
  const paths = new Set<string>([MANIFEST_PATH, TASK8_PRODUCTION_PATH])
  for (const asset of manifest.assets) for (const variant of asset.variants) {
    const key = `${asset.id}:${variant.rigId}`
    if (!selectedKeys.has(key)) continue
    paths.add(variant.sourcePngPath)
    for (const node of variant.renderNodes) paths.add(node.sourcePngPath)
    paths.add(variant.promptEvidence.promptPath)
    const maskRoot = resolve(root, `asset-source/v0.3.0/masks/${variant.rigId}/${asset.id}`)
    for (const file of await readdir(maskRoot)) paths.add(portable(relative(root, resolve(maskRoot, file))))
    for (const candidate of production.assets[key]!.candidatePaths) paths.add(candidate)
  }
  const threshold = JSON.parse(await readFile(resolve(root, THRESHOLD_AMENDMENT_PATH), 'utf8')) as { jointFeasibility?: { path?: string } }
  if (typeof threshold.jointFeasibility?.path !== 'string') throw new Error('TASK8_SOURCE_SET_INVALID:missing joint feasibility evidence')
  paths.add(threshold.jointFeasibility.path)
  const checked = await Promise.all([...paths].map(path => ordinaryRepositoryFile(root, path)))
  return [...new Set(checked)].sort()
}
