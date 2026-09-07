import {
  VISUAL_SLOT_IDS,
  type Diagnostic,
  type GenerationRequest,
  type GenerationResult,
  type MonsterSpec,
  type ThemeId,
  type VisualSlotId,
} from '@qmonster/generator-core'
import { refreshSessionValidity } from './session-diagnostics.js'

export interface CreatorSession {
  spec: MonsterSpec
  locks: Record<VisualSlotId, boolean>
  generationDiagnostics: Diagnostic[]
  renderDiagnostics: Diagnostic[]
  diagnostics: Diagnostic[]
  blocked: boolean
  exportCapabilities: { png: boolean; webp: boolean }
}

export type CreatorAction =
  | { type: 'newCreature'; seed: string }
  | { type: 'setTheme'; themeId: ThemeId }
  | { type: 'setMode'; mode: GenerationRequest['mode'] }
  | { type: 'toggleLock'; slotId: VisualSlotId }
  | { type: 'rerollAppearance' }
  | { type: 'rerollSlot'; slotId: VisualSlotId }
  | { type: 'manualSelect'; slotId: VisualSlotId; partId: string }
  | { type: 'importSpec'; spec: MonsterSpec }
  | { type: 'setRenderDiagnostics'; diagnostics: Diagnostic[] }

export function createUnlockedLocks(): Record<VisualSlotId, boolean> {
  return Object.fromEntries(
    VISUAL_SLOT_IDS.map(slotId => [slotId, false]),
  ) as Record<VisualSlotId, boolean>
}

export function createCreatorSession(
  generated: GenerationResult,
  exportCapabilities: CreatorSession['exportCapabilities'] = { png: true, webp: true },
): CreatorSession {
  return refreshSessionValidity({
    spec: generated.spec,
    locks: createUnlockedLocks(),
    generationDiagnostics: generated.diagnostics,
    renderDiagnostics: [],
    exportCapabilities: { ...exportCapabilities },
  })
}
