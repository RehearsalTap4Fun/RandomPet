import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { mkdir, readdir, readFile } from 'node:fs/promises'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { productionPaths, type ProductionPaths } from './production-paths.js'

export interface RuntimeAssetBuildInput {
  sourcePath: string
  runtimePath: string
  sourceId: string
}

export interface RuntimeAssetHashes {
  sourceSha256: string
  runtimeSha256: string
}

export function runtimeAssetBuildPaths(version: string): ProductionPaths {
  return productionPaths(version)
}

async function collectPngFiles(root: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(join(root, prefix), { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const path = prefix === '' ? entry.name : join(prefix, entry.name)
    if (entry.isDirectory()) files.push(...await collectPngFiles(root, path))
    else if (entry.isFile() && extname(entry.name).toLowerCase() === '.png') files.push(path)
  }
  return files
}

async function sha256File(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

export async function buildRuntimeAsset(
  input: RuntimeAssetBuildInput,
): Promise<RuntimeAssetHashes> {
  const source = await readFile(input.sourcePath)
  await mkdir(dirname(input.runtimePath), { recursive: true })
  await sharp(source)
    .resize(1024, 1024, { fit: 'contain' })
    .webp({ lossless: true })
    .toFile(input.runtimePath)

  return {
    sourceSha256: createHash('sha256').update(source).digest('hex'),
    runtimeSha256: await sha256File(input.runtimePath),
  }
}

export async function buildVersionedRuntimeAssets(
  version: string,
  options: { repositoryRoot?: string } = {},
): Promise<{ paths: ProductionPaths, built: number }> {
  const paths = runtimeAssetBuildPaths(version)
  const repositoryRoot = options.repositoryRoot ?? process.cwd()
  const sourceRoot = resolve(repositoryRoot, paths.sourceRoot)
  const assetRoot = resolve(repositoryRoot, paths.assetDirectory)
  const sourceGroups = ['parts', 'rigs']
  const inputs = (await Promise.all(sourceGroups.map(async group => {
    try {
      return await collectPngFiles(sourceRoot, group)
    } catch (caught) {
      if ((caught as NodeJS.ErrnoException).code === 'ENOENT') return [] as string[]
      throw caught
    }
  }))).flat()
  if (inputs.length === 0) throw new Error(`No runtime PNG inputs found below ${paths.sourceRoot}/parts or ${paths.sourceRoot}/rigs.`)

  await Promise.all(inputs.map(async input => {
    const sourcePath = resolve(sourceRoot, input)
    const outputRelative = input.replace(/\.png$/iu, '.webp')
    const runtimePath = resolve(assetRoot, outputRelative)
    const sourceRelative = relative(sourceRoot, sourcePath)
    const runtimeRelative = relative(assetRoot, runtimePath)
    if (sourceRelative.startsWith('..') || runtimeRelative.startsWith('..')) throw new Error(`Runtime asset path escaped version root: ${input}`)
    await buildRuntimeAsset({ sourcePath, runtimePath, sourceId: outputRelative.replace(/\.webp$/iu, '') })
  }))
  return { paths, built: inputs.length }
}

function isDirectExecution(): boolean {
  const invoked = process.argv[1]
  if (invoked === undefined) return false
  try {
    return realpathSync(resolve(invoked)) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isDirectExecution()) {
  const versionFlag = process.argv.indexOf('--version')
  const version = versionFlag === -1 ? undefined : process.argv[versionFlag + 1]
  if (versionFlag === -1 || version === undefined || version.startsWith('--') || process.argv.length !== 4) {
    throw new Error('Usage: tsx scripts/build-runtime-assets.ts --version <release-version>')
  }
  const result = await buildVersionedRuntimeAssets(version)
  console.log(JSON.stringify({
    sourceRoot: result.paths.sourceRoot,
    assetDirectory: result.paths.assetDirectory,
    built: result.built,
  }))
}
