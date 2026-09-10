import { access, readFile, readdir } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { generateMonsterV09, V09_TRAIT_SLOT_IDS, type ResolvedV09Catalog, type SealedTraitArtifactV1 } from '@qmonster/generator-core'
import { canonicalJsonSha256 } from '@qmonster/asset-catalog'
import {
  FELINE_TRAIT_DEFINITIONS,
  buildFelineTraitInventory,
  paintAttachmentSilhouette,
  reportCopyMatches,
  validatePreparedFelineTraits,
} from './prepare-v09-feline-traits.js'
import { approvalBindingErrors } from './prepare-v09-feline-masters.js'

const EXPECTED_IDS = {
  bodyColor: {
    common: ['body-color-lime-mint', 'body-color-coral-cream', 'body-color-ocean-blue', 'body-color-honey-gold', 'body-color-lavender-mist', 'body-color-rose-quartz', 'body-color-forest-moss', 'body-color-cloud-gray'],
    rare: ['body-color-ember-glow', 'body-color-arctic-teal', 'body-color-dusk-violet', 'body-color-sunburst'],
    legendary: ['body-color-aurora-prism'],
  },
  surfacePattern: {
    common: ['pattern-soft-tabby', 'pattern-cloud-spots', 'pattern-saddle-patch', 'pattern-sock-points', 'pattern-ripple-stripes', 'pattern-freckle-dust', 'pattern-mask-cap', 'pattern-dorsal-line'],
    rare: ['pattern-constellation', 'pattern-koi-marble', 'pattern-ember-rosette', 'pattern-moon-rings'],
    legendary: ['pattern-celestial-map'],
  },
  surfaceTexture: {
    common: ['texture-short-plush', 'texture-velvet', 'texture-woolly', 'texture-satin', 'texture-downy', 'texture-tousled', 'texture-corduroy', 'texture-suede'],
    rare: ['texture-crystal-fur', 'texture-mossy', 'texture-pearl-sheen', 'texture-frosted'],
    legendary: ['texture-starlight-pile'],
  },
  forepawDetail: {
    common: ['forepaw-mitten-tips', 'forepaw-toe-beans', 'forepaw-soft-socks', 'forepaw-dipped-toes', 'forepaw-double-bands', 'forepaw-speckled', 'forepaw-cream-cuffs', 'forepaw-shadow-cuffs'],
    rare: ['forepaw-ember-claws', 'forepaw-crystal-caps', 'forepaw-moon-sigils', 'forepaw-vine-wraps'],
    legendary: ['forepaw-star-gauntlets'],
  },
  hindpawDetail: {
    common: ['hindpaw-heel-socks', 'hindpaw-toe-beans', 'hindpaw-dipped-heels', 'hindpaw-soft-bands', 'hindpaw-speckled', 'hindpaw-cream-boots', 'hindpaw-shadow-boots', 'hindpaw-leaf-marks'],
    rare: ['hindpaw-ember-spurs', 'hindpaw-crystal-caps', 'hindpaw-moon-sigils', 'hindpaw-vine-wraps'],
    legendary: ['hindpaw-star-greaves'],
  },
  tailSurface: {
    common: ['tail-surface-ringed', 'tail-surface-dipped-tip', 'tail-surface-dorsal-stripe', 'tail-surface-soft-bands', 'tail-surface-speckled', 'tail-surface-gradient', 'tail-surface-leaf-marks', 'tail-surface-cloud-marks'],
    rare: ['tail-surface-ember-rings', 'tail-surface-crystal-bands', 'tail-surface-moon-trail', 'tail-surface-koi-marble'],
    legendary: ['tail-surface-constellation'],
  },
  eyes: {
    common: ['eyes-round-amber', 'eyes-round-aqua', 'eyes-soft-green', 'eyes-sleepy-violet', 'eyes-wide-blue', 'eyes-warm-hazel', 'eyes-button-black', 'eyes-rose-gold'],
    rare: ['eyes-heterochromia', 'eyes-crystal-facet', 'eyes-moon-slit', 'eyes-ember-ring'],
    legendary: ['eyes-nebula-pair'],
  },
  mouthShape: {
    common: ['mouth-soft-smile', 'mouth-petite-pout', 'mouth-open-cheer', 'mouth-tiny-yawn', 'mouth-narrow-grin', 'mouth-narrow-mew', 'mouth-wide-laugh', 'mouth-wide-surprise'],
    rare: ['mouth-fanged-smirk', 'mouth-heart-open', 'mouth-royal-wide', 'mouth-serene-closed'],
    legendary: ['mouth-celestial-roar'],
  },
  oralDetail: {
    common: ['oral-pink-tongue', 'oral-curl-tongue', 'oral-tiny-fangs', 'oral-pearl-teeth', 'oral-berry-tongue', 'oral-heart-tongue', 'oral-soft-palate', 'oral-milk-teeth'],
    rare: ['oral-crystal-fangs', 'oral-ember-tongue', 'oral-moon-teeth', 'oral-flower-tongue'],
    legendary: ['oral-starlight-breath'],
  },
  headAppendage: {
    common: ['head-tiny-horn', 'head-leaf-clip', 'head-ribbon-pin', 'head-bell-buds', 'head-shell-pin', 'head-feather-clip', 'head-flower-pin', 'head-moon-pin'],
    rare: ['head-crystal-horns', 'head-gilded-ornament', 'head-ember-horns', 'head-aurora-ornament'],
    legendary: ['head-celestial-crownlet'],
  },
  extraAppendage: {
    common: ['extra-soft-collar', 'extra-bell-collar', 'extra-leaf-collar', 'extra-ribbon-collar', 'extra-small-mane', 'extra-cloud-mane', 'extra-bead-collar', 'extra-moon-collar'],
    rare: ['extra-crystal-collar', 'extra-ember-mane', 'extra-royal-mane', 'extra-aurora-collar'],
    legendary: ['extra-celestial-mane'],
  },
  effect: {
    common: ['effect-soft-glow', 'effect-dust-motes', 'effect-leaf-drift', 'effect-bubble-halo', 'effect-heart-spark', 'effect-moon-motes', 'effect-warm-breath', 'effect-cloud-puff'],
    rare: ['effect-ember-orbit', 'effect-crystal-spark', 'effect-aurora-ribbon', 'effect-flower-burst'],
    legendary: ['effect-celestial-aura'],
  },
} as const

