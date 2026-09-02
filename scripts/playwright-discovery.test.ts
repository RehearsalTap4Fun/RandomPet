import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

it('does not hand the Vitest-only v0.4 face regression suite to Playwright', () => {
  const result = spawnSync(process.execPath, [resolve('node_modules/@playwright/test/cli.js'), 'test', '--list'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })

  expect(result.status, `${result.stdout}${result.stderr}`).toBe(0)
  expect(`${result.stdout}${result.stderr}`).not.toContain('v04-face-zone-regression.spec.ts')
})
