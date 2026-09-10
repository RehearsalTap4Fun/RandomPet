import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { canonicalJsonBytes, canonicalJsonSha256 } from '@qmonster/asset-catalog'
import { readVerifiedContentResource } from '../apps/creator-web/vite-content-resources.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('v0.9 content resource server boundary', () => {
  it('returns only stable, identity-verified bytes inside the canonical root', async () => {
    const root = await temporaryDirectory()
    const document = { alpha: 1, beta: 'sealed' }
    const hash = canonicalJsonSha256(document)
    await writeFile(join(root, hash), canonicalJsonBytes(document))

    await expect(readVerifiedContentResource(root, hash)).resolves.toEqual(canonicalJsonBytes(document))
    await expect(readVerifiedContentResource(root, '0'.repeat(64))).rejects.toMatchObject({ code: 'CONTENT_RESOURCE_MISSING' })
  })

  it('rejects a content-named symlink that escapes the canonical root when symlinks are supported', async () => {
    const root = await temporaryDirectory()
    const outside = join(await temporaryDirectory(), 'outside.json')
    const document = { outside: true }
    const hash = canonicalJsonSha256(document)
    await writeFile(outside, canonicalJsonBytes(document))
    try {
      await symlink(outside, join(root, hash), 'file')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return
      throw error
    }

    await expect(readVerifiedContentResource(root, hash)).rejects.toMatchObject({ code: 'CONTENT_RESOURCE_OUTSIDE_ROOT' })
  })
})

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'qmonster-v09-content-'))
  await mkdir(dirname(path), { recursive: true })
  temporaryDirectories.push(path)
  return path
}
