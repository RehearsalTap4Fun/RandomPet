import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('v0.8 review render ownership', () => {
  it('contains no alternate v0.8 creature compositor', async () => {
    const source = await readFile('scripts/generate-v08-user-review-batch.ts', 'utf8')

    expect(source).toContain('acceptance-render.html')
    expect(source).toContain('renderAcceptanceMonster')
    expect(source).not.toMatch(/\.trim\s*\(|sharp\s*\([^)]*\)\.composite|positions\s*=|sourceAnchor/u)
  })
})
