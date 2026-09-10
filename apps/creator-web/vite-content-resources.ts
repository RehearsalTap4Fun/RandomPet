import { canonicalJsonSha256, decodedPngSha256 } from '../../packages/asset-catalog/src/v09-content-identity.js'
import { copyFile, lstat, mkdir, open, readdir, realpath } from 'node:fs/promises'
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

export async function readVerifiedContentResource(root: string, hash: string): Promise<Buffer> {
  if (!CONTENT_HASH.test(hash)) return failure('CONTENT_RESOURCE_INVALID', 'Content resource ID must be one lowercase SHA-256 digest.')
  const canonicalRoot = await canonicalDirectory(root)
  const candidate = resolve(root, hash)
  try {
    const direct = await lstat(candidate)
    if (!direct.isFile() || direct.isSymbolicLink()) return failure('CONTENT_RESOURCE_OUTSIDE_ROOT', 'Content resource must be a direct file.')
    const firstRealPath = await realpath(candidate)
    if (!isContained(canonicalRoot, firstRealPath)) return failure('CONTENT_RESOURCE_OUTSIDE_ROOT', 'Content resource escaped its canonical root.')
    const handle = await open(firstRealPath, 'r')
    try {
      const before = await handle.stat()
      if (!before.isFile()) return failure('CONTENT_RESOURCE_OUTSIDE_ROOT', 'Opened content resource is not a file.')
      const bytes = await handle.readFile()
      const after = await handle.stat()
      const finalDirect = await lstat(candidate)
      const finalRealPath = await realpath(candidate)
      if (!finalDirect.isFile() || finalDirect.isSymbolicLink() || finalRealPath !== firstRealPath
        || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
        return failure('CONTENT_RESOURCE_CHANGED', 'Content resource changed while it was being read.')
      }
      const actual = bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
        ? await decodedPngSha256(bytes)
        : canonicalJsonSha256(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown)
      if (actual !== hash) return failure('CONTENT_RESOURCE_HASH_MISMATCH', 'Content resource body does not match its identity.')
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

async function copyContentStore(sourceRoot: string, outputRoot: string): Promise<void> {
  const canonicalRoot = await canonicalDirectory(sourceRoot)
  const output = join(outputRoot, 'v09-resources')
  await mkdir(output, { recursive: true })
  for (const hash of await readdir(sourceRoot)) {
    if (!CONTENT_HASH.test(hash)) return failure('CONTENT_RESOURCE_INVALID', 'Content store contains a non-content filename.')
    const source = join(sourceRoot, hash)
    const entry = await lstat(source)
    const canonicalSource = await realpath(source)
    if (!entry.isFile() || entry.isSymbolicLink() || !isContained(canonicalRoot, canonicalSource)) return failure('CONTENT_RESOURCE_OUTSIDE_ROOT', 'Content store contains an indirect file.')
    await copyFile(canonicalSource, join(output, hash))
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
      await copyContentStore(sourceRoot, options.dir)
    },
  }
}
