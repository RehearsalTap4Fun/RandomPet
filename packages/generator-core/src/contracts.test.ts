import { describe, expect, it } from 'vitest'
import { STRUCTURAL_SLOT_IDS, VISUAL_SLOT_IDS, isStructuralSlot } from './contracts.js'

describe('structural slot contract', () => {
  it('classifies exactly the six structural visual slots', () => {
    expect(STRUCTURAL_SLOT_IDS).toEqual([
      'bodyFrame', 'headShape', 'arms', 'legs', 'tail', 'extraAppendage',
    ])
    expect(VISUAL_SLOT_IDS.filter(isStructuralSlot)).toEqual(STRUCTURAL_SLOT_IDS)
    expect(VISUAL_SLOT_IDS.filter(slotId => !isStructuralSlot(slotId))).not.toContain('bodyFrame')
  })
})
