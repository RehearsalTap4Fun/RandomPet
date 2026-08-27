import { readdir } from 'node:fs/promises'
import { beforeEach, expect, it, vi } from 'vitest'

const mocked = vi.hoisted(() => ({
  createServer: vi.fn(),
  launch: vi.fn(),
}))

vi.mock('vite', () => ({ createServer: mocked.createServer }))
vi.mock('@playwright/test', () => ({ chromium: { launch: mocked.launch } }))

import { reconstructLimbMatrixEvidence } from './render-limb-contact-sheets.js'

beforeEach(() => vi.clearAllMocks())

it('closes partial browser startup and the server when a later worker page cannot open', async () => {
  const server = {
    listen: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    resolvedUrls: { local: ['http://127.0.0.1:4173/'] },
  }
  const firstPage = { close: vi.fn(async () => undefined) }
  const browser = {
    newPage: vi.fn()
      .mockResolvedValueOnce(firstPage)
      .mockRejectedValueOnce(new Error('second page failed')),
    close: vi.fn(async () => undefined),
  }
  mocked.createServer.mockResolvedValue(server)
  mocked.launch.mockResolvedValue(browser)
  const before = (await readdir(process.cwd())).filter(path => path.startsWith('.tmp-limb-matrix-')).sort()

  await expect(reconstructLimbMatrixEvidence({
    planOverride: [
      { rigId: 'blob', bodyFrame: 'body_blob_round', headShape: 'head_round_dome', arms: 'arms_paddle', legs: 'legs_stub_feet' },
      { rigId: 'blob', bodyFrame: 'body_blob_wide', headShape: 'head_round_dome', arms: 'arms_paddle', legs: 'legs_stub_feet' },
    ],
    workerCount: 2,
  })).rejects.toThrow('second page failed')

  expect(firstPage.close).toHaveBeenCalledTimes(1)
  expect(browser.close).toHaveBeenCalledTimes(1)
  expect(server.close).toHaveBeenCalledTimes(1)
  const after = (await readdir(process.cwd())).filter(path => path.startsWith('.tmp-limb-matrix-')).sort()
  expect(after).toEqual(before)
})
