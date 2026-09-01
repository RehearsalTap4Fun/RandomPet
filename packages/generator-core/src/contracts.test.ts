import { describe, expect, it } from 'vitest'
import {
  NON_FACIAL_VISUAL_SLOT_IDS,
  STRUCTURAL_SLOT_IDS,
  VISUAL_SLOT_IDS,
  isStructuralSlot,
} from './contracts.js'
import type { NonFacialVisualSlotId } from './contracts.js'

const nonFacialVisualSlot: NonFacialVisualSlotId = 'surfaceMaterial'

describe('structural slot contract', () => {
  it('classifies exactly the six structural visual slots', () => {
    expect(STRUCTURAL_SLOT_IDS).toEqual([
      'bodyFrame', 'headShape', 'arms', 'legs', 'tail', 'extraAppendage',
    ])
    expect(VISUAL_SLOT_IDS.filter(isStructuralSlot)).toEqual(STRUCTURAL_SLOT_IDS)
    expect(VISUAL_SLOT_IDS.filter(slotId => !isStructuralSlot(slotId))).not.toContain('bodyFrame')
  })
})

describe('non-facial visual slot contract', () => {
  it('exports the non-facial visual slot union for consumers', () => {
    expect(nonFacialVisualSlot).toBe('surfaceMaterial')
  })

  it('declares the exact non-facial visual slots', () => {
    expect(NON_FACIAL_VISUAL_SLOT_IDS).toEqual(['surfaceMaterial', 'pattern', 'effect'])
  })
})
