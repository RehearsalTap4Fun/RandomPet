import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

export interface GoldenPaths {
  directory: string
  hash: string
  review: string
}

interface ReplaceGoldenPairOptions {
  hashPath: string
  reviewPath: string
  hash: string
  writeReview(temporaryPath: string): Promise<void>
}

let temporarySequence = 0

export function assertGoldenUpdateProject(updateRequested: boolean, projectName: string): void {
  if (updateRequested && projectName !== 'chromium') {
    throw new Error(
      `Golden updates require the chromium project; received ${projectName}.`,
    )
  }
}

export function isGoldenUpdateRequested(
  environment: Readonly<Record<string, string | undefined>>,
): boolean {
  return environment.UPDATE_GOLDENS === '1'
    || environment.npm_lifecycle_event === 'test:render-golden:update'
}

export function resolveGoldenPaths(moduleUrl: string): GoldenPaths {
  const directory = fileURLToPath(new URL('./golden/', moduleUrl))
  return {
    directory,
    hash: path.join(directory, 'synthetic-1024.rgba.sha256'),
    review: path.join(directory, 'synthetic-1024.review.png'),
  }
}

export async function replaceGoldenPair(options: ReplaceGoldenPairOptions): Promise<void> {
  const sequence = temporarySequence += 1
  const token = `${process.pid}-${sequence}`
  const hashTemporaryPath = path.join(
    path.dirname(options.hashPath),
    `.${path.basename(options.hashPath)}.${token}.tmp`,
  )
  const reviewTemporaryPath = path.join(
    path.dirname(options.reviewPath),
    `.${path.basename(options.reviewPath)}.${token}.tmp.png`,
  )

  await Promise.all([
    mkdir(path.dirname(options.hashPath), { recursive: true }),
    mkdir(path.dirname(options.reviewPath), { recursive: true }),
  ])
  try {
    await writeFile(hashTemporaryPath, `${options.hash}\n`)
    await options.writeReview(reviewTemporaryPath)
    await Promise.all([
      rename(hashTemporaryPath, options.hashPath),
      rename(reviewTemporaryPath, options.reviewPath),
    ])
  } finally {
    await Promise.all([
      rm(hashTemporaryPath, { force: true }),
      rm(reviewTemporaryPath, { force: true }),
    ])
  }
}
