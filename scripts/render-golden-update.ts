import { access, copyFile, mkdir, rename, rm, writeFile } from 'node:fs/promises'
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
  fileOperations?: GoldenFileOperations
  writeReview(temporaryPath: string): Promise<void>
}

export interface GoldenFileOperations {
  makeDirectory(directory: string): Promise<void>
  writeText(filePath: string, contents: string): Promise<void>
  copy(source: string, destination: string): Promise<void>
  move(source: string, destination: string): Promise<void>
  remove(filePath: string): Promise<void>
  exists(filePath: string): Promise<boolean>
}

const nodeFileOperations: GoldenFileOperations = {
  async makeDirectory(directory) {
    await mkdir(directory, { recursive: true })
  },
  async writeText(filePath, contents) {
    await writeFile(filePath, contents)
  },
  async copy(source, destination) {
    await copyFile(source, destination)
  },
  async move(source, destination) {
    await rename(source, destination)
  },
  async remove(filePath) {
    await rm(filePath, { force: true })
  },
  async exists(filePath) {
    try {
      await access(filePath)
      return true
    } catch (error) {
      if (
        typeof error === 'object'
        && error !== null
        && 'code' in error
        && error.code === 'ENOENT'
      ) return false
      throw error
    }
  },
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

async function removeArtifacts(
  filePaths: readonly string[],
  operations: GoldenFileOperations,
): Promise<void> {
  const failures: unknown[] = []
  for (const filePath of filePaths) {
    try {
      await operations.remove(filePath)
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) throw new AggregateError(failures, 'Failed to clean golden artifacts.')
}

/**
 * Replaces the reviewed hash/image as one recoverable pair. Existing destinations
 * are backed up before either replacement. On failure, pre-existing files are
 * restored and destinations that were initially missing are removed, so first-time
 * generation returns to a fully missing pair rather than leaving one official file.
 */
export async function replaceGoldenPair(options: ReplaceGoldenPairOptions): Promise<void> {
  const operations = options.fileOperations ?? nodeFileOperations
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
  const hashBackupPath = path.join(
    path.dirname(options.hashPath),
    `.${path.basename(options.hashPath)}.${token}.backup`,
  )
  const reviewBackupPath = path.join(
    path.dirname(options.reviewPath),
    `.${path.basename(options.reviewPath)}.${token}.backup`,
  )
  const temporaryPaths = [hashTemporaryPath, reviewTemporaryPath] as const
  const backupPaths = [hashBackupPath, reviewBackupPath] as const
  let originalsExist: [boolean, boolean] = [false, false]
  let backupsReady = false
  let preserveBackups = false
  let failed = false
  let failure: unknown

  try {
    await operations.makeDirectory(path.dirname(options.hashPath))
    await operations.makeDirectory(path.dirname(options.reviewPath))
    await operations.writeText(hashTemporaryPath, `${options.hash}\n`)
    await options.writeReview(reviewTemporaryPath)

    originalsExist = [
      await operations.exists(options.hashPath),
      await operations.exists(options.reviewPath),
    ]
    if (originalsExist[0]) await operations.copy(options.hashPath, hashBackupPath)
    if (originalsExist[1]) await operations.copy(options.reviewPath, reviewBackupPath)
    backupsReady = true

    await operations.move(hashTemporaryPath, options.hashPath)
    await operations.move(reviewTemporaryPath, options.reviewPath)
  } catch (error) {
    failed = true
    failure = error
    if (backupsReady) {
      try {
        if (originalsExist[0]) {
          await operations.move(hashBackupPath, options.hashPath)
        } else {
          await operations.remove(options.hashPath)
        }
        if (originalsExist[1]) {
          await operations.move(reviewBackupPath, options.reviewPath)
        } else {
          await operations.remove(options.reviewPath)
        }
      } catch (rollbackError) {
        preserveBackups = true
        failure = new AggregateError(
          [error, rollbackError],
          'Golden pair replacement and rollback both failed; backups were preserved.',
          { cause: error },
        )
      }
    }
  }

  try {
    await removeArtifacts(
      preserveBackups ? temporaryPaths : [...temporaryPaths, ...backupPaths],
      operations,
    )
  } catch (cleanupError) {
    if (!failed) throw cleanupError
    throw new AggregateError(
      [failure, cleanupError],
      'Golden pair replacement failed and cleanup was incomplete.',
      { cause: failure },
    )
  }

  if (failed) throw failure
}
