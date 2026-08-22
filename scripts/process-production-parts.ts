import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { PRODUCTION_PARTS } from './qmonster-part-production.js'
import { normalizeAlignedMaster, normalizeBilateralMaster, processCandidateSheet } from './process-candidate-sheet.js'

interface ApprovedSheet {
  file: string
  selected: 1 | 2 | 3 | 4
  attempt: 'first-pass' | 'regeneration'
  rejectionSummary: string
}

const generatedDirectory = 'C:/Users/jiangzhenyu/.codex/generated_images/01a02470-776f-7a43-a04d-42ea4ff47690'
const sourceRoot = 'asset-source/v0.1.0'
const runtimeRoot = 'packages/asset-catalog/assets/v0.1.0/parts'

const APPROVED_SHEETS: Record<string, ApprovedSheet> = {
  body_blob_round: { file: 'exec-08dd5718-3840-4b91-b9d1-a9f1bf9b7158.png', selected: 1, attempt: 'first-pass', rejectionSummary: '2-4: less neutral silhouette or weaker locked-rig proportion.' },
  body_blob_wide: { file: 'exec-305aa7ff-5702-4794-b529-7096ac85b8a1.png', selected: 1, attempt: 'first-pass', rejectionSummary: '2-4: less legible two-lobe wide-cloud silhouette.' },
  body_biped_peanut: { file: 'exec-a76259d9-388c-408f-a43b-9e1eeac26c23.png', selected: 1, attempt: 'first-pass', rejectionSummary: '2-4: palette drift; candidate 4 approached key color.' },
  body_biped_tall: { file: 'exec-c48d9383-4320-45e6-a50e-33a71a5cdcf6.png', selected: 3, attempt: 'first-pass', rejectionSummary: '1,2,4: less tall or less balanced biped stance.' },
  body_floating_drop: { file: 'exec-16a133e4-1df1-41f0-8f86-93a1a7fe21bd.png', selected: 1, attempt: 'first-pass', rejectionSummary: '2-4: pink/blue/yellow palette drift from locked neutral rig.' },
  head_round_dome: { file: 'exec-fff185df-4e94-4bf6-b3a5-d463d1e10b7c.png', selected: 1, attempt: 'first-pass', rejectionSummary: '2-4: palette drift; same geometry with weaker neutral match.' },
  head_mushroom_cap: { file: 'exec-c8f3dfe4-de1a-4e44-a15e-31b256731580.png', selected: 2, attempt: 'first-pass', rejectionSummary: '1,3,4: machine safe-border failures; candidate 2 preserves the mushroom-cap read with clean extraction margins.' },
  head_angler_bulb: { file: 'exec-227ca35a-c59c-45f2-b558-55d24241d4fa.png', selected: 1, attempt: 'first-pass', rejectionSummary: '2-4: sharper curl or weaker droplet-bulb read.' },
  head_shadow_hood: { file: 'exec-35b35376-f563-4648-8c41-5bb63c68bbe0.png', selected: 1, attempt: 'first-pass', rejectionSummary: '2-4: less legible hood fold or overly plain dome.' },
  eyes_glossy_pair: { file: 'exec-02250bed-e440-400b-bdf0-9d8abc83b213.png', selected: 3, attempt: 'first-pass', rejectionSummary: '1,2,4: weaker coordinated pupil direction.' },
  eyes_asymmetric: { file: 'exec-268999c3-cfa3-45dd-b5c0-86d63f0dd4b4.png', selected: 1, attempt: 'regeneration', rejectionSummary: 'First pass rejected all four for lavender head backing; regenerated 2-4 have weaker direction/spacing.' },
  eyes_triple_pearl: { file: 'exec-6120de18-fceb-4d6b-95f8-4d9fd2ec4866.png', selected: 1, attempt: 'first-pass', rejectionSummary: '2-4: less even shallow-arc spacing.' },
  eyes_sleepy_crescent: { file: 'exec-c77f23cd-a679-481a-9a53-43a8bfe6151f.png', selected: 1, attempt: 'first-pass', rejectionSummary: '2-4: too closed or less readable pupil reveal.' },
  eyes_stalk_pair: { file: 'exec-7795f1a9-5516-4390-9910-982b2bd911f4.png', selected: 1, attempt: 'first-pass', rejectionSummary: '2-4: less balanced stalk height/spacing.' },
  mouth_wide_grin: { file: 'exec-1ce41ae8-0016-4327-be77-8f1cd437be98.png', selected: 1, attempt: 'first-pass', rejectionSummary: '2-4: weaker friendly wide-grin silhouette.' },
  mouth_soft_pout: { file: 'exec-9fac2e53-945b-4aa9-952d-fa673bfed372.png', selected: 2, attempt: 'regeneration', rejectionSummary: 'First pass rejected all four for muzzle/head backing; regeneration 1,3,4 less compact.' },
  mouth_soft_beak: { file: 'exec-693322f9-4968-47a3-8176-4136a40a15af.png', selected: 2, attempt: 'first-pass', rejectionSummary: '1,3 too open; 4 less beak-like.' },
  mouth_vertical_oval: { file: 'exec-8c8b977d-6d00-49f4-918d-14b135fb8c7d.png', selected: 1, attempt: 'regeneration', rejectionSummary: 'First pass rejected all four for whole head backing; regenerated 2-4 less clean/centered.' },
  oral_round_teeth: { file: 'exec-1cfbe1ed-fda3-4974-b22d-98c2ffffa300.png', selected: 1, attempt: 'first-pass', rejectionSummary: '2-4: tooth-size rhythm less readable.' },
  oral_single_fang: { file: 'exec-f8ef1475-93c6-4f37-a32c-beef713c6c70.png', selected: 1, attempt: 'regeneration', rejectionSummary: 'First pass rejected all four for large lavender backing; regenerated 2-4 weaker upright socket.' },
  oral_lolling_tongue: { file: 'exec-6a877764-a7bc-4d96-984b-de91cc00ca70.png', selected: 1, attempt: 'first-pass', rejectionSummary: '2-4: excessive curl or less readable rounded tip.' },
  oral_gummy_ridges: { file: 'exec-d207ab9e-37ba-4687-b562-21bac667f130.png', selected: 1, attempt: 'first-pass', rejectionSummary: '2-4: palette drift; greenish candidate rejected for key similarity.' },
  head_horns_soft_nubs: { file: 'exec-6032c5c5-91da-4476-b35c-d782712b564d.png', selected: 1, attempt: 'regeneration', rejectionSummary: 'First pass rejected all four for full head shell; regenerated 2-4 had palette drift.' },
  head_antennae_glow: { file: 'exec-b77ddc51-32bb-458a-bf4f-22a087ee1aac.png', selected: 1, attempt: 'regeneration', rejectionSummary: 'First pass rejected all four for full body; regenerated 2-4 less compact or more curled.' },
  head_ears_floppy_fins: { file: 'exec-e0e75dc1-76ac-452b-9ca4-395a22fe5379.png', selected: 3, attempt: 'first-pass', rejectionSummary: '1,2,4: weaker floppy fin-ear silhouette.' },
  arms_short_plush: { file: 'exec-9d41ac5e-3cf0-43a9-b49b-ce470ca5d817.png', selected: 1, attempt: 'regeneration', rejectionSummary: 'Contact-sheet review rejected the first sheet: every quadrant contained one arm rather than a bilateral pair. Final regenerated candidates all contain exactly two arms; 2-4 have weaker mitten symmetry.' },
  arms_long_noodle: { file: 'exec-58b963be-c535-44f3-9a04-778bdcf5d722.png', selected: 1, attempt: 'regeneration', rejectionSummary: 'Two tool attempts produced moderation-only failures; successful sheet 2-4 were braided/beaded rather than noodle-soft.' },
  arms_paddle: { file: 'exec-76e8a131-d5ac-4ab5-9e98-4905d195af0e.png', selected: 3, attempt: 'regeneration', rejectionSummary: 'First pass rejected all four for one fin instead of bilateral pair; regenerated 1,2,4 less webbed.' },
  legs_stub_feet: { file: 'exec-e9f6a470-ceb3-4fde-be22-8254c875c2c8.png', selected: 2, attempt: 'first-pass', rejectionSummary: '1,3,4: toe segmentation too prominent.' },
  legs_webbed: { file: 'exec-67fe5656-4cbc-4daf-ba62-68c2b984fdd8.png', selected: 1, attempt: 'first-pass', rejectionSummary: '2-4: weaker three-lobed web read.' },
  legs_mushroom: { file: 'exec-5bc98243-46de-4e0c-a903-a4ddc8005d90.png', selected: 1, attempt: 'regeneration', rejectionSummary: 'First pass rejected all four for ordinary boots; regenerated 2-4 less balanced or overdecorated.' },
  legs_shadow_tiptoe: { file: 'exec-adb3274a-1cbf-4cb7-a33b-a7e09d9266f4.png', selected: 3, attempt: 'first-pass', rejectionSummary: '1,2,4: less tapered or less tiptoe-like.' },
  tail_fish_fan: { file: 'exec-8fbd6631-b1b7-4ad4-b244-37e26d961543.png', selected: 1, attempt: 'first-pass', rejectionSummary: '2-4: less compact or more irregular fan edge.' },
  tail_soft_curl: { file: 'exec-250a18d1-60ba-480c-a40f-d5096aca3bf7.png', selected: 1, attempt: 'first-pass', rejectionSummary: '2-4: tighter spiral or weaker attachment base.' },
  tail_mushroom_cluster: { file: 'exec-5951ff03-206c-453c-aa8e-2a945110354e.png', selected: 1, attempt: 'first-pass', rejectionSummary: '2-4: palette drift; green cap variant rejected for key similarity.' },
  extra_moth_wings: { file: 'exec-b39c1d38-e6fc-48ce-8f1f-8c5bd96bad32.png', selected: 4, attempt: 'first-pass', rejectionSummary: '1-3: busier ribbing/scallops than locked simple-wing target.' },
  extra_soft_tentacles: { file: 'exec-d4c3d980-2744-48d1-b68d-0bcf497b3a17.png', selected: 1, attempt: 'regeneration', rejectionSummary: 'First pass rejected all four for three instead of four appendages; regenerated 2-4 more curled.' },
  extra_side_fins: { file: 'exec-c4301cee-d339-4f49-82b7-f3c9e32765f2.png', selected: 1, attempt: 'regeneration', rejectionSummary: 'Both prior and final sheets rendered one side design per quadrant rather than a pair. Candidate 1 was selected for its soft five-lobe silhouette and assembled into a deterministic mirrored bilateral runtime layer; 2-4 are alternate single-side designs.' },
  surface_short_fur: { file: 'exec-6cb19b7f-7a25-4464-ae27-bb314b78a022.png', selected: 1, attempt: 'regeneration', rejectionSummary: 'First pass rejected all four for opaque whole-body fill; regenerated 2-4 had less balanced tuft distribution.' },
  surface_gel_bubbles: { file: 'exec-22dff2f0-ca3e-4fb7-a651-1323f05c43d1.png', selected: 1, attempt: 'regeneration', rejectionSummary: 'First pass rejected all four for opaque whole-body fill; regenerated 2-4 varied distribution.' },
  surface_soft_scales: { file: 'exec-70d9c178-3018-4c7a-982b-a0feac51073b.png', selected: 1, attempt: 'regeneration', rejectionSummary: 'First pass rejected all four for whole creature; regenerated candidate 3 failed the machine safe-border gate and 2,4 were less balanced.' },
  surface_mushroom_velvet: { file: 'exec-49e1f743-1d84-424a-9db5-c343acde36f3.png', selected: 1, attempt: 'regeneration', rejectionSummary: 'First pass rejected all four by edge-core distance (p95 40-56px); regenerated 2-4 had less even solid-centered patch distribution.' },
  pattern_soft_spots: { file: 'exec-f98f7f78-c33d-47e4-aa1a-f0aee22a7a0c.png', selected: 1, attempt: 'regeneration', rejectionSummary: 'First pass rejected all four for copied cyan guide cross; regenerated 2-4 less balanced twelve-spot layout.' },
  pattern_gentle_stripes: { file: 'exec-df31e342-00e8-4c12-a32f-f4f3537b170f.png', selected: 2, attempt: 'first-pass', rejectionSummary: '1,3,4: less convincing five-stripe volume flow.' },
  pattern_constellation: { file: 'exec-a94c5135-7b8f-4cbd-85f4-f30e420ee8fc.png', selected: 4, attempt: 'regeneration', rejectionSummary: 'First pass rejected all four by partial-alpha/edge-core metrics; regenerated 1-3 had a less complete connected constellation arc.' },
  pattern_spore_rings: { file: 'exec-02740fbf-60f9-412a-b0e2-1e50f30cebfb.png', selected: 1, attempt: 'first-pass', rejectionSummary: '2-4: less legible ring hierarchy.' },
  color_deep_sea_coral: { file: 'exec-a0f8cd78-06df-4ad8-afc4-be1deecee228.png', selected: 1, attempt: 'regeneration', rejectionSummary: 'First pass rejected all four for fuzzy green body fill; regenerated 2-4 less orderly three-color grouping.' },
  color_fungal_amber: { file: 'exec-3221d64e-f071-4e59-889f-cc07031831f5.png', selected: 3, attempt: 'regeneration', rejectionSummary: 'First pass rejected all four for fuzzy green body fill; regenerated 1,2,4 less balanced.' },
  color_shadow_violet: { file: 'exec-133c8396-417a-4da0-ab39-4ab0898b9091.png', selected: 1, attempt: 'regeneration', rejectionSummary: 'First pass rejected all four for fuzzy green body fill; regenerated 2-4 weaker three-color balance.' },
  effect_bioluminescent_orbs: { file: 'exec-6038d1f5-38da-4e0e-9254-5172a90dcd7a.png', selected: 1, attempt: 'regeneration', rejectionSummary: 'First pass rejected all four for incorrect orb count; second sheet rejected all four by edge-core metrics from broad halos; final regenerated 2-4 use the same seven solid compact-rim orbs but are less balanced.' },
  effect_spore_glow: { file: 'exec-3c33cb41-4944-41e2-b308-b7fa850839cb.png', selected: 1, attempt: 'first-pass', rejectionSummary: 'Candidate 2 was visually balanced but failed edge-core metrics; 3-4 also failed machine edge gates. Candidate 1 preserves the upward spore arc and passes extraction.' },
}

