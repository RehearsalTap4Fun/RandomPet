import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
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

if (process.argv[1]?.endsWith('build-runtime-assets.ts')) {
  const versionFlag = process.argv.indexOf('--version')
  const version = versionFlag === -1 ? undefined : process.argv[versionFlag + 1]
  if (versionFlag === -1 || version === undefined || version.startsWith('--') || process.argv.length !== 4) {
    throw new Error('Usage: tsx scripts/build-runtime-assets.ts --version <release-version>')
  }
  const paths = runtimeAssetBuildPaths(version)
  console.log(JSON.stringify({ sourceRoot: paths.sourceRoot, assetDirectory: paths.assetDirectory }))
}
