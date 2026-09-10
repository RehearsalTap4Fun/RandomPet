import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { canonicalJsonBytes, canonicalJsonSha256 } from '@qmonster/asset-catalog'
import {
  __setV09ContentReadHookForTest,
  publishVerifiedContentStore,
  readVerifiedContentResource,
} from '../apps/creator-web/vite-content-resources.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  __setV09ContentReadHookForTest(undefined)
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

  it('publishes only identity-verified bytes through an atomic content-store replacement', async () => {
    const root = await temporaryDirectory()
    const output = await temporaryDirectory()
    const document = { stable: true }
    const hash = canonicalJsonSha256(document)
    const bytes = canonicalJsonBytes(document)
    await writeFile(join(root, hash), bytes)

    await publishVerifiedContentStore(root, output)

    expect(await readFile(join(output, 'v09-resources', hash))).toEqual(bytes)
    expect(await readdir(join(output, 'v09-resources'))).toEqual([hash])
  })

  it('rejects same-file mutation after opening and never publishes its bytes', async () => {
    const root = await temporaryDirectory()
    const output = await temporaryDirectory()
    const document = { stable: true }
    const hash = canonicalJsonSha256(document)
    const source = join(root, hash)
    await writeFile(source, canonicalJsonBytes(document))
    __setV09ContentReadHookForTest(async stage => {
      if (stage === 'after-open') await writeFile(source, canonicalJsonBytes({ evil__: true }))
    })

    await expect(publishVerifiedContentStore(root, output)).rejects.toMatchObject({
      code: expect.stringMatching(/^CONTENT_RESOURCE_(CHANGED|HASH_MISMATCH)$/u),
    })
    await expect(readdir(join(output, 'v09-resources'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a path swapped to an external symlink before opening and never publishes foreign bytes', async () => {
    const root = await temporaryDirectory()
    const output = await temporaryDirectory()
    const outside = join(await temporaryDirectory(), 'outside.json')
    const document = { stable: true }
    const hash = canonicalJsonSha256(document)
    const source = join(root, hash)
    await writeFile(source, canonicalJsonBytes(document))
    await writeFile(outside, canonicalJsonBytes(document))
    const probe = join(root, 'symlink-support-probe')
    try {
      await symlink(outside, probe, 'file')
      await rm(probe)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return
      throw error
    }
    __setV09ContentReadHookForTest(async stage => {
      if (stage !== 'after-precheck') return
      await rm(source)
      await symlink(outside, source, 'file')
    })

    await expect(publishVerifiedContentStore(root, output)).rejects.toMatchObject({
      code: expect.stringMatching(/^CONTENT_RESOURCE_(CHANGED|OUTSIDE_ROOT)$/u),
    })
    await expect(readdir(join(output, 'v09-resources'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects invalid content under a digest filename without creating the published store', async () => {
    const root = await temporaryDirectory()
    const output = await temporaryDirectory()
    const hash = canonicalJsonSha256({ expected: true })
    await writeFile(join(root, hash), canonicalJsonBytes({ foreign: true }))

    await expect(publishVerifiedContentStore(root, output)).rejects.toMatchObject({ code: 'CONTENT_RESOURCE_HASH_MISMATCH' })
    await expect(readdir(join(output, 'v09-resources'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'qmonster-v09-content-'))
  await mkdir(dirname(path), { recursive: true })
  temporaryDirectories.push(path)
  return path
}