const PNG_OPTIONS = { compressionLevel: 9, adaptiveFiltering: false, palette: false } as const

async function sha256(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

async function main(): Promise<void> {
  const output: unknown[] = []
  for (const part of PRODUCTION_PARTS) {
    const masterPath = join(sourceRoot, 'parts', `${part.id}.png`)
    const pngPath = join(runtimeRoot, `${part.id}.png`)
    const webpPath = join(runtimeRoot, `${part.id}.webp`)
    if (!part.visible) {
      await mkdir(join(sourceRoot, 'parts'), { recursive: true })
      await mkdir(runtimeRoot, { recursive: true })
      const transparent = sharp({ create: { width: 2048, height: 2048, channels: 4, background: '#00000000' } }).png(PNG_OPTIONS)
      await transparent.toFile(masterPath)
      await sharp(masterPath).resize(1024, 1024).png(PNG_OPTIONS).toFile(pngPath)
      await sharp(masterPath).resize(1024, 1024).webp({ lossless: true }).toFile(webpPath)
      output.push({ id: part.id, visible: false, selected: 'none', masterPath, masterSha256: await sha256(masterPath), pngPath, pngSha256: await sha256(pngPath), webpPath, webpSha256: await sha256(webpPath), evaluatedVariants: ['none', 'none', 'none', 'none'] })
      continue
    }
    const approved = APPROVED_SHEETS[part.id]
    if (!approved) throw new Error(`Missing approved sheet mapping for ${part.id}`)
    const sourceSheet = join(generatedDirectory, approved.file)
    const sheetPath = join(sourceRoot, 'generation', 'part-sheets', `${part.id}-sheet.png`)
    await mkdir(join(sourceRoot, 'generation', 'part-sheets'), { recursive: true })
    await copyFile(sourceSheet, sheetPath)
    const candidates = await processCandidateSheet({ sourcePath: sheetPath, outputDirectory: join(sourceRoot, 'generation', 'part-candidates', part.id), sourceId: part.id, safeBorderPixels: 16 })
    const chosen = candidates.find(candidate => candidate.index === approved.selected)!
    if (!chosen.extraction.approved) throw new Error(`${part.id} selected candidate failed extraction: ${JSON.stringify(chosen.extraction.diagnostics)}`)
    const master = part.id === 'extra_side_fins'
      ? await normalizeBilateralMaster({ rgbaPath: chosen.rgbaPath, masterPath })
      : await normalizeAlignedMaster({
        rgbaPath: chosen.rgbaPath,
        masterPath,
        contentScale: part.id === 'extra_soft_tentacles' ? 1.5 : 1,
      })
    if (!master.hasAlpha || master.boundaryAlphaPixels !== 0) throw new Error(`${part.id} master failed alpha/safe-border gate`)
    await mkdir(runtimeRoot, { recursive: true })
    await sharp(masterPath).resize(1024, 1024, { fit: 'contain' }).png(PNG_OPTIONS).toFile(pngPath)
    await sharp(masterPath).resize(1024, 1024, { fit: 'contain' }).webp({ lossless: true }).toFile(webpPath)
    output.push({ id: part.id, visible: true, ...approved, sourceSheet, sheetPath, sheetSha256: await sha256(sheetPath), candidates, postProcess: part.id === 'extra_side_fins' ? 'mirrored-bilateral-assembly-v1' : part.id === 'extra_soft_tentacles' ? 'center-scale-1.5-v1' : 'aligned-canvas-v1', master, pngPath, pngSha256: await sha256(pngPath), webpPath, webpSha256: await sha256(webpPath) })
  }
  await writeFile(join(sourceRoot, 'generation', 'production-index.json'), `${JSON.stringify(output, null, 2)}\n`)
  console.log(JSON.stringify({ count: output.length, visible: output.filter(value => (value as { visible: boolean }).visible).length, none: output.filter(value => !(value as { visible: boolean }).visible).length }))
}

await main()
