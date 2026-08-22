import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import sharp from 'sharp'

export interface RuntimeAssetBuildInput {
  sourcePath: string
  runtimePath: string
  sourceId: string
}

export interface RuntimeAssetHashes {
  sourceSha256: string
  runtimeSha256: string
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
