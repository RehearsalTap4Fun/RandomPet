import { describe, expect, it } from 'vitest'
import {
  generateMonster,
  VISUAL_SLOT_IDS,
  type Catalog,
  type Diagnostic,
  type GenerationMode,
  type MonsterSpec,
  type VisualSlotId,
} from '@qmonster/generator-core'
import {
  makeInterfaceCatalogFixture,
  makeValidCatalogFixture,
  makeValidCompositionSpecFixture,
} from '@qmonster/generator-core/test-fixtures'
import { createCreatorReducer } from './creator-reducer.js'
import {
  createCreatorSession,
  type CreatorSession,
} from './contracts.js'
import { refreshSessionValidity } from './session-diagnostics.js'

function unlockedSlots(): Record<VisualSlotId, boolean> {
  return Object.fromEntries(VISUAL_SLOT_IDS.map(slotId => [slotId, false])) as Record<VisualSlotId, boolean>
}

function makeSession(
  catalog: Catalog,
  options: { seed?: string; themeId?: 'deep-sea' | 'fungal' | 'shadow'; mode?: GenerationMode } = {},
): CreatorSession {
  const generated = generateMonster({
    seed: options.seed ?? '84721937',
    themeId: options.themeId ?? 'fungal',
    mode: options.mode ?? 'normal',
  }, catalog)
  return createCreatorSession(generated)
}

function withLocked(session: CreatorSession, ...slotIds: VisualSlotId[]): CreatorSession {
  return {
    ...session,
    locks: {
      ...session.locks,
      ...Object.fromEntries(slotIds.map(slotId => [slotId, true])),
    },
  }
}

function catalogWithoutModifiers(): Catalog {
  return { ...makeValidCatalogFixture(), modifiers: [] }
}

function withManualTail(catalog: Catalog): Catalog {
  const tail = catalog.parts.find(part => part.slotId === 'tail' && !part.id.endsWith('_none'))!
  return {
    ...catalog,
    parts: [...catalog.parts, { ...tail, id: 'tail_manual', baseWeight: 0 }],
  }
}

function catalogWithTwoDanglingExcludes(): Catalog {
  const catalog = makeValidCatalogFixture()
  const part = catalog.parts[0]!
  return {
    ...catalog,
    parts: catalog.parts.map(candidate => candidate === part
      ? { ...candidate, excludes: ['missing_a', 'missing_b'] }
      : candidate),
  }
}

function catalogWithIncompatibleBodyReplacement(): Catalog {
  const catalog = makeInterfaceCatalogFixture()
  const body = catalog.parts.find(part => part.slotId === 'bodyFrame')!
  if (body.composition?.mode !== 'interface') throw new Error('Expected interface body fixture.')
  const replacement = structuredClone(body)
  replacement.id = `${body.id}_incompatible`
  replacement.baseWeight = 0
  if (replacement.composition?.mode !== 'interface') throw new Error('Expected cloned interface body fixture.')
  for (const variant of Object.values(replacement.composition.variantsByRig)) {
    if (variant === undefined) continue
    variant.connectors = variant.connectors.map(connector => ({
      ...connector,
      width: connector.width * 10,
    }))
  }
  catalog.parts.push(replacement)
  return catalog
}

function catalogWithIncompatibleShadowEyes(): Catalog {
  const catalog = makeValidCatalogFixture()
  const commonColor = catalog.parts.find(part => part.slotId === 'colorScheme')!
  const commonEyes = catalog.parts.find(part => part.id === 'eyes_asymmetric')!
  return {
    ...catalog,
    parts: [
      ...catalog.parts.map(part => {
        if (part.id === commonColor.id) return { ...part, themeIds: ['deep-sea', 'fungal'] }
        if (part.id === 'eyes_asymmetric') return { ...part, excludes: ['color_scheme_shadow'] }
        return part
      }),
      {
        ...commonColor,
        id: 'color_scheme_shadow',
        themeIds: ['shadow'],
        themeWeights: { shadow: 1 },
      },
      {
        ...commonEyes,
        id: 'eyes_shadow_compatible',
        themeIds: ['shadow'],
        themeWeights: { shadow: 1 },
        excludes: [],
      },
    ],
  }
}

function catalogThatReplacesEveryUnlockedSlot(): Catalog {
  const catalog = makeValidCatalogFixture()
  const primaryBySlot = new Map<VisualSlotId, Catalog['parts'][number]>()
  for (const part of catalog.parts) {
    if (!primaryBySlot.has(part.slotId) && !part.id.endsWith('_none')) primaryBySlot.set(part.slotId, part)
  }
  const replacements = VISUAL_SLOT_IDS
    .filter(slotId => slotId !== 'eyes')
    .map(slotId => {
      const part = primaryBySlot.get(slotId)!
      return {
        ...part,
        id: `${part.id}_fresh`,
        baseWeight: 1,
        themeIds: ['deep-sea'],
        themeWeights: { 'deep-sea': 1 },
        excludes: [],
      }
    })
  return {
    ...catalog,
    parts: [
      ...catalog.parts.map(part => ({
        ...part,
        baseWeight: part.id === 'eyes_asymmetric' ? 1 : 0,
      })),
      ...replacements,
    ],
  }
}

