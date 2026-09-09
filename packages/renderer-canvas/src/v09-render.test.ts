import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { V09_COMPOSITION_NODE_IDS, V09_TRAIT_SLOT_IDS, V09_VERSION_TUPLE, type MonsterSpecV09, type ResolvedV09Catalog, type PngResourceRef } from '@qmonster/generator-core'
import * as renderer from './index.js'

let counter = 0
const png = (): PngResourceRef => { const sha256 = (++counter).toString(16).padStart(64, '0'); return { resourceId: `sha256:${sha256}` as any, sha256, mediaType: 'image/png', width: 2048, height: 2048 } }
const json = () => { const { width, height, ...ref } = png(); return { ...ref, mediaType: 'application/qmonster-material-v1+json' as const } }
const rgba = (pixel = [0, 0, 0, 0]) => { const result = new Uint8Array(2048 * 2048 * 4); result.set(pixel); return result }
function fixture() {
  const graph = { schemaVersion: 'qmonster-composition-graph-v1', orderedNodes: [...V09_COMPOSITION_NODE_IDS], blendMode: 'source-over-premultiplied-srgb', transformPolicy: 'identity-only' }
  const neutral = png(); const map = png(); const mask = png(); const templateRef = json()
  const family = { schemaVersion: 'qmonster-skeleton-family-v1', skeletonFamilyId: 'base', skeletonClass: 'base', speciesRigId: 'feline-sit-v2', archetypeId: 'feline', poseId: 'sit', structuralShapeClasses: ['feline-standard'], canvas: { width: 2048, height: 2048 }, neutralMaster: neutral, materialMap: map, fixedOccluderMasks: { fixed: mask }, assemblyTemplateId: 'template-base' }
  const template = { schemaVersion: 'qmonster-assembly-template-v1', assemblyTemplateId: 'template-base', skeletonFamilyId: 'base', neutralMasterSha256: neutral.sha256, materialRegistry: { fur: 7 }, canvas: { width: 2048, height: 2048 }, compositionGraph: graph, slots: {
    surface: V09_TRAIT_SLOT_IDS.slice(0, 6).map(slotId => ({ kind: 'surface', slotId, ownerMaterialId: 'fur', authoringZone: mask })),
    embedded: [ { kind: 'eyePair', slotId: 'eyes', leftAuthoringZone: mask, rightAuthoringZone: mask, pairAuthoringZone: mask, occlusionReplayZone: mask }, { kind: 'mouth', slotId: 'mouthShape', authoringZone: mask, occlusionReplayZone: mask }, { kind: 'oralDetail', slotId: 'oralDetail', closedMouthSentinel: 'oral-none', socketRegistry: { open: { authoringZone: mask, parentMouthTraitIds: ['mouthShape-trait'] }, 'oral-none': { authoringZone: mask, parentMouthTraitIds: ['mouthShape-trait'] } } } ],
    attachment: ['headAppendage', 'extraAppendage'].map(slotId => ({ kind: 'attachment', slotId, attachmentInterface: { interfaceId: slotId, allowedShapeClasses: ['ear-horn-small'], allowedZone: mask, rearRootStencil: mask, frontRootStencil: mask, fixedOccluderMaskId: 'fixed' } })),
    effect: [{ kind: 'ambientEffect', slotId: 'effect', zoneId: 'background', authoringZone: mask, compositionNode: 'backgroundEffect' }],
  } }
  const traits = V09_TRAIT_SLOT_IDS.map(slotId => {
    const base = { schemaVersion: 'qmonster-sealed-trait-v1', slotId, traitId: `${slotId}-trait`, rarity: 'common', skeletonFamilyId: 'base', assemblyTemplateId: 'template-base', assemblyTemplateSha256: templateRef.sha256, neutralMasterSha256: neutral.sha256, authoringInputs: [mask], fullContextPreview: png(), sealerVersion: '0.9.0' }
    if (slotId === 'eyes') return { ...base, kind: 'eyePair', runtimeResources: { underlay: png(), content: png() } }
    if (slotId === 'mouthShape') return { ...base, kind: 'mouth', oralSocketClass: 'open', runtimeResources: { mouthBack: png(), mouthFront: png() } }
    if (slotId === 'oralDetail') return { ...base, kind: 'oralDetail', runtimeResources: { oralProjection: png() } }
    if (slotId === 'headAppendage' || slotId === 'extraAppendage') return { ...base, kind: 'attachment', interfaceId: slotId, shapeClass: 'ear-horn-small', runtimeResources: { attachmentBehind: png(), attachmentFront: png() } }
    if (slotId === 'effect') return { ...base, kind: 'ambientEffect', zoneId: 'background', runtimeResources: { effectLayer: png() } }
    return { ...base, kind: 'surface', runtimeResources: { materialOperation: json() } }
  })
  const manifest = { schemaVersion: 'qmonster-release-v1', versionTuple: V09_VERSION_TUPLE, speciesRig: json(), skeletonPool: json(), skeletonFamilies: [json()], assemblyTemplates: [templateRef], approvals: [], traitApprovals: [], traitInventory: json(), sealedTraits: traits.map(json), compositionGraph: json(), rendererBuildSha256: 'f'.repeat(64) }
  const catalog = { releaseManifestSha256: 'e'.repeat(64), releaseManifest: manifest, speciesRig: manifest.speciesRig, skeletonPool: { schemaVersion: 'qmonster-skeleton-pool-v1', skeletonPoolId: 'pool', candidates: [{ skeletonFamilyId: 'base', skeletonClass: 'base', weight: 8 }, { skeletonFamilyId: 'legendary', skeletonClass: 'legendary', weight: 1 }] }, skeletonFamilies: [family], assemblyTemplates: [template], sealedTraits: traits, compositionGraph: graph } as unknown as ResolvedV09Catalog
  const spec = { ...V09_VERSION_TUPLE, seed: 'fixed-600', speciesRigId: 'feline-sit-v2', skeletonFamilyId: 'base', assemblyTemplateId: 'template-base', skeletonSelection: { class: 'base', candidateId: 'base', roll: 0 }, visualSlots: Object.fromEntries(V09_TRAIT_SLOT_IDS.map(slot => [slot, { traitId: `${slot}-trait`, rarity: 'common', roll: 0 }])) } as MonsterSpecV09
  const generated: Uint8Array[] = []; const draws: unknown[][] = []; const events: unknown[][] = []
  const context = { canvas: { width: 2048, height: 2048 }, globalAlpha: 1, filter: 'none', shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0, getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }), setTransform: (...args: unknown[]) => events.push(['transform', ...args]), drawImage: (...args: unknown[]) => { draws.push(args); events.push(['draw', ...args, context.globalCompositeOperation, context.globalAlpha]) }, globalCompositeOperation: 'source-over' } as unknown as CanvasRenderingContext2D
  const resolver = {
    resolvePng: async (ref: PngResourceRef) => ({ sha256: ref.sha256, width: 2048 as const, height: 2048 as const, pixels: ref.resourceId === neutral.resourceId ? rgba([100, 100, 100, 99]) : ref.resourceId === map.resourceId ? rgba([7, 0, 0, 255]) : ref.resourceId === mask.resourceId ? rgba([0, 0, 0, 255]) : rgba(), drawable: { id: ref.resourceId } as unknown as CanvasImageSource }),
    resolveJson: async (ref: { sha256: string }) => ({ sha256: ref.sha256, value: { schemaVersion: 'qmonster-material-v1', ownerMaterialId: 'fur', colorLut: Array.from({ length: 256 }, () => [180, 60, 20, 255]).flat(), alphaPolicy: 'preserve-skeleton-alpha', blendMode: 'replace-color' } }),
    createDrawable: async (pixels: Uint8Array, width: 2048, height: 2048) => { expect([width, height]).toEqual([2048, 2048]); generated.push(pixels.slice()); return { generated: generated.length } as unknown as CanvasImageSource },
  }
  return { catalog, spec, template, traits, family, resolver, context, generated, draws, events }
}

