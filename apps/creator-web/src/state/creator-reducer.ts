import type { Reducer } from 'react'
import {
  generateMonster,
  rerollSlot,
  selectVisualPart,
  VISUAL_SLOT_IDS,
  type Catalog,
  type GenerationMode,
  type GenerationResult,
  type VisualSlotId,
} from '@qmonster/generator-core'
import {
  createUnlockedLocks,
  type CreatorAction,
  type CreatorSession,
} from './contracts.js'

function modeFromSession(session: CreatorSession): GenerationMode {
  if (session.spec.aberrations.length > 0) return 'aberration'
  if (session.spec.mutation !== null) return 'mutation'
  const failedModifierPath = (path: 'mutation' | 'aberrations'): boolean =>
    session.diagnostics.some(diagnostic =>
      diagnostic.severity === 'error'
      && diagnostic.code === 'MODIFIER_NOT_FOUND'
      && diagnostic.path.length === 1
      && diagnostic.path[0] === path,
    )
  if (failedModifierPath('aberrations')) return 'aberration'
  if (failedModifierPath('mutation')) return 'mutation'
  return 'normal'
}

function lockedSelections(session: CreatorSession): Partial<Record<VisualSlotId, string>> {
  return Object.fromEntries(
    VISUAL_SLOT_IDS
      .filter(slotId => session.locks[slotId])
      .map(slotId => [slotId, session.spec.visualSlots[slotId].partId]),
  )
}

function withGenerationResult(session: CreatorSession, generated: GenerationResult): CreatorSession {
  return {
    ...session,
    spec: generated.spec,
    diagnostics: generated.diagnostics,
    blocked: generated.blocked,
  }
}

function hasIncompatibleLockDiagnostic(session: CreatorSession, slotId: VisualSlotId): boolean {
  return session.diagnostics.some(diagnostic =>
    (diagnostic.code === 'LOCK_INCOMPATIBLE' || diagnostic.code === 'LOCK_NOT_FOUND')
    && diagnostic.path[0] === 'visualSlots'
    && diagnostic.path[1] === slotId,
  )
}

export function createCreatorReducer(catalog: Catalog): Reducer<CreatorSession, CreatorAction> {
  return (state, action) => {
    switch (action.type) {
      case 'newCreature':
        return withGenerationResult(state, generateMonster({
          seed: action.seed,
          themeId: state.spec.themeId,
          mode: modeFromSession(state),
          lockedSelections: lockedSelections(state),
        }, catalog))
      case 'setTheme':
        return withGenerationResult(state, generateMonster({
          seed: state.spec.seed,
          themeId: action.themeId,
          mode: modeFromSession(state),
          slotRolls: state.spec.slotRolls,
          lockedSelections: lockedSelections(state),
        }, catalog))
      case 'setMode':
        return withGenerationResult(state, generateMonster({
          seed: state.spec.seed,
          themeId: state.spec.themeId,
          mode: action.mode,
          slotRolls: state.spec.slotRolls,
          lockedSelections: lockedSelections(state),
        }, catalog))
      case 'toggleLock': {
        const locks = { ...state.locks, [action.slotId]: !state.locks[action.slotId] }
        if (state.locks[action.slotId] && hasIncompatibleLockDiagnostic(state, action.slotId)) {
          return {
            ...withGenerationResult(state, rerollSlot({
              spec: state.spec,
              slotId: action.slotId,
              locks,
              catalog,
            })),
            locks,
          }
        }
        return { ...state, locks }
      }
      case 'rerollSlot':
        return withGenerationResult(state, rerollSlot({
          spec: state.spec,
          slotId: action.slotId,
          locks: state.locks,
          catalog,
        }))
      case 'manualSelect':
        return withGenerationResult(state, selectVisualPart({
          spec: state.spec,
          slotId: action.slotId,
          partId: action.partId,
          locks: state.locks,
          catalog,
        }))
      case 'importSpec':
        return {
          ...state,
          spec: structuredClone(action.spec),
          locks: createUnlockedLocks(),
          diagnostics: [],
          blocked: false,
        }
    }
  }
}
