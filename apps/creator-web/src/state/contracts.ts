import {
  VISUAL_SLOT_IDS,
  type Diagnostic,
  type GenerationRequest,
  type GenerationResult,
  type MonsterSpec,
  type ThemeId,
  type VisualSlotId,
} from '@qmonster/generator-core'

export interface CreatorSession {
  spec: MonsterSpec
  locks: Record<VisualSlotId, boolean>
  diagnostics: Diagnostic[]
  blocked: boolean
  exportCapabilities: { png: boolean; webp: boolean }
}

export type CreatorAction =
  | { type: 'newCreature'; seed: string }
  | { type: 'setTheme'; themeId: ThemeId }
  | { type: 'setMode'; mode: GenerationRequest['mode'] }
  | { type: 'toggleLock'; slotId: VisualSlotId }
  | { type: 'rerollSlot'; slotId: VisualSlotId }
  | { type: 'manualSelect'; slotId: VisualSlotId; partId: string }
  | { type: 'importSpec'; spec: MonsterSpec }

export function createUnlockedLocks(): Record<VisualSlotId, boolean> {
  return Object.fromEntries(
    VISUAL_SLOT_IDS.map(slotId => [slotId, false]),
  ) as Record<VisualSlotId, boolean>
}

export function createCreatorSession(
  generated: GenerationResult,
  exportCapabilities: CreatorSession['exportCapabilities'] = { png: true, webp: true },
): CreatorSession {
  return {
    spec: generated.spec,
    locks: createUnlockedLocks(),
    diagnostics: generated.diagnostics,
    blocked: generated.blocked,
    exportCapabilities: { ...exportCapabilities },
  }
}
