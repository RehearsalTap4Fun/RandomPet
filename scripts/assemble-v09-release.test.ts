import { describe, expect, it } from 'vitest'
import { assembleV09Release } from '../packages/asset-catalog/src/v09-production-validation.js'

describe('v0.9 release assembly', () => {
  it('does not write when validation fails', async () => {
    await expect(assembleV09Release({ root: '', candidate: undefined })).rejects.toMatchObject({ code: 'V09_RELEASE_INVALID' })
  })
})