const MOUTH_SOCKET_BY_ID = new Map([
  ['mouth-soft-smile', 'oral-none'], ['mouth-petite-pout', 'oral-none'], ['mouth-serene-closed', 'oral-none'],
  ['mouth-open-cheer', 'open'], ['mouth-tiny-yawn', 'open'], ['mouth-heart-open', 'open'],
  ['mouth-narrow-grin', 'narrow'], ['mouth-narrow-mew', 'narrow'], ['mouth-fanged-smirk', 'narrow'],
  ['mouth-wide-laugh', 'wide'], ['mouth-wide-surprise', 'wide'], ['mouth-royal-wide', 'wide'], ['mouth-celestial-roar', 'wide'],
])

describe('v0.9 feline trait production', () => {
  it('freezes exactly 8/4/1 independently named semantic traits in every slot', () => {
    const inventory = buildFelineTraitInventory()
    expect(Object.keys(FELINE_TRAIT_DEFINITIONS)).toEqual(V09_TRAIT_SLOT_IDS)
    expect(inventory.schemaVersion).toBe('qmonster-trait-inventory-v1')
    expect(inventory.traits).toHaveLength(156)
    for (const slotId of V09_TRAIT_SLOT_IDS) {
      const actual = inventory.traits.filter(trait => trait.slotId === slotId)
      expect(actual.filter(trait => trait.rarity === 'common').map(trait => trait.traitId)).toEqual([...EXPECTED_IDS[slotId].common])
      expect(actual.filter(trait => trait.rarity === 'rare').map(trait => trait.traitId)).toEqual([...EXPECTED_IDS[slotId].rare])
      expect(actual.filter(trait => trait.rarity === 'legendary').map(trait => trait.traitId)).toEqual([...EXPECTED_IDS[slotId].legendary])
    }
    expect(new Set(inventory.traits.map(trait => `${trait.slotId}:${trait.traitId}`)).size).toBe(156)
  })

  it('contains no forbidden structural semantics or runtime placement fields', () => {
    const serialized = JSON.stringify(buildFelineTraitInventory())
    expect(serialized).not.toMatch(/fish[-_ ]?tail|multi[-_ ]?head|extra[-_ ]?limb|bodyFrame|headShape/i)
    expect(serialized).not.toMatch(/"(?:anchor|transform|crop|zIndex|path|url)"/i)
  })

  it('maps all thirteen mouth traits exhaustively to three open sockets or oral-none', () => {
    const mouths = buildFelineTraitInventory().traits.filter(trait => trait.slotId === 'mouthShape')
    expect(mouths).toHaveLength(13)
    expect(MOUTH_SOCKET_BY_ID.size).toBe(13)
    expect(mouths.map(trait => [trait.traitId, trait.oralSocketClass])).toEqual(
      mouths.map(trait => [trait.traitId, MOUTH_SOCKET_BY_ID.get(trait.traitId)]),
    )
    expect(new Set(mouths.map(trait => trait.oralSocketClass))).toEqual(new Set(['oral-none', 'open', 'narrow', 'wide']))
  })

  it('authors local root-grown attachment silhouettes instead of blanketing allowed zones', async () => {
    const decode = async (name: string) => sharp(`asset-source/v0.9.0/feline/templates/feline-sit-v2-core/${name}.png`).ensureAlpha().raw().toBuffer()
    for (const [prefix, shapeClasses] of [
      ['head', ['ear-horn-small', 'ear-ornament']],
      ['extra', ['mane-small', 'collar']],
    ] as const) {
      const allowed = await decode(`${prefix}-allowed`)
      const rear = await decode(`${prefix}-rear`)
      const front = await decode(`${prefix}-front`)
      const allowedCount = [...allowed].filter((_, index) => index % 4 === 3 && allowed[index] !== 0).length
      const outputs: Buffer[] = []
      for (const shapeClass of shapeClasses) {
        for (const [layer, root] of [['behind', rear], ['front', front]] as const) {
          const output = paintAttachmentSilhouette(allowed, root, shapeClass, 2, [98, 205, 145], layer, layer === 'behind' ? 225 : 150)
          const visibleCount = [...output].filter((_, index) => index % 4 === 3 && output[index] !== 0).length
          const rootCount = [...root].filter((_, index) => index % 4 === 3 && root[index] !== 0).length
          expect(visibleCount).toBeGreaterThan(rootCount)
          expect(visibleCount).toBeLessThan(allowedCount * (layer === 'behind' ? 0.45 : 0.25))
          for (let offset = 0; offset < root.length; offset += 4) if (root[offset + 3] === 255) {
            expect(output.subarray(offset, offset + 4)).toEqual(root.subarray(offset, offset + 4))
          }
          outputs.push(output)
        }
      }
      expect(outputs[0]).not.toEqual(outputs[2])
      expect(outputs[1]).not.toEqual(outputs[3])
    }
  }, 30_000)

  it('review round 1 gives every oral semantic an independent projection for every open socket', async () => {
    const plan = JSON.parse(await readFile('asset-source/v0.9.0/feline/trait-approval-plan.json', 'utf8'))
    const artifacts: SealedTraitArtifactV1[] = []
    for (const entry of plan.entries as Array<Record<string, string>>) {
      artifacts.push(JSON.parse(await readFile(entry.sealedManifestPath, 'utf8')) as SealedTraitArtifactV1)
    }
    const oral = artifacts.filter(artifact => artifact.kind === 'oralDetail')
    expect(oral).toHaveLength(26)
    for (const artifact of oral) {
      if (artifact.kind !== 'oralDetail') continue
      expect(Object.keys(artifact.runtimeResources.oralProjections).sort()).toEqual(['narrow', 'open', 'wide'])
      expect(new Set(Object.values(artifact.runtimeResources.oralProjections).map(ref => ref.resourceId)).size).toBe(3)
    }
    for (const family of ['feline-sit-v2-core', 'feline-sit-v2-legendary-01']) {
      for (const socket of ['open', 'narrow', 'wide']) {
        for (const [rarity, count] of Object.entries({ common: 8, rare: 4, legendary: 1 })) {
          expect(oral.filter(artifact => artifact.skeletonFamilyId === family && artifact.rarity === rarity
            && artifact.kind === 'oralDetail' && Object.hasOwn(artifact.runtimeResources.oralProjections, socket))).toHaveLength(count)
        }
      }
    }
    const familyIds = ['feline-sit-v2-core', 'feline-sit-v2-legendary-01']
    const families = await Promise.all(familyIds.map(async id => JSON.parse(await readFile(`asset-source/v0.9.0/feline/templates/${id}/family.json`, 'utf8'))))
    const templates = await Promise.all(familyIds.map(async id => JSON.parse(await readFile(`asset-source/v0.9.0/feline/templates/${id}.json`, 'utf8'))))
    const catalog = {
      releaseManifestSha256: '0'.repeat(64), releaseManifest: {}, speciesRig: {}, sealedTraits: artifacts,
      skeletonPool: { schemaVersion: 'qmonster-skeleton-pool-v1', skeletonPoolId: 'review', candidates: [
        { skeletonFamilyId: familyIds[0], skeletonClass: 'base', weight: 8 },
        { skeletonFamilyId: familyIds[1], skeletonClass: 'legendary', weight: 1 },
      ] }, skeletonFamilies: families, assemblyTemplates: templates,
      compositionGraph: { schemaVersion: 'qmonster-composition-graph-v1', orderedNodes: [], blendMode: 'source-over-premultiplied-srgb', transformPolicy: 'identity-only' },
    } as unknown as ResolvedV09Catalog
    expect(generateMonsterV09({ seed: 'task8-review-37' }, catalog)).toMatchObject({ blocked: false, diagnostics: [] })
  }, 30_000)

  it('review round 1 indexes explicit oral compatibility, attachment interfaces, report resources, and ignored source closure', async () => {
    const plan = JSON.parse(await readFile('asset-source/v0.9.0/feline/trait-approval-plan.json', 'utf8'))
    const index = JSON.parse(await readFile('asset-source/v0.9.0/feline/trait-review/trait-catalog-review.index.json', 'utf8'))
    expect(index.oralCompatibilityPanels).toHaveLength(78)
    expect(index.attachmentInterfacePanels).toHaveLength(52)
    expect(new Set(index.oralCompatibilityPanels.map((panel: Record<string, string>) => panel.oralSocketClass))).toEqual(new Set(['open', 'narrow', 'wide']))
    expect(index.oralCompatibilityPanels.every((panel: Record<string, unknown>) => panel.runtimeProjection && panel.fullContextPreview)).toBe(true)
    expect(index.attachmentInterfacePanels.every((panel: Record<string, unknown>) => panel.interfaceId && panel.allowedZone
      && panel.rearRootStencil && panel.fixedOccluderMask && panel.diagnosticPreview)).toBe(true)
    expect(index.diagnosticReports.oralCompatibility.panels).toBe(78)
    expect(index.diagnosticReports.attachmentInterfaces.panels).toBe(52)
    for (const report of [index.report, index.diagnosticReports.oralCompatibility, index.diagnosticReports.attachmentInterfaces]) {
      expect(report.assetPath).toBe(`packages/asset-catalog/assets/v0.9.0/by-sha256/${report.sha256}.png`)
      expect(plan.resourcePaths[`sha256:${report.sha256}`]).toBe(report.assetPath)
      await access(report.assetPath)
    }
    const requiredHistory = ['assembly-approvals.json', 'approved-master-review.json', 'attachment-allowlist.json', 'master-overlay-review.index.json', 'superseded.json']
      .map(name => `asset-source/v0.9.0/feline/approval-history/revision-2/${name}`)
    expect(plan.scopedGitAddPaths).toEqual([...plan.scopedGitAddPaths].sort())
    expect(requiredHistory.every(path => plan.scopedGitAddPaths.includes(path))).toBe(true)
    expect(plan.scopedGitAddPaths).toContain('asset-source/v0.9.0/feline/trait-inventory.json')
    expect(plan.scopedGitAddPaths).toContain('asset-source/v0.9.0/feline/trait-approval-plan.json')
    expect(plan.scopedGitAddPaths).toContain('asset-source/v0.9.0/feline/attachment-allowlist-candidate.json')
    expect(plan.scopedGitAddPaths.filter((path: string) => path.endsWith('/projection.json'))).toHaveLength(312)
    const reportBytes = await readFile(index.report.assetPath)
    expect(await reportCopyMatches(reportBytes, index.report)).toBe(true)
    expect(await reportCopyMatches(undefined, index.report)).toBe(false)
    const tampered = Buffer.from(reportBytes); tampered[tampered.length - 1] ^= 1
    expect(await reportCopyMatches(tampered, index.report)).toBe(false)
  })

  it('has one immutable complete batch with the exact approved activation', async () => {
    const summary = await validatePreparedFelineTraits({ workspaceRoot: process.cwd(), deterministicRebuild: true })
    expect(summary).toMatchObject({ semanticTraits: 156, sealedProjections: 312, skeletonFamilies: 2, activeTraitApprovals: 312, activeAttachmentAllowlistEntries: 52, batchOrdinal: 1 })
    expect(summary.failures).toEqual([])
    expect(summary.closureSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(summary.reportSha256).toMatch(/^[a-f0-9]{64}$/)
  }, 600_000)

  it('keeps the pending report and every sealed artifact inside controlled roots', async () => {
    await access('artifacts/acceptance/v0.9.0-feline/trait-catalog-review.png')
    const plan = JSON.parse(await readFile('asset-source/v0.9.0/feline/trait-approval-plan.json', 'utf8'))
    expect(plan.status).toBe('pending-owner-approval')
    expect(plan.entries).toHaveLength(312)
    expect(plan.revisedAssemblyApprovalRevision).toBe(3)
    const approvalFiles = (await readdir('packages/asset-catalog/audit/v0.9.0/trait-approvals', { recursive: true, withFileTypes: true })).filter(entry => entry.isFile())
    expect(approvalFiles).toHaveLength(312)
    expect(plan.entries.every((entry: Record<string, unknown>) => JSON.stringify(entry).includes('sha256:'))).toBe(true)
  })

  it('activates only the exact owner-approved batch and revised templates', async () => {
    const approvedAt = '2026-09-10T01:52:20.3959909Z'
    const plan = JSON.parse(await readFile('asset-source/v0.9.0/feline/trait-approval-plan.json', 'utf8'))
    const index = JSON.parse(await readFile('asset-source/v0.9.0/feline/trait-review/trait-catalog-review.index.json', 'utf8'))
    const approvalRoot = 'packages/asset-catalog/audit/v0.9.0/trait-approvals'
    const approvalPaths = (await readdir(approvalRoot, { recursive: true, withFileTypes: true })).filter(entry => entry.isFile()).map(entry => `${entry.parentPath}/${entry.name}`)
    expect(approvalPaths).toHaveLength(312)
    const approvals = await Promise.all(approvalPaths.map(async path => JSON.parse(await readFile(path, 'utf8'))))
    expect(approvals.every(approval => approval.approvedBy === 'project-owner' && approval.approvedAt === approvedAt
      && approval.approvalRevision === 1 && approval.status === 'approved')).toBe(true)
    for (const entry of plan.entries) {
      const approval = approvals.find(item => item.skeletonFamilyId === entry.skeletonFamilyId && item.sealedArtifactSha256 === entry.sealedArtifactSha256)
      expect(approval).toMatchObject({ assemblyTemplateSha256: entry.assemblyTemplateSha256, fullContextPreviewSha256: entry.fullContextPreview.sha256 })
    }
    const allowlist = JSON.parse(await readFile('asset-source/v0.9.0/feline/approvals/attachment-allowlist.json', 'utf8'))
    const candidates = JSON.parse(await readFile('asset-source/v0.9.0/feline/attachment-allowlist-candidate.json', 'utf8'))
    expect(allowlist.entries).toHaveLength(52)
    for (const candidate of candidates.entries) {
      const approval = approvals.find(item => item.skeletonFamilyId === candidate.skeletonFamilyId && item.sealedArtifactSha256 === candidate.sealedArtifactSha256)
      expect(allowlist.entries).toContainEqual({ ...candidate, traitVisualApprovalSha256: canonicalJsonSha256(approval) })
    }
    const assemblies = JSON.parse(await readFile('asset-source/v0.9.0/feline/approvals/assembly-approvals.json', 'utf8'))
    const evidence = JSON.parse(await readFile('asset-source/v0.9.0/feline/approvals/approved-master-review.json', 'utf8'))
    expect(assemblies).toHaveLength(2)
    expect(assemblies.every(item => item.approvalRevision === 3 && item.approvedAt === approvedAt
      && item.attachmentAllowlistSha256 === canonicalJsonSha256(allowlist))).toBe(true)
    expect(evidence).toMatchObject({ approvalRevision: 3, approvedAt, attachmentAllowlistSha256: canonicalJsonSha256(allowlist), combinedTraitReview: {
      reportSha256: index.report.sha256, reviewIndexSha256: canonicalJsonSha256(index), approvalPlanSha256: canonicalJsonSha256(plan),
    } })
    for (const revision of ['revision-1', 'revision-2']) for (const name of ['assembly-approvals.json', 'approved-master-review.json', 'attachment-allowlist.json', 'master-overlay-review.index.json', 'superseded.json']) {
      await access(`asset-source/v0.9.0/feline/approval-history/${revision}/${name}`)
    }
  })

  it.each([1, 2, 4])('rejects recomputed revision-%i active approval data without combined review evidence', async approvalRevision => {
    const readJson = async (path: string) => JSON.parse(await readFile(path, 'utf8'))
    const assemblies = await readJson('asset-source/v0.9.0/feline/approvals/assembly-approvals.json')
    const evidence = await readJson('asset-source/v0.9.0/feline/approvals/approved-master-review.json')
    const attachmentAllowlist = await readJson('asset-source/v0.9.0/feline/approvals/attachment-allowlist.json')
    const masterReviewIndex = await readJson('asset-source/v0.9.0/feline/review/master-overlay-review.index.json')
    const tamperedAssemblies = assemblies.map((approval: Record<string, unknown>) => ({ ...approval, approvalRevision }))
    const tamperedEvidence = { ...evidence, approvalRevision, assemblyApprovalsSha256: canonicalJsonSha256(tamperedAssemblies) }
    delete tamperedEvidence.combinedTraitReview
    expect(approvalBindingErrors(tamperedAssemblies, tamperedEvidence, attachmentAllowlist, masterReviewIndex)).not.toEqual([])
    const result = await validatePreparedFelineTraits({
      workspaceRoot: process.cwd(),
      deterministicRebuild: false,
      approvalSnapshot: { assemblyApprovals: tamperedAssemblies, evidence: tamperedEvidence, attachmentAllowlist },
    })
    expect(result.failures.some(failure => failure.includes('Revision-3 active approval gate'))).toBe(true)
  }, 180_000)
})