describe('createCreatorReducer', () => {
  it('clears child connector errors after an invalid body replacement is repaired', () => {
    const catalog = catalogWithIncompatibleBodyReplacement()
    const session = makeSession(catalog)
    const reducer = createCreatorReducer(catalog)
    const originalBodyId = session.spec.visualSlots.bodyFrame.partId

    const blocked = reducer(session, {
      type: 'manualSelect',
      slotId: 'bodyFrame',
      partId: `${originalBodyId}_incompatible`,
    })
    expect(blocked.blocked).toBe(true)
    expect(blocked.generationDiagnostics).toContainEqual(expect.objectContaining({
      code: 'CONNECTOR_WARP_EXCEEDED',
      path: expect.arrayContaining(['visualSlots']),
    }))
    expect(blocked.generationDiagnostics.some(diagnostic => (
      diagnostic.path[0] === 'visualSlots' && diagnostic.path[1] !== 'bodyFrame'
    ))).toBe(true)

    const repaired = reducer(blocked, {
      type: 'manualSelect', slotId: 'bodyFrame', partId: originalBodyId,
    })

    expect(repaired.blocked).toBe(false)
    expect(repaired.generationDiagnostics).toEqual([])
  })

  it.each([
    'CONNECTOR_VARIANT_MISSING',
    'CONNECTOR_PROFILE_INVALID',
    'CONNECTOR_WARP_EXCEEDED',
    'CONNECTOR_BRIDGE_MISSING',
  ])('clears a repaired %s diagnostic after selecting a valid structural part', code => {
    const catalog = makeInterfaceCatalogFixture()
    const spec = makeValidCompositionSpecFixture(catalog)
    spec.catalogVersion = '0.3.0'
    spec.rendererVersion = '0.3.0'
    const session = createCreatorSession({
      spec,
      diagnostics: [],
      blocked: false,
      affectedSlots: [...VISUAL_SLOT_IDS],
    })
    const stale = refreshSessionValidity({
      ...session,
      generationDiagnostics: [{
        severity: 'error',
        code,
        path: ['visualSlots', 'headShape'],
        message: 'The previous head connector was invalid.',
      }],
    })
    const reducer = createCreatorReducer(catalog)

    const recovered = reducer(stale, {
      type: 'manualSelect',
      slotId: 'headShape',
      partId: spec.visualSlots.headShape.partId,
    })

    expect(recovered.blocked).toBe(false)
    expect(recovered.diagnostics).toEqual([])
  })

  it('blocks on current render errors and unblocks when they clear', () => {
    const catalog = makeValidCatalogFixture()
    const reducer = createCreatorReducer(catalog)
    const failed = reducer(makeSession(catalog), {
      type: 'setRenderDiagnostics',
      diagnostics: [{
        severity: 'error',
        code: 'ASSET_LOAD_FAILED',
        path: ['parts', 'eyes'],
        message: 'missing',
      }],
    })

    expect(failed.blocked).toBe(true)
    expect(failed.diagnostics.map(item => item.code)).toContain('ASSET_LOAD_FAILED')
    const recovered = reducer(failed, { type: 'setRenderDiagnostics', diagnostics: [] })
    expect(recovered.blocked).toBe(false)
  })

  it('keeps strong-feature warnings non-blocking while face render errors block export', () => {
    const catalog = makeValidCatalogFixture()
    const reducer = createCreatorReducer(catalog)
    const warned = refreshSessionValidity({
      ...makeSession(catalog),
      generationDiagnostics: [{
        severity: 'warning',
        code: 'COMPOSITION_INTENSITY_EXCEEDED',
        path: ['visualSlots'],
        message: 'three strong features',
      }],
    })

    const blocked = reducer(warned, {
      type: 'setRenderDiagnostics',
      diagnostics: [{
        severity: 'error',
        code: 'COMPOSITION_FACE_OCCLUDED',
        path: ['visualSlots', 'eyes'],
        message: 'eyes hidden',
      }],
    })

    expect(warned.blocked).toBe(false)
    expect(blocked.blocked).toBe(true)
  })

  it('replaces stale composition warnings when the affected local slot is recomputed', () => {
    const catalog = makeValidCatalogFixture()
    const reducer = createCreatorReducer(catalog)
    const stale = refreshSessionValidity({
      ...makeSession(catalog),
      generationDiagnostics: [
        {
          severity: 'warning',
          code: 'COMPOSITION_THEME_FALLBACK',
          path: ['visualSlots', 'tail'],
          message: 'old theme fallback',
        },
        {
          severity: 'warning',
          code: 'COMPOSITION_INTENSITY_EXCEEDED',
          path: ['visualSlots'],
          message: 'old intensity',
        },
      ],
    })

    const next = reducer(stale, { type: 'rerollSlot', slotId: 'tail' })

    expect(next.diagnostics).not.toContainEqual(expect.objectContaining({ message: 'old theme fallback' }))
    expect(next.diagnostics).not.toContainEqual(expect.objectContaining({ message: 'old intensity' }))
  })

  it('clears obsolete render diagnostics on generation without using them as generation intent', () => {
    const catalog = makeValidCatalogFixture()
    const reducer = createCreatorReducer(catalog)
    const withRenderFailure = reducer(makeSession(catalog), {
      type: 'setRenderDiagnostics',
      diagnostics: [{
        severity: 'error',
        code: 'MODIFIER_NOT_FOUND',
        path: ['mutation'],
        message: 'render-only failure',
      }],
    })

    const generated = reducer(withRenderFailure, { type: 'newCreature', seed: 'next' })

    expect(generated.spec.mutation).toBeNull()
    expect(generated.renderDiagnostics).toEqual([])
    expect(generated.diagnostics).not.toContainEqual(expect.objectContaining({ message: 'render-only failure' }))
  })

  it('retains an incompatible locked selection and surfaces the core blocking diagnostic on theme change', () => {
    const catalog = catalogWithIncompatibleShadowEyes()
    const reducer = createCreatorReducer(catalog)
    const before = withLocked(makeSession(catalog), 'eyes')

    const next = reducer(before, { type: 'setTheme', themeId: 'shadow' })

    expect(next.locks.eyes).toBe(true)
    expect(next.spec.visualSlots.eyes).toEqual({
      partId: before.spec.visualSlots.eyes.partId,
      rigId: next.spec.visualSlots.bodyFrame.rigId,
    })
    expect(next.blocked).toBe(true)
    expect(next.diagnostics).toContainEqual(expect.objectContaining({
      code: 'LOCK_INCOMPATIBLE',
      path: ['visualSlots', 'eyes'],
    }))
    expect(before.spec.themeId).toBe('fungal')
  })

  it('keeps a compatible lock and replaces every unlocked slot through generation on theme change', () => {
    const originalCatalog = makeValidCatalogFixture()
    const reducerCatalog = catalogThatReplacesEveryUnlockedSlot()
    const reducer = createCreatorReducer(reducerCatalog)
    const before = withLocked(makeSession(originalCatalog), 'eyes')

    const next = reducer(before, { type: 'setTheme', themeId: 'deep-sea' })

    expect(next.spec.themeId).toBe('deep-sea')
    expect(next.spec.visualSlots.eyes).toEqual({
      partId: before.spec.visualSlots.eyes.partId,
      rigId: next.spec.visualSlots.bodyFrame.rigId,
    })
    for (const slotId of VISUAL_SLOT_IDS) {
      if (slotId === 'eyes') continue
      expect(next.spec.visualSlots[slotId].partId, slotId).toMatch(/_fresh$/)
    }
    expect(next.blocked).toBe(false)
  })

  it('replaces an incompatible locked selection and clears blocking diagnostics when it is unlocked', () => {
    const catalog = catalogWithIncompatibleShadowEyes()
    const reducer = createCreatorReducer(catalog)
    const before = withLocked(makeSession(catalog), 'eyes')
    const blocked = reducer(before, { type: 'setTheme', themeId: 'shadow' })

    const next = reducer(blocked, { type: 'toggleLock', slotId: 'eyes' })

    expect(next.locks.eyes).toBe(false)
    expect(next.spec.visualSlots.eyes.partId).toBe('eyes_shadow_compatible')
    expect(next.spec.slotRolls.eyes).toBe(blocked.spec.slotRolls.eyes + 1)
    expect(next.blocked).toBe(false)
    expect(next.diagnostics).toEqual([])
  })

  it('does not reroll on unlock for a warning that resembles an incompatible-lock error', () => {
    const catalog = makeValidCatalogFixture()
    const reducer = createCreatorReducer(catalog)
    const before = withLocked(makeSession(catalog), 'eyes')
    const warning = {
      severity: 'warning' as const,
      code: 'LOCK_INCOMPATIBLE',
      path: ['visualSlots', 'eyes'],
      message: 'Preview compatibility has not been rechecked.',
    }
    const warned = refreshSessionValidity({ ...before, generationDiagnostics: [warning] })

    const next = reducer(warned, { type: 'toggleLock', slotId: 'eyes' })

    expect(next.locks.eyes).toBe(false)
    expect(next.spec).toBe(warned.spec)
    expect(next.spec.slotRolls.eyes).toBe(warned.spec.slotRolls.eyes)
    expect(next.diagnostics).toEqual([warning])
  })

  it('does not reroll on unlock for an extended incompatible-lock path', () => {
    const catalog = makeValidCatalogFixture()
    const reducer = createCreatorReducer(catalog)
    const before = withLocked(makeSession(catalog), 'eyes')
    const extended = {
      severity: 'error' as const,
      code: 'LOCK_NOT_FOUND',
      path: ['visualSlots', 'eyes', 'partId'],
      message: 'A nested validator owns this error.',
    }
    const blocked = refreshSessionValidity({ ...before, generationDiagnostics: [extended] })

    const next = reducer(blocked, { type: 'toggleLock', slotId: 'eyes' })

    expect(next.locks.eyes).toBe(false)
    expect(next.spec).toBe(blocked.spec)
    expect(next.spec.slotRolls.eyes).toBe(blocked.spec.slotRolls.eyes)
    expect(next.diagnostics).toEqual([extended])
    expect(next.blocked).toBe(true)
  })

  it('does not reroll on unlock for an unrelated exact-path error', () => {
    const catalog = makeValidCatalogFixture()
    const reducer = createCreatorReducer(catalog)
    const before = withLocked(makeSession(catalog), 'eyes')
    const unrelated = {
      severity: 'error' as const,
      code: 'FUTURE_LOCK_ERROR',
      path: ['visualSlots', 'eyes'],
      message: 'A future validator owns this error.',
    }
    const blocked = refreshSessionValidity({ ...before, generationDiagnostics: [unrelated] })

    const next = reducer(blocked, { type: 'toggleLock', slotId: 'eyes' })

    expect(next.locks.eyes).toBe(false)
    expect(next.spec).toBe(blocked.spec)
    expect(next.spec.slotRolls.eyes).toBe(blocked.spec.slotRolls.eyes)
    expect(next.diagnostics).toEqual([unrelated])
    expect(next.blocked).toBe(true)
  })

  it('keeps an incompatible locked slot blocked after an unrelated reroll', () => {
    const catalog = catalogWithIncompatibleShadowEyes()
    const reducer = createCreatorReducer(catalog)
    const before = withLocked(makeSession(catalog), 'eyes')
    const blocked = reducer(before, { type: 'setTheme', themeId: 'shadow' })
    const snapshot = structuredClone(blocked)

    const next = reducer(blocked, { type: 'rerollSlot', slotId: 'tail' })

    expect(next.spec.visualSlots.eyes).toEqual(blocked.spec.visualSlots.eyes)
    expect(next.locks.eyes).toBe(true)
    expect(next.blocked).toBe(true)
    expect(next.diagnostics).toContainEqual(expect.objectContaining({
      code: 'LOCK_INCOMPATIBLE',
      path: ['visualSlots', 'eyes'],
    }))
    expect(blocked).toEqual(snapshot)
  })

  it('rolls back an unrelated manual selection while a locked genome layer is incompatible', () => {
    const catalog = withManualTail(catalogWithIncompatibleShadowEyes())
    const reducer = createCreatorReducer(catalog)
    const before = withLocked(makeSession(catalog), 'eyes')
    const blocked = reducer(before, { type: 'setTheme', themeId: 'shadow' })

    const next = reducer(blocked, { type: 'manualSelect', slotId: 'tail', partId: 'tail_manual' })

    expect(next.spec.visualSlots.tail).toEqual(blocked.spec.visualSlots.tail)
    expect(next.spec.visualSlots.eyes).toEqual(blocked.spec.visualSlots.eyes)
    expect(next.blocked).toBe(true)
    expect(next.diagnostics).toContainEqual(expect.objectContaining({
      code: 'LOCK_INCOMPATIBLE',
      path: ['visualSlots', 'eyes'],
    }))
    expect(next.diagnostics).toContainEqual(expect.objectContaining({
      code: 'SPEC_GENOME_LAYER_INCOMPATIBLE',
      path: ['genome', 'genes', 'eyes', 'P'],
    }))
  })

  it('retains a target-slot diagnostic when an unrelated genome error rolls back manual selection', () => {
    const catalog = withManualTail(makeValidCatalogFixture())
    const reducer = createCreatorReducer(catalog)
    const before = makeSession(catalog)
    const invalidSpec = structuredClone(before.spec)
    invalidSpec.genome!.genes.eyes.H2 = 'missing_hidden_eyes'
    const tailDiagnostic: Diagnostic = {
      severity: 'error',
      code: 'NO_COMPATIBLE_CANDIDATE',
      path: ['visualSlots', 'tail'],
      message: 'The existing tail selection is unresolved.',
    }
    const hiddenDiagnostic: Diagnostic = {
      severity: 'error',
      code: 'SPEC_GENOME_LAYER_INCOMPATIBLE',
      path: ['genome', 'genes', 'tail', 'H1'],
      message: 'The existing hidden tail layer is unresolved.',
    }
    const blocked = refreshSessionValidity({
      ...before,
      spec: invalidSpec,
      generationDiagnostics: [tailDiagnostic, hiddenDiagnostic],
    })
    const snapshot = structuredClone(blocked.spec)

    const next = reducer(blocked, {
      type: 'manualSelect',
      slotId: 'tail',
      partId: 'tail_manual',
    })

    expect(next.spec).toEqual(snapshot)
    expect(next.generationDiagnostics).toContainEqual(tailDiagnostic)
    expect(next.generationDiagnostics).toContainEqual(hiddenDiagnostic)
    expect(next.generationDiagnostics).toContainEqual(expect.objectContaining({
      code: 'SPEC_GENE_PART_MISSING',
      path: ['genome', 'genes', 'eyes', 'H2'],
    }))
  })

  it('clears a repaired hidden-layer failure after an ordinary reroll retry', () => {
    const catalog = makeValidCatalogFixture()
    const reducer = createCreatorReducer(catalog)
    const before = makeSession(catalog)
    const invalidSpec = structuredClone(before.spec)
    invalidSpec.genome!.genes.eyes.H2 = 'eyes_hidden_retry_restored'
    const invalid = refreshSessionValidity({ ...before, spec: invalidSpec })

    const failed = reducer(invalid, { type: 'rerollSlot', slotId: 'eyes' })
    expect(failed.generationDiagnostics).toContainEqual(expect.objectContaining({
      code: 'SPEC_GENE_PART_MISSING',
      path: ['genome', 'genes', 'eyes', 'H2'],
    }))

    const eyes = catalog.parts.find(part => part.slotId === 'eyes')!
    catalog.parts.push({ ...eyes, id: 'eyes_hidden_retry_restored' })
    const recovered = reducer(failed, { type: 'rerollSlot', slotId: 'eyes' })

    expect(recovered.blocked).toBe(false)
    expect(recovered.generationDiagnostics).not.toContainEqual(expect.objectContaining({
      code: 'SPEC_GENE_PART_MISSING',
      path: ['genome', 'genes', 'eyes', 'H2'],
    }))
  })

  it.each(['reroll', 'manual'] as const)(
    'clears stale full-genome diagnostics after a successful body-frame %s rebuild',
    command => {
      const catalog = makeValidCatalogFixture()
      const reducer = createCreatorReducer(catalog)
      const before = makeSession(catalog)
      const stale = refreshSessionValidity({
        ...before,
        generationDiagnostics: [
          {
            severity: 'error',
            code: 'SPEC_GENOME_VERSION_UNSUPPORTED',
            path: ['genome', 'genomeVersion'],
            message: 'The previous genome version was unsupported.',
          },
          {
            severity: 'error',
            code: 'SPEC_GENE_PART_MISSING',
            path: ['genome', 'genes', 'eyes', 'H2'],
            message: 'The previous hidden eyes gene was missing.',
          },
        ],
      })

      const next = command === 'reroll'
        ? reducer(stale, { type: 'rerollSlot', slotId: 'bodyFrame' })
        : reducer(stale, {
            type: 'manualSelect',
            slotId: 'bodyFrame',
            partId: stale.spec.visualSlots.bodyFrame.partId,
          })

      expect(next.blocked).toBe(false)
      expect(next.generationDiagnostics).toEqual([])
    },
  )

  it('clears a repaired visual no-compatible-rig failure after a body-frame reroll retry', () => {
    const catalog = makeValidCatalogFixture()
    const before = makeSession(catalog)
    const reducer = createCreatorReducer(catalog)
    const bodyParts = catalog.parts.filter(part => part.slotId === 'bodyFrame')
    const originalWeights = bodyParts.map(part => part.baseWeight)
    for (const part of bodyParts) part.baseWeight = 0

    const failed = reducer(before, { type: 'rerollSlot', slotId: 'bodyFrame' })

    expect(failed.blocked).toBe(true)
    expect(failed.generationDiagnostics).toContainEqual(expect.objectContaining({
      code: 'NO_COMPATIBLE_RIG',
      path: ['visualSlots', 'bodyFrame'],
    }))

    bodyParts.forEach((part, index) => { part.baseWeight = originalWeights[index]! })
    const recovered = reducer(failed, { type: 'rerollSlot', slotId: 'bodyFrame' })

    expect(recovered.blocked).toBe(false)
    expect(recovered.generationDiagnostics).not.toContainEqual(expect.objectContaining({
      code: 'NO_COMPATIBLE_RIG',
      path: ['visualSlots', 'bodyFrame'],
    }))
  })

  it('preserves an unknown future genome gene path after a successful full rebuild', () => {
    const catalog = makeValidCatalogFixture()
    const reducer = createCreatorReducer(catalog)
    const unknownFutureDiagnostic: Diagnostic = {
      severity: 'error',
      code: 'SPEC_GENE_PART_MISSING',
      path: ['genome', 'genes', 'futureSlot', 'futureLayer'],
      message: 'A future genome path is not yet understood by this reducer.',
    }
    const blocked = refreshSessionValidity({
      ...makeSession(catalog),
      generationDiagnostics: [unknownFutureDiagnostic],
    })

    const rebuilt = reducer(blocked, { type: 'rerollSlot', slotId: 'bodyFrame' })

    expect(rebuilt.generationDiagnostics).toContainEqual(unknownFutureDiagnostic)
    expect(rebuilt.blocked).toBe(true)
  })

  it('retires only visual and P diagnostics after an ordinary manual selection', () => {
    const catalog = withManualTail(makeValidCatalogFixture())
    const reducer = createCreatorReducer(catalog)
    const before = makeSession(catalog)
    const staleVisual: Diagnostic = {
      severity: 'error',
      code: 'NO_COMPATIBLE_CANDIDATE',
      path: ['visualSlots', 'tail'],
      message: 'The previous tail phenotype was unresolved.',
    }
    const staleP: Diagnostic = {
      severity: 'error',
      code: 'SPEC_GENOME_P_MISMATCH',
      path: ['genome', 'genes', 'tail', 'P'],
      message: 'The previous tail P gene was stale.',
    }
    const staleHidden: Diagnostic = {
      severity: 'error',
      code: 'SPEC_GENE_PART_MISSING',
      path: ['genome', 'genes', 'eyes', 'H2'],
      message: 'An unrelated hidden eyes diagnostic remains.',
    }
    const blocked = refreshSessionValidity({
      ...before,
      generationDiagnostics: [staleVisual, staleP, staleHidden],
    })

    const next = reducer(blocked, {
      type: 'manualSelect',
      slotId: 'tail',
      partId: 'tail_manual',
    })

    expect(next.spec.visualSlots.tail.partId).toBe('tail_manual')
    expect(next.generationDiagnostics).not.toContainEqual(staleVisual)
    expect(next.generationDiagnostics).not.toContainEqual(staleP)
    expect(next.generationDiagnostics).toContainEqual(staleHidden)
    expect(next.blocked).toBe(true)
  })

  it('clears an incompatible lock diagnostic when that slot receives a compatible manual selection', () => {
    const catalog = catalogWithIncompatibleShadowEyes()
    const reducer = createCreatorReducer(catalog)
    const before = withLocked(makeSession(catalog), 'eyes')
    const blocked = reducer(before, { type: 'setTheme', themeId: 'shadow' })

    const next = reducer(blocked, {
      type: 'manualSelect',
      slotId: 'eyes',
      partId: 'eyes_shadow_compatible',
    })

    expect(next.spec.visualSlots.eyes.partId).toBe('eyes_shadow_compatible')
    expect(next.locks.eyes).toBe(true)
    expect(next.blocked).toBe(false)
    expect(next.diagnostics).toEqual([])
  })

  it('clears an incompatible lock diagnostic when the compatible theme is restored', () => {
    const catalog = catalogWithIncompatibleShadowEyes()
    const reducer = createCreatorReducer(catalog)
    const before = withLocked(makeSession(catalog), 'eyes')
    const blocked = reducer(before, { type: 'setTheme', themeId: 'shadow' })

    const next = reducer(blocked, { type: 'setTheme', themeId: 'fungal' })

    expect(next.spec.visualSlots.eyes).toEqual(before.spec.visualSlots.eyes)
    expect(next.locks.eyes).toBe(true)
    expect(next.blocked).toBe(false)
    expect(next.diagnostics).toEqual([])
  })

  it('removes a repaired descendant error after parent reroll', () => {
    const catalog = makeValidCatalogFixture()
    catalog.dependencies = { headShape: ['eyes'] }
    const reducer = createCreatorReducer(catalog)
    const diagnostic: Diagnostic = {
      severity: 'error',
      code: 'NO_COMPATIBLE_CANDIDATE',
      path: ['visualSlots', 'eyes'],
      message: 'old eyes failure',
    }
    const before = refreshSessionValidity({
      ...makeSession(catalog),
      generationDiagnostics: [diagnostic],
    })

    const after = reducer(before, { type: 'rerollSlot', slotId: 'headShape' })

    expect(after.diagnostics).not.toContainEqual(expect.objectContaining({
      path: ['visualSlots', 'eyes'],
    }))
    expect(after.blocked).toBe(false)
  })

  it('creates a new creature with reset slot rolls while retaining locked selections', () => {
    const catalog = makeValidCatalogFixture()
    const reducer = createCreatorReducer(catalog)
    const session = withLocked(makeSession(catalog), 'eyes')
    const before: CreatorSession = {
      ...session,
      spec: {
        ...session.spec,
        slotRolls: { ...session.spec.slotRolls, eyes: 4, tail: 7 },
      },
    }
    const snapshot = structuredClone(before)

    const next = reducer(before, { type: 'newCreature', seed: 'new-seed' })

    expect(next.spec.seed).toBe('new-seed')
    expect(next.spec.visualSlots.eyes).toEqual(before.spec.visualSlots.eyes)
    expect(Object.values(next.spec.slotRolls).every(value => value === 0)).toBe(true)
    expect(before).toEqual(snapshot)
  })

  it('switches generation mode through the core and preserves locked selections', () => {
    const catalog = makeValidCatalogFixture()
    const reducer = createCreatorReducer(catalog)
    const before = withLocked(makeSession(catalog), 'eyes')

    const next = reducer(before, { type: 'setMode', mode: 'mutation' })

    expect(next.spec.mutation).not.toBeNull()
    expect(next.spec.aberrations).toEqual([])
    expect(next.spec.visualSlots.eyes).toEqual(before.spec.visualSlots.eyes)
  })

  it('retains a failed mutation request across a new-creature command', () => {
    const catalog = catalogWithoutModifiers()
    const reducer = createCreatorReducer(catalog)
    const failed = reducer(makeSession(catalog), { type: 'setMode', mode: 'mutation' })

    const next = reducer(failed, { type: 'newCreature', seed: 'mutation-retry' })

    expect(next.spec.seed).toBe('mutation-retry')
    expect(next.blocked).toBe(true)
    expect(next.diagnostics).toContainEqual(expect.objectContaining({
      code: 'MODIFIER_NOT_FOUND',
      path: ['mutation'],
    }))
  })

  it('retains a failed mutation request through a local reroll and the next new creature', () => {
    const catalog = catalogWithoutModifiers()
    const reducer = createCreatorReducer(catalog)
    const failed = reducer(makeSession(catalog), { type: 'setMode', mode: 'mutation' })

    const local = reducer(failed, { type: 'rerollSlot', slotId: 'tail' })
    const next = reducer(local, { type: 'newCreature', seed: 'mutation-after-local' })

    expect(local.blocked).toBe(true)
    expect(local.diagnostics).toContainEqual(expect.objectContaining({
      code: 'MODIFIER_NOT_FOUND',
      path: ['mutation'],
    }))
    expect(next.blocked).toBe(true)
    expect(next.diagnostics).toContainEqual(expect.objectContaining({
      code: 'MODIFIER_NOT_FOUND',
      path: ['mutation'],
    }))
  })

  it('retains a failed aberration request across a theme change', () => {
    const catalog = catalogWithoutModifiers()
    const reducer = createCreatorReducer(catalog)
    const failed = reducer(makeSession(catalog), { type: 'setMode', mode: 'aberration' })

    const next = reducer(failed, { type: 'setTheme', themeId: 'shadow' })

    expect(next.spec.themeId).toBe('shadow')
    expect(next.blocked).toBe(true)
    expect(next.diagnostics).toContainEqual(expect.objectContaining({
      code: 'MODIFIER_NOT_FOUND',
      path: ['aberrations'],
    }))
  })

  it('retains a failed aberration request through manual selection and the next theme change', () => {
    const catalog = withManualTail(catalogWithoutModifiers())
    const reducer = createCreatorReducer(catalog)
    const failed = reducer(makeSession(catalog), { type: 'setMode', mode: 'aberration' })

    const local = reducer(failed, { type: 'manualSelect', slotId: 'tail', partId: 'tail_manual' })
    const next = reducer(local, { type: 'setTheme', themeId: 'shadow' })

    expect(local.spec.visualSlots.tail.partId).toBe('tail_manual')
    expect(local.blocked).toBe(true)
    expect(local.diagnostics).toContainEqual(expect.objectContaining({
      code: 'MODIFIER_NOT_FOUND',
      path: ['aberrations'],
    }))
    expect(next.blocked).toBe(true)
    expect(next.diagnostics).toContainEqual(expect.objectContaining({
      code: 'MODIFIER_NOT_FOUND',
      path: ['aberrations'],
    }))
  })

  it('clears a failed modifier request when normal mode is selected', () => {
    const catalog = catalogWithoutModifiers()
    const reducer = createCreatorReducer(catalog)
    const failed = reducer(makeSession(catalog), { type: 'setMode', mode: 'mutation' })

    const normal = reducer(failed, { type: 'setMode', mode: 'normal' })
    const next = reducer(normal, { type: 'newCreature', seed: 'normal-again' })

    expect(normal.blocked).toBe(false)
    expect(next.blocked).toBe(false)
    expect(next.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'MODIFIER_NOT_FOUND' }))
  })

  it('does not infer a mode from an unrelated diagnostic path', () => {
    const catalog = catalogWithoutModifiers()
    const reducer = createCreatorReducer(catalog)
    const normal = makeSession(catalog)
    const unrelated = refreshSessionValidity({
      ...normal,
      generationDiagnostics: [{
        severity: 'error',
        code: 'MODIFIER_NOT_FOUND',
        path: ['visualSlots', 'mutation'],
        message: 'unrelated',
      }],
    })

    const next = reducer(unrelated, { type: 'newCreature', seed: 'still-normal' })

    expect(next.blocked).toBe(false)
    expect(next.spec.mutation).toBeNull()
    expect(next.spec.aberrations).toEqual([])
    expect(next.diagnostics).toEqual([])
  })

  it('preserves warnings while replacing a repaired target-slot diagnostic', () => {
    const catalog = catalogWithIncompatibleShadowEyes()
    const reducer = createCreatorReducer(catalog)
    const before = withLocked(makeSession(catalog), 'eyes')
    const blocked = reducer(before, { type: 'setTheme', themeId: 'shadow' })
    const warning = { severity: 'warning' as const, code: 'PREVIEW_STALE', path: [], message: 'Preview is stale.' }
    const withWarning = refreshSessionValidity({
      ...blocked,
      generationDiagnostics: [warning, ...blocked.generationDiagnostics],
    })

    const next = reducer(withWarning, {
      type: 'manualSelect',
      slotId: 'eyes',
      partId: 'eyes_shadow_compatible',
    })

    expect(next.diagnostics).toEqual([warning])
    expect(next.blocked).toBe(false)
  })

  it('retains two catalog diagnostics with equal code and path but distinct messages after a local reroll', () => {
    const catalog = catalogWithTwoDanglingExcludes()
    const reducer = createCreatorReducer(catalog)
    const before = makeSession(catalog)

    const next = reducer(before, { type: 'rerollSlot', slotId: 'tail' })
    const dangling = next.diagnostics.filter(diagnostic => diagnostic.code === 'CATALOG_DANGLING_EXCLUDE')

    expect(dangling).toHaveLength(2)
    expect(dangling.map(diagnostic => diagnostic.message)).toEqual([
      `Part ${catalog.parts[0]!.id} excludes unknown part missing_a.`,
      `Part ${catalog.parts[0]!.id} excludes unknown part missing_b.`,
    ])
  })

  it('retains both distinct missing-part diagnostics from consecutive failed manual selections', () => {
    const catalog = makeValidCatalogFixture()
    const reducer = createCreatorReducer(catalog)
    const before = makeSession(catalog)

    const missingA = reducer(before, { type: 'manualSelect', slotId: 'tail', partId: 'missing_a' })
    const missingB = reducer(missingA, { type: 'manualSelect', slotId: 'tail', partId: 'missing_b' })
    const missing = missingB.diagnostics.filter(diagnostic => diagnostic.code === 'PART_NOT_FOUND')

    expect(missing).toHaveLength(2)
    expect(missing.map(diagnostic => diagnostic.message)).toEqual([
      'Part missing_a cannot be selected for tail.',
      'Part missing_b cannot be selected for tail.',
    ])
  })

  it('stably deduplicates a completely identical diagnostic', () => {
    const catalog = makeValidCatalogFixture()
    const reducer = createCreatorReducer(catalog)
    const before = makeSession(catalog)

    const missingOnce = reducer(before, { type: 'manualSelect', slotId: 'tail', partId: 'missing_a' })
    const missingTwice = reducer(missingOnce, { type: 'manualSelect', slotId: 'tail', partId: 'missing_a' })

    expect(missingTwice.diagnostics.filter(diagnostic =>
      diagnostic.code === 'PART_NOT_FOUND'
      && diagnostic.message === 'Part missing_a cannot be selected for tail.',
    )).toHaveLength(1)
  })

  it('merges a new local error without dropping a global mode blocker', () => {
    const catalog = catalogWithoutModifiers()
    const reducer = createCreatorReducer(catalog)
    const failed = reducer(makeSession(catalog), { type: 'setMode', mode: 'mutation' })
    const lockedTail = withLocked(failed, 'tail')

    const next = reducer(lockedTail, { type: 'rerollSlot', slotId: 'tail' })

    expect(next.diagnostics).toContainEqual(expect.objectContaining({
      code: 'MODIFIER_NOT_FOUND',
      path: ['mutation'],
    }))
    expect(next.diagnostics).toContainEqual(expect.objectContaining({
      code: 'SLOT_LOCKED',
      path: ['visualSlots', 'tail'],
    }))
    expect(next.blocked).toBe(true)
  })

  it('conservatively retains an unknown target-slot error after a local command', () => {
    const catalog = makeValidCatalogFixture()
    const reducer = createCreatorReducer(catalog)
    const before = makeSession(catalog)
    const unknown = {
      severity: 'error' as const,
      code: 'FUTURE_SLOT_ERROR',
      path: ['visualSlots', 'tail'],
      message: 'A future validator owns this error.',
    }
    const blocked = refreshSessionValidity({ ...before, generationDiagnostics: [unknown] })

    const next = reducer(blocked, { type: 'rerollSlot', slotId: 'tail' })

    expect(next.diagnostics).toContainEqual(unknown)
    expect(next.blocked).toBe(true)
  })

  it('rerolls and manually selects through immutable core commands', () => {
    const catalog = makeValidCatalogFixture()
    const eyes = catalog.parts.find(part => part.slotId === 'eyes')!
    const tail = catalog.parts.find(part => part.slotId === 'tail' && !part.id.endsWith('_none'))!
    catalog.parts.push(
      { ...eyes, id: 'eyes_second' },
      { ...tail, id: 'tail_manual', baseWeight: 0 },
    )
    const reducer = createCreatorReducer(catalog)
    const before = makeSession(catalog)
    const snapshot = structuredClone(before)

    const rerolled = reducer(before, { type: 'rerollSlot', slotId: 'eyes' })
    const selected = reducer(rerolled, { type: 'manualSelect', slotId: 'tail', partId: 'tail_manual' })

    expect(rerolled.spec.slotRolls.eyes).toBe(before.spec.slotRolls.eyes + 1)
    expect(selected.spec.visualSlots.tail.partId).toBe('tail_manual')
    expect(before).toEqual(snapshot)
  })

  it('keeps dominant genes synchronized through reducer edit commands', () => {
    const catalog = makeValidCatalogFixture()
    const eyes = catalog.parts.find(part => part.slotId === 'eyes')!
    const tail = catalog.parts.find(part => part.slotId === 'tail' && !part.id.endsWith('_none'))!
    catalog.parts.push(
      { ...eyes, id: 'eyes_second_genome' },
      { ...tail, id: 'tail_manual_genome', baseWeight: 0 },
    )
    const reducer = createCreatorReducer(catalog)
    const before = makeSession(catalog)
    const snapshot = structuredClone(before.spec)

    const rerolled = reducer(before, { type: 'rerollSlot', slotId: 'eyes' })
    const selected = reducer(rerolled, {
      type: 'manualSelect',
      slotId: 'tail',
      partId: 'tail_manual_genome',
    })

    for (const slotId of VISUAL_SLOT_IDS) {
      expect(selected.spec.genome!.genes[slotId].P).toBe(selected.spec.visualSlots[slotId].partId)
    }
    expect(before.spec).toEqual(snapshot)
  })

  it('toggles a lock without mutating the previous lock record', () => {
    const catalog = makeValidCatalogFixture()
    const reducer = createCreatorReducer(catalog)
    const before = makeSession(catalog)

    const next = reducer(before, { type: 'toggleLock', slotId: 'eyes' })

    expect(next.locks.eyes).toBe(true)
    expect(before.locks.eyes).toBe(false)
    expect(next.locks).not.toBe(before.locks)
    expect(next.spec).toBe(before.spec)
  })

  it('deep-clones an imported spec and clears every editor lock', () => {
    const catalog = makeValidCatalogFixture()
    const reducer = createCreatorReducer(catalog)
    const before = refreshSessionValidity({
      ...withLocked(makeSession(catalog), ...VISUAL_SLOT_IDS),
      generationDiagnostics: [{ severity: 'error', code: 'OLD', path: [], message: 'old' }],
    })
    const imported: MonsterSpec = {
      ...makeSession(catalog, { seed: 'imported' }).spec,
      palette: { primary: '#111111', secondary: '#222222', accent: '#333333' },
    }

    const next = reducer(before, { type: 'importSpec', spec: imported })
    imported.palette.primary = '#ffffff'
    imported.visualSlots.eyes.partId = 'mutated-after-import'

    expect(next.spec.palette.primary).toBe('#111111')
    expect(next.spec.visualSlots.eyes.partId).not.toBe('mutated-after-import')
    expect(next.spec).not.toBe(imported)
    expect(next.locks).toEqual(unlockedSlots())
    expect(next.diagnostics).toEqual([])
    expect(next.blocked).toBe(false)
  })
})
