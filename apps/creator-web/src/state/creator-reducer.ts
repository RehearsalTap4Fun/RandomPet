import type { Reducer } from 'react'
import {
  generateMonster,
  rerollSlot,
  selectVisualPart,
  STRUCTURAL_SLOT_IDS,
  VISUAL_SLOT_IDS,
  type Catalog,
  type Diagnostic,
  type GenerationMode,
  type GenerationResult,
  type VisualSlotId,
} from '@qmonster/generator-core'
import {
  createUnlockedLocks,
  type CreatorAction,
  type CreatorSession,
} from './contracts.js'
import { refreshSessionValidity } from './session-diagnostics.js'

function modeFromSession(session: CreatorSession): GenerationMode {
  if (session.spec.aberrations.length > 0) return 'aberration'
  if (session.spec.mutation !== null) return 'mutation'
  const failedModifierPath = (path: 'mutation' | 'aberrations'): boolean =>
    session.generationDiagnostics.some(diagnostic =>
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
  return refreshSessionValidity({
    ...session,
    spec: generated.spec,
    generationDiagnostics: generated.diagnostics,
    renderDiagnostics: [],
  })
}

const REPLACEABLE_SLOT_DIAGNOSTIC_CODES = new Set([
  'LOCK_NOT_FOUND',
  'LOCK_INCOMPATIBLE',
  'SLOT_LOCKED',
  'NO_COMPATIBLE_CANDIDATE',
  'PART_NOT_FOUND',
  'PART_INCOMPATIBLE',
  'CONNECTOR_VARIANT_MISSING',
  'CONNECTOR_PROFILE_INVALID',
  'CONNECTOR_WARP_EXCEEDED',
  'CONNECTOR_BRIDGE_MISSING',
  'COMPOSITION_THEME_FALLBACK',
  'COMPOSITION_INTENSITY_EXCEEDED',
])

function isReplaceableAffectedDiagnostic(
  diagnostic: Diagnostic,
  affected: ReadonlySet<VisualSlotId>,
): boolean {
  if (!REPLACEABLE_SLOT_DIAGNOSTIC_CODES.has(diagnostic.code)) return false
  if (diagnostic.code === 'COMPOSITION_INTENSITY_EXCEEDED') return affected.size > 0
  const slotId = diagnostic.path[1] as VisualSlotId | undefined
  if (diagnostic.code === 'COMPOSITION_THEME_FALLBACK') {
    return diagnostic.path[0] === 'visualSlots' && slotId !== undefined && affected.has(slotId)
  }
  return diagnostic.path[0] === 'visualSlots' && slotId !== undefined && affected.has(slotId)
}

function diagnosticKey(diagnostic: Diagnostic): string {
  return JSON.stringify([diagnostic.severity, diagnostic.code, diagnostic.path, diagnostic.message])
}

function reconcileLocalGenerationResult(
  session: CreatorSession,
  generated: GenerationResult,
  replaceAffectedDiagnostics: boolean,
): CreatorSession {
  const affected = new Set(generated.affectedSlots)
  if (affected.has('bodyFrame')) {
    for (const slotId of STRUCTURAL_SLOT_IDS) affected.add(slotId)
  }
  const retained = replaceAffectedDiagnostics
    ? session.generationDiagnostics.filter(diagnostic => !isReplaceableAffectedDiagnostic(diagnostic, affected))
    : session.generationDiagnostics
  const diagnostics: Diagnostic[] = []
  const seen = new Set<string>()
  for (const diagnostic of [...retained, ...generated.diagnostics]) {
    const key = diagnosticKey(diagnostic)
    if (seen.has(key)) continue
    seen.add(key)
    diagnostics.push(diagnostic)
  }
  return refreshSessionValidity({
    ...session,
    spec: generated.spec,
    generationDiagnostics: diagnostics,
    renderDiagnostics: [],
  })
}

function hasIncompatibleLockDiagnostic(session: CreatorSession, slotId: VisualSlotId): boolean {
  return session.generationDiagnostics.some(diagnostic =>
    diagnostic.severity === 'error'
    && (diagnostic.code === 'LOCK_INCOMPATIBLE' || diagnostic.code === 'LOCK_NOT_FOUND')
    && diagnostic.path.length === 2
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
            ...reconcileLocalGenerationResult(state, rerollSlot({
              spec: state.spec,
            slotId: action.slotId,
            locks,
            catalog,
            }), true),
            locks,
          }
        }
        return { ...state, locks }
      }
      case 'rerollSlot': {
        const generated = rerollSlot({
          spec: state.spec,
          slotId: action.slotId,
          locks: state.locks,
          catalog,
        })
        return reconcileLocalGenerationResult(
          state,
          generated,
          !state.locks[action.slotId],
        )
      }
      case 'manualSelect': {
        const generated = selectVisualPart({
          spec: state.spec,
          slotId: action.slotId,
          partId: action.partId,
          locks: state.locks,
          catalog,
        })
        const selectionFailed = generated.diagnostics.some(diagnostic =>
          (diagnostic.code === 'PART_NOT_FOUND' || diagnostic.code === 'PART_INCOMPATIBLE')
          && diagnostic.path.length === 2
          && diagnostic.path[0] === 'visualSlots'
          && diagnostic.path[1] === action.slotId,
        )
        return reconcileLocalGenerationResult(
          state,
          generated,
          !selectionFailed,
        )
      }
      case 'importSpec':
        return refreshSessionValidity({
          ...state,
          spec: structuredClone(action.spec),
          locks: createUnlockedLocks(),
          generationDiagnostics: [],
          renderDiagnostics: [],
        })
      case 'setRenderDiagnostics':
        return refreshSessionValidity({
          ...state,
          renderDiagnostics: action.diagnostics,
        })
    }
  }
}
