import { canonicalJsonSha256, decodedPngSha256 } from '../../packages/asset-catalog/src/v09-content-identity.js'
import { randomUUID } from 'node:crypto'
import type { Stats } from 'node:fs'
import { lstat, mkdir, open, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { Plugin } from 'vite'

const CONTENT_HASH = /^[a-f0-9]{64}$/u
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

export class ContentResourceError extends Error {
  public constructor(public readonly code: string, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ContentResourceError'
  }
}

function failure(code: string, message: string, cause?: unknown): never {
  throw new ContentResourceError(code, message, cause === undefined ? undefined : { cause })
}

function isContained(root: string, target: string): boolean {
  const path = relative(root, target)
  return path !== '' && !path.startsWith('..') && !isAbsolute(path)
}

async function canonicalDirectory(root: string): Promise<string> {
  const entry = await lstat(root)
  if (!entry.isDirectory() || entry.isSymbolicLink()) return failure('CONTENT_RESOURCE_OUTSIDE_ROOT', 'Content root must be a direct directory.')
  return realpath(root)
}

function sameFileState(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size
    && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs
}

type StableReadStage = 'after-precheck' | 'after-open' | 'after-read'
type StableReadHook = (stage: StableReadStage, hash: string) => void | Promise<void>
let stableReadHook: StableReadHook | undefined

export function __setV09ContentReadHookForTest(hook: StableReadHook | undefined): void {
  stableReadHook = hook
}

async function verifyContentIdentity(bytes: Buffer, hash: string): Promise<void> {
  const actual = bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
    ? await decodedPngSha256(bytes)
    : canonicalJsonSha256(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown)
  if (actual !== hash) return failure('CONTENT_RESOURCE_HASH_MISMATCH', 'Content resource body does not match its identity.')
}

export async function readVerifiedContentResource(root: string, hash: string): Promise<Buffer> {
  if (!CONTENT_HASH.test(hash)) return failure('CONTENT_RESOURCE_INVALID', 'Content resource ID must be one lowercase SHA-256 digest.')
  const canonicalRoot = await canonicalDirectory(root)
  const candidate = resolve(root, hash)
  try {
    const direct = await lstat(candidate)
    if (!direct.isFile() || direct.isSymbolicLink()) return failure('CONTENT_RESOURCE_OUTSIDE_ROOT', 'Content resource must be a direct file.')
    const firstRealPath = await realpath(candidate)
    if (!isContained(canonicalRoot, firstRealPath)) return failure('CONTENT_RESOURCE_OUTSIDE_ROOT', 'Content resource escaped its canonical root.')
    await stableReadHook?.('after-precheck', hash)
    const handle = await open(firstRealPath, 'r')
    try {
      const before = await handle.stat()
      if (!before.isFile()) return failure('CONTENT_RESOURCE_OUTSIDE_ROOT', 'Opened content resource is not a file.')
      if (!sameFileState(direct, before)) return failure('CONTENT_RESOURCE_CHANGED', 'Content resource identity changed before it was opened.')
      await stableReadHook?.('after-open', hash)
      const bytes = await handle.readFile()
      await stableReadHook?.('after-read', hash)
      const after = await handle.stat()
      const finalDirect = await lstat(candidate)
      const finalRealPath = await realpath(candidate)
      if (!finalDirect.isFile() || finalDirect.isSymbolicLink() || finalRealPath !== firstRealPath
        || !sameFileState(before, after) || !sameFileState(direct, finalDirect)) {
        return failure('CONTENT_RESOURCE_CHANGED', 'Content resource changed while it was being read.')
      }
      await verifyContentIdentity(bytes, hash)
      const verifiedDirect = await lstat(candidate)
      const verifiedRealPath = await realpath(candidate)
      if (!verifiedDirect.isFile() || verifiedDirect.isSymbolicLink() || verifiedRealPath !== firstRealPath
        || !sameFileState(direct, verifiedDirect)) {
        return failure('CONTENT_RESOURCE_CHANGED', 'Content resource changed while its identity was being verified.')
      }
      return bytes
    } finally {
      await handle.close()
    }
  } catch (error) {
    if (error instanceof ContentResourceError) throw error
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return failure('CONTENT_RESOURCE_MISSING', 'Content resource is missing.', error)
    return failure('CONTENT_RESOURCE_INVALID', 'Content resource could not be read safely.', error)
  }
}

async function directDirectoryExists(path: string): Promise<boolean> {
  try {
    const entry = await lstat(path)
    if (!entry.isDirectory() || entry.isSymbolicLink()) return failure('CONTENT_RESOURCE_OUTSIDE_ROOT', 'Published content store must be a direct directory.')
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export async function publishVerifiedContentStore(sourceRoot: string, outputRoot: string): Promise<void> {
  await canonicalDirectory(sourceRoot)
  await mkdir(outputRoot, { recursive: true })
  const canonicalOutput = await canonicalDirectory(outputRoot)
  const nonce = `${process.pid}-${randomUUID()}`
  const staging = join(canonicalOutput, `.v09-resources-staging-${nonce}`)
  const published = join(canonicalOutput, 'v09-resources')
  const backup = join(canonicalOutput, `.v09-resources-backup-${nonce}`)
  const hashes = (await readdir(sourceRoot)).sort()
  if (hashes.some(hash => !CONTENT_HASH.test(hash))) return failure('CONTENT_RESOURCE_INVALID', 'Content store contains a non-content filename.')
  await mkdir(staging)
  try {
    let nextIndex = 0
    const publishNext = async (): Promise<void> => {
      while (nextIndex < hashes.length) {
        const index = nextIndex
        nextIndex += 1
        const hash = hashes[index]!
        const bytes = await readVerifiedContentResource(sourceRoot, hash)
        const partial = join(staging, `.${hash}.partial`)
        await writeFile(partial, bytes, { flag: 'wx' })
        await rename(partial, join(staging, hash))
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, hashes.length) }, publishNext))

    const hadPublished = await directDirectoryExists(published)
    if (hadPublished) await rename(published, backup)
    try {
      await rename(staging, published)
    } catch (error) {
      if (hadPublished) await rename(backup, published)
      throw error
    }
    if (hadPublished) await rm(backup, { recursive: true, force: true })
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
}

export function qmonsterContentResources(sourceRoot: string): Plugin {
  return {
    name: 'qmonster-content-resources',
    configureServer(server) {
      server.middlewares.use('/v09-resources/', async (request, response) => {
        const hash = request.url?.slice(1).split('?', 1)[0] ?? ''
        try {
          const bytes = await readVerifiedContentResource(sourceRoot, hash)
          response.statusCode = 200
          response.setHeader('Content-Type', 'application/octet-stream')
          response.setHeader('Cache-Control', 'no-store')
          response.end(bytes)
        } catch {
          response.statusCode = 404
          response.end()
        }
      })
    },
    async writeBundle(options) {
      if (options.dir === undefined) return failure('CONTENT_RESOURCE_INVALID', 'Vite output directory is required.')
      await publishVerifiedContentStore(sourceRoot, options.dir)
    },
  }
}
