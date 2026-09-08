import { describe, expect, it } from 'vitest'
import {
  ANIMAL_ARCHETYPE_IDS,
  LOCAL_VISUAL_SLOT_IDS,
  NON_FACIAL_VISUAL_SLOT_IDS,
  STRUCTURAL_SLOT_IDS,
  VISUAL_SLOT_IDS,
  isLocalVisualSlot,
  isStructuralSlot,
} from './contracts.js'
import type { LocalVisualSlotId, NonFacialVisualSlotId } from './contracts.js'

const nonFacialVisualSlot: NonFacialVisualSlotId = 'surfaceMaterial'
const localVisualSlot: LocalVisualSlotId = 'eyes'

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

describe('anatomy bundle local slot contract', () => {
  it('exposes exactly the eight non-structural slots that anatomy bundles can pool', () => {
    expect(localVisualSlot).toBe('eyes')
    expect(LOCAL_VISUAL_SLOT_IDS).toEqual([
      'eyes', 'mouthShape', 'oralDetail', 'headAppendage',
      'surfaceMaterial', 'pattern', 'colorScheme', 'effect',
    ])
    expect(VISUAL_SLOT_IDS.filter(isLocalVisualSlot)).toEqual(LOCAL_VISUAL_SLOT_IDS)
  })
})

describe('animal archetype contract', () => {
  it('exposes feline and future typed archetype identities', () => {
    expect(ANIMAL_ARCHETYPE_IDS).toEqual(['feline', 'canine', 'lagomorph'])
  })
})

describe('v0.8 species-rig contract', () => {
  it('exports the exact version and region identities consumed by v0.8', async () => {
    const contracts = await import('./contracts.js') as Record<string, unknown>

    expect(contracts).toMatchObject({
      V08_CATALOG_VERSION: '0.8.0',
      V08_RENDERER_VERSION: '0.8.0',
      V08_SPEC_SCHEMA_VERSION: '0.3.0',
      V08_REGION_IDS: [
        'bodySurface', 'headSurface', 'faceSafeZone', 'eyesRegion', 'mouthRegion',
        'oralRegion', 'tailSurface', 'frontPawDetail', 'hindPawDetail', 'headAccessory',
        'mutationEar', 'mutationBack', 'mutationTailTip', 'effectField', 'faceProtection',
      ],
    })
  })
})