describe('v0.9 fixed composite and renderer', () => {
  it('exports independent composite and rendering entry points', () => { expect(renderer).toHaveProperty('resolveV09Composite', expect.any(Function)); expect(renderer).toHaveProperty('renderMonsterV09', expect.any(Function)) })
  it.each(['missing', 'duplicate', 'cross-family', 'cross-template', 'wrong-rarity', 'wrong-slot', 'wrong-kind'])('rejects %s selected projection', mode => {
    const f = fixture(); const trait: any = f.catalog.sealedTraits[6]
    if (mode === 'missing') f.catalog.sealedTraits.splice(6, 1)
    if (mode === 'duplicate') f.catalog.sealedTraits.push(trait)
    if (mode === 'cross-family') trait.skeletonFamilyId = 'legendary'
    if (mode === 'cross-template') trait.assemblyTemplateId = 'other'
    if (mode === 'wrong-rarity') trait.rarity = 'rare'
    if (mode === 'wrong-slot') trait.slotId = 'effect'
    if (mode === 'wrong-kind') trait.kind = 'surface'
    expect(() => renderer.resolveV09Composite(f.spec, f.catalog)).toThrowError(expect.objectContaining({ code: mode === 'wrong-kind' || mode === 'wrong-slot' ? (mode === 'wrong-slot' ? 'SKELETON_PROJECTION_MISSING' : 'TRAIT_SLOT_INCOMPATIBLE') : 'SKELETON_PROJECTION_MISSING' }))
  })
  it.each(['missing', 'duplicate', 'range', 'blank', 'surface-owner'])('rejects template registry %s', mode => {
    const f = fixture(); const template: any = f.template
    if (mode === 'missing') delete template.materialRegistry
    if (mode === 'duplicate') template.materialRegistry.nose = 7
    if (mode === 'range') template.materialRegistry.fur = -1
    if (mode === 'blank') template.materialRegistry[' '] = 8
    if (mode === 'surface-owner') template.slots.surface[0].ownerMaterialId = 'missing'
    expect(() => renderer.resolveV09Composite(f.spec, f.catalog)).toThrowError(expect.objectContaining({ code: 'SURFACE_OWNER_VIOLATION' }))
  })
  it.each(['reorder', 'missing', 'extra', 'blend', 'transform'])('rejects graph %s', mode => {
    const f = fixture(); const graph: any = f.template.compositionGraph
    if (mode === 'reorder') graph.orderedNodes.reverse()
    if (mode === 'missing') graph.orderedNodes.pop()
    if (mode === 'extra') graph.orderedNodes.push('free-layer')
    if (mode === 'blend') graph.blendMode = 'multiply'
    if (mode === 'transform') graph.transformPolicy = 'scale'
    expect(() => renderer.resolveV09Composite(f.spec, f.catalog)).toThrowError(expect.objectContaining({ code: mode === 'transform' ? 'NON_IDENTITY_TRANSFORM' : 'COMPOSITION_GRAPH_MISMATCH' }))
  })
  it('strictly rejects tuple mismatch and extra spec placement', () => {
    const f = fixture(); expect(() => renderer.resolveV09Composite({ ...f.spec, generatorVersion: '0.8.0' } as any, f.catalog)).toThrowError(expect.objectContaining({ code: 'VERSION_TUPLE_MISMATCH' }))
    expect(() => renderer.resolveV09Composite({ ...f.spec, anchor: [1, 2] } as any, f.catalog)).toThrow()
  })
  it('accepts oral-none only for closed mouths and emits no oral raster', () => {
    const f = fixture(); f.spec.visualSlots.oralDetail.traitId = 'oral-none'
    expect(() => renderer.resolveV09Composite(f.spec, f.catalog)).toThrowError(expect.objectContaining({ code: 'TRAIT_SLOT_INCOMPATIBLE' }))
    ;(f.catalog.sealedTraits[7] as any).oralSocketClass = 'closed'
    const composite = renderer.resolveV09Composite(f.spec, f.catalog); expect(composite.orderedNodes.oralDetail).toEqual([])
    f.spec.visualSlots.oralDetail.traitId = 'oralDetail-trait'
    expect(() => renderer.resolveV09Composite(f.spec, f.catalog)).toThrowError(expect.objectContaining({ code: 'TRAIT_SLOT_INCOMPATIBLE' }))
  })
  it('resolves exact selected traits, all nodes, deterministic trace and one materialized skeleton', async () => {
    const f = fixture(); const composite = renderer.resolveV09Composite(f.spec, f.catalog)
    expect(Object.keys(composite.orderedNodes)).toEqual([...V09_COMPOSITION_NODE_IDS])
    expect(composite.orderedNodes['eyePair.content']).toEqual([f.traits[6]!.runtimeResources.content])
    const first = await renderer.renderMonsterV09(f.context, composite, f.resolver)
    const second = await renderer.renderMonsterV09(f.context, composite, f.resolver)
    expect(first.trace).toEqual([...V09_COMPOSITION_NODE_IDS]); expect(second.trace).toEqual(first.trace)
    expect(f.generated).toHaveLength(8)
    expect([...f.generated[0]!.slice(0, 4)]).toEqual([180, 60, 20, 99])
    for (const pixels of f.generated) { expect([...pixels.slice(0, 4)]).toEqual([180, 60, 20, 99]); expect([...pixels.slice(4, 8)]).toEqual([0, 0, 0, 0]) }
    for (const args of f.draws) expect(args.slice(1)).toEqual([0, 0])
    for (let i = 0; i < f.events.length; i += 2) { expect(f.events[i]).toEqual(['transform', 1, 0, 0, 1, 0, 0]); expect(f.events[i + 1]!.slice(-2)).toEqual(['source-over', 1]) }
    expect(f.draws.slice(0, f.draws.length / 2)).toHaveLength(14)
  })
  it.each(['failure', 'hash', 'size', 'mask', 'transform'])('preflights %s before any destination draws', async mode => {
    const f = fixture(); const resolvePng = f.resolver.resolvePng
    f.resolver.resolvePng = async ref => { const value = await resolvePng(ref); if (mode === 'failure') throw new Error('offline'); if (mode === 'hash') value.sha256 = '0'.repeat(64); if (mode === 'size') value.width = 32 as any; if (mode === 'mask' && ref === undefined) throw new Error('unreachable'); if (mode === 'mask' && ref.sha256 === f.family.fixedOccluderMasks.fixed.sha256) value.pixels[0] = 2; return value }
    if (mode === 'transform') f.context.getTransform = () => ({ a: 2, b: 0, c: 0, d: 1, e: 0, f: 0 } as DOMMatrix)
    await expect(renderer.renderMonsterV09(f.context, renderer.resolveV09Composite(f.spec, f.catalog), f.resolver)).rejects.toThrow()
    expect(f.draws).toEqual([])
  })
  it('rejects arbitrary replay source and trait-owned masks', async () => {
    const f = fixture(); const composite = renderer.resolveV09Composite(f.spec, f.catalog)
    const forged = { ...composite, orderedNodes: { ...composite.orderedNodes, 'eyePair.edgeOcclusionReplay': [png()] } }
    await expect(renderer.renderMonsterV09(f.context, forged, f.resolver)).rejects.toThrowError(expect.objectContaining({ code: 'UNREGISTERED_ALPHA_SOURCE' }))
    ;(f.catalog.sealedTraits[6]!.runtimeResources as any).occlusionMask = png()
    expect(() => renderer.resolveV09Composite(f.spec, f.catalog)).toThrow()
    expect(f.draws).toEqual([])
  })
  it('has no legacy placement or dynamic-layer dependency', () => {
    const source = readFileSync(new URL('./v09-render.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/resolvePartPlacement|connector-solver|attachment-tree|bridge-mesh|species-rig-render|from ['"]\.\/render\.js|expandRenderLayers/)
  })
  it.each(['foreground', 'underlay', 'overlay'])('routes %s effects only to their declared frozen node', async mode => {
    const f = fixture(); const effect: any = f.catalog.sealedTraits[11]
    const node = mode === 'foreground' ? 'foregroundAmbientEffect' : mode === 'underlay' ? 'targetedEffect.underlay' : 'targetedEffect.overlay'
    if (mode === 'foreground') { effect.zoneId = 'foreground'; Object.assign(f.template.slots.effect[0]!, { zoneId: 'foreground', compositionNode: node }) }
    else { delete effect.zoneId; effect.kind = 'targetedEffect'; effect.targetId = 'breath'; f.template.slots.effect = [{ kind: 'targetedEffect', slotId: 'effect', targetId: 'breath', authoringZone: png(), compositionNode: node }] as any }
    const composite = renderer.resolveV09Composite(f.spec, f.catalog)
    expect(composite.orderedNodes[node]).toEqual([effect.runtimeResources.effectLayer])
    expect(composite.orderedNodes.backgroundEffect).toEqual([])
    await renderer.renderMonsterV09(f.context, composite, f.resolver)
    const effectDraw = f.draws.findIndex(args => (args[0] as any).id === effect.runtimeResources.effectLayer.resourceId)
    const eyeDraw = f.draws.findIndex(args => (args[0] as any).id === f.traits[6]!.runtimeResources.underlay!.resourceId)
    expect(effectDraw > eyeDraw).toBe(mode !== 'underlay')
  })
  it('replays the fully colored and patterned fur byte for byte at all three edges', async () => {
    const f = fixture(); const original = f.resolver.resolveJson
    f.resolver.resolveJson = async ref => {
      const value = await original(ref); const index = f.traits.findIndex(trait => trait.runtimeResources.materialOperation?.sha256 === ref.sha256)
      value.value.colorLut = Array.from({ length: 256 }, () => index === 0 ? [180, 60, 20, 255] : index === 1 ? [128, 255, 0, 255] : [0, 0, 0, 0]).flat()
      if (index === 1) value.value.blendMode = 'multiply'
      return value
    }
    await renderer.renderMonsterV09(f.context, renderer.resolveV09Composite(f.spec, f.catalog), f.resolver)
    for (const pixels of f.generated) expect([...pixels.slice(0, 4)]).toEqual([90, 60, 0, 99])
  })
  it('does not replay a nontransparent skeleton pixel outside any edge mask', async () => {
    const f = fixture(); const original = f.resolver.resolvePng
    f.resolver.resolvePng = async ref => {
      const value = await original(ref)
      if (ref.sha256 === f.family.neutralMaster.sha256) value.pixels.set([33, 44, 55, 77], 4)
      if (ref.sha256 === f.family.materialMap.sha256) value.pixels.set([7, 0, 0, 255], 4)
      return value
    }
    await renderer.renderMonsterV09(f.context, renderer.resolveV09Composite(f.spec, f.catalog), f.resolver)
    expect([...f.generated[0]!.slice(4, 8)]).toEqual([180, 60, 20, 77])
    for (const pixels of f.generated.slice(1)) expect([...pixels.slice(4, 8)]).toEqual([0, 0, 0, 0])
  })
  it('keeps resolved ownership immutable when the source catalog is edited', async () => {
    const f = fixture(); const composite = renderer.resolveV09Composite(f.spec, f.catalog)
    ;(f.template.slots.embedded[0] as any).occlusionReplayZone = png()
    f.family.neutralMaster = png()
    expect(Object.isFrozen(composite.orderedNodes['eyePair.content'])).toBe(true)
    await renderer.renderMonsterV09(f.context, composite, f.resolver)
    expect(f.draws).toHaveLength(14)
  })
  it.each(['json-hash', 'json-failure', 'wrong-owner', 'factory-failure', 'resolver-transform', 'nonbinary-mask'])('rejects %s without drawing a partial frame', async mode => {
    const f = fixture(); const original = f.resolver.resolveJson
    if (mode === 'json-hash') f.resolver.resolveJson = async ref => ({ ...await original(ref), sha256: 'b'.repeat(64) })
    if (mode === 'json-failure') f.resolver.resolveJson = async () => { throw new Error('bad JSON') }
    if (mode === 'wrong-owner') f.resolver.resolveJson = async ref => { const value = await original(ref); value.value.ownerMaterialId = 'elsewhere'; return value }
    if (mode === 'factory-failure') f.resolver.createDrawable = async () => { throw new Error('allocation failed') }
    if (mode === 'resolver-transform') (f.resolver as any).transform = [2, 0, 0, 1, 0, 0]
    if (mode === 'nonbinary-mask') { const originalPng = f.resolver.resolvePng; f.resolver.resolvePng = async ref => { const value = await originalPng(ref); if (ref.sha256 === f.family.fixedOccluderMasks.fixed.sha256) value.pixels[3] = 128; return value } }
    await expect(renderer.renderMonsterV09(f.context, renderer.resolveV09Composite(f.spec, f.catalog), f.resolver)).rejects.toThrowError(expect.objectContaining({ code: mode === 'factory-failure' ? 'RESOURCE_MATERIALIZATION_FAILED' : mode === 'resolver-transform' ? 'NON_IDENTITY_TRANSFORM' : mode === 'nonbinary-mask' ? 'UNREGISTERED_ALPHA_SOURCE' : mode === 'wrong-owner' ? 'SURFACE_OWNER_VIOLATION' : 'RESOURCE_HASH_MISMATCH' }))
    expect(f.draws).toEqual([])
  })
  it('rejects a manifest-JSON resource used in the material operation role', () => {
    const f = fixture(); (f.catalog.sealedTraits[0] as any).runtimeResources.materialOperation.mediaType = 'application/qmonster-manifest-v1+json'
    expect(() => renderer.resolveV09Composite(f.spec, f.catalog)).toThrowError(expect.objectContaining({ code: 'TRAIT_SLOT_INCOMPATIBLE' }))
  })
  it('draws shared attachment content at most once at its owned node', async () => {
    const f = fixture(); const head = f.catalog.sealedTraits[9] as any; const extra = f.catalog.sealedTraits[10] as any
    extra.runtimeResources.attachmentBehind = head.runtimeResources.attachmentBehind
    const composite = renderer.resolveV09Composite(f.spec, f.catalog)
    await renderer.renderMonsterV09(f.context, composite, f.resolver)
    expect(f.draws.filter(args => (args[0] as any).id === head.runtimeResources.attachmentBehind.resourceId)).toHaveLength(1)
  })
})
