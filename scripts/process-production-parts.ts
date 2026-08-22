import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { composeHeadShellWithLure, type AiComponentProvenance } from './compose-head-shell-lure.js'
import { extractChromaAlpha } from './extract-chroma-alpha.js'
import { PRODUCTION_PARTS } from './qmonster-part-production.js'
import {
  normalizeAlignedMaster,
  normalizeBilateralMaster,
  normalizeContainedAlignedMaster,
  processCandidateSheet,
} from './process-candidate-sheet.js'
import { pruneStaleFiles, resolveOutputPath } from './safe-output.js'

interface ApprovedSheet {
  file: string
  selected: 1 | 2 | 3 | 4
  attempt: 'first-pass' | 'regeneration'
  rejectionSummary: string
}

const defaultSourceRoot = 'asset-source/v0.1.0'
const defaultRuntimeAssetRoot = 'packages/asset-catalog/assets/v0.1.0'

const APPROVED_SHEETS: Record<string, ApprovedSheet> = {
  body_blob_round: { file: 'exec-08dd5718-3840-4b91-b9d1-a9f1bf9b7158.png', selected: 1, attempt: 'first-pass', rejectionSummary: '2-4: less neutral silhouette or weaker locked-rig proportion.' },
  body_blob_wide: { file: 'exec-305aa7ff-5702-4794-b529-7096ac85b8a1.png', selected: 1, attempt: 'first-pass', rejectionSummary: '2-4: less legible two-lobe wide-cloud silhouette.' },
  body_biped_peanut: { file: 'exec-a76259d9-388c-408f-a43b-9e1eeac26c23.png', selected: 1, attempt: 'first-pass', rejectionSummary: '2-4: palette drift; candidate 4 approached key color.' },
  body_biped_tall: { file: 'exec-c48d9383-4320-45e6-a50e-33a71a5cdcf6.png', selected: 3, attempt: 'first-pass', rejectionSummary: '1,2,4: less tall or less balanced biped stance.' },
  body_floating_drop: { file: 'exec-16a133e4-1df1-41f0-8f86-93a1a7fe21bd.png', selected: 1, attempt: 'first-pass', rejectionSummary: '2-4: pink/blue/yellow palette drift from locked neutral rig.' },
  head_round_dome: { file: 'exec-fff185df-4e94-4bf6-b3a5-d463d1e10b7c.png', selected: 1, attempt: 'first-pass', rejectionSummary: '2-4: palette drift; same geometry with weaker neutral match.' },
  head_mushroom_cap: { file: 'exec-c8f3dfe4-de1a-4e44-a15e-31b256731580.png', selected: 2, attempt: 'first-pass', rejectionSummary: '1,3,4: machine safe-border failures; candidate 2 preserves the mushroom-cap read with clean extraction margins.' },
  head_angler_bulb: { file: 'exec-e61ed6e9-7560-45f5-a3a2-193e54f7ac55.png', selected: 1, attempt: 'regeneration', rejectionSummary: 'Selected deterministic composite uses approved compact shell candidate 4 plus lure candidate 1; lure 2 failed component edge p95 and final alternatives 2-4 were visually less balanced.' },
  head_shadow_hood: { file: 'exec-97ca9ef1-9f8f-4562-be6e-467258c49bba.png', selected: 4, attempt: 'regeneration', rejectionSummary: 'Prior hood candidates failed independent edge colour. Final 1-3 pass but have a heavier or more folded lower rim; 4 is the clean compact hood.' },
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
  head_horns_soft_nubs: { file: 'exec-e3fffee5-fa36-478d-8579-c7d85966295c.png', selected: 2, attempt: 'regeneration', rejectionSummary: 'Final sheet contains only very short bilateral soft nubs. Candidate 1 fails edge p95; 3 is warmer and 4 less even; 2 is short, symmetric, and machine-approved.' },
  head_antennae_glow: { file: 'exec-b77ddc51-32bb-458a-bf4f-22a087ee1aac.png', selected: 1, attempt: 'regeneration', rejectionSummary: 'First pass rejected all four for full body; regenerated 2-4 less compact or more curled.' },
  head_ears_floppy_fins: { file: 'exec-74b9d134-144a-4d83-85eb-07bd9e10c3ca.png', selected: 1, attempt: 'regeneration', rejectionSummary: 'Contact review rejected the prior upright oval pair as bunny ears without fin ribbing. Final four candidates are low, wide, outward/downward-drooping bilateral fin pairs with shallow ribs and all pass; candidate 1 has the clearest floppy silhouette and balanced attachment gap.' },
  arms_short_plush: { file: 'exec-9d41ac5e-3cf0-43a9-b49b-ce470ca5d817.png', selected: 1, attempt: 'regeneration', rejectionSummary: 'Contact-sheet review rejected the first sheet: every quadrant contained one arm rather than a bilateral pair. Final regenerated candidates all contain exactly two arms; 2-4 have weaker mitten symmetry.' },
  arms_long_noodle: { file: 'exec-58b963be-c535-44f3-9a04-778bdcf5d722.png', selected: 1, attempt: 'regeneration', rejectionSummary: 'Two tool attempts produced moderation-only failures; successful sheet 2-4 were braided/beaded rather than noodle-soft.' },
  arms_paddle: { file: 'exec-76e8a131-d5ac-4ab5-9e98-4905d195af0e.png', selected: 3, attempt: 'regeneration', rejectionSummary: 'First pass rejected all four for one fin instead of bilateral pair; regenerated 1,2,4 less webbed.' },
  legs_stub_feet: { file: 'exec-e9f6a470-ceb3-4fde-be22-8254c875c2c8.png', selected: 2, attempt: 'first-pass', rejectionSummary: '1,3,4: toe segmentation too prominent.' },
  legs_webbed: { file: 'exec-67fe5656-4cbc-4daf-ba62-68c2b984fdd8.png', selected: 1, attempt: 'first-pass', rejectionSummary: '2-4: weaker three-lobed web read.' },
  legs_mushroom: { file: 'exec-5bc98243-46de-4e0c-a903-a4ddc8005d90.png', selected: 1, attempt: 'regeneration', rejectionSummary: 'First pass rejected all four for ordinary boots; regenerated 2-4 less balanced or overdecorated.' },
  legs_shadow_tiptoe: { file: 'exec-adb3274a-1cbf-4cb7-a33b-a7e09d9266f4.png', selected: 3, attempt: 'first-pass', rejectionSummary: '1,2,4: less tapered or less tiptoe-like.' },
  tail_fish_fan: { file: 'exec-8fbd6631-b1b7-4ad4-b244-37e26d961543.png', selected: 1, attempt: 'first-pass', rejectionSummary: '2-4: less compact or more irregular fan edge.' },
  tail_soft_curl: { file: 'exec-250a18d1-60ba-480c-a40f-d5096aca3bf7.png', selected: 3, attempt: 'first-pass', rejectionSummary: '1,2,4 fail the independent edge-colour gate or have a tighter spiral; candidate 3 preserves a clean attachment base and passes at p95 11.31.' },
  tail_mushroom_cluster: { file: 'exec-a91fea4a-a2b8-4c43-8b3c-3217b3972895.png', selected: 1, attempt: 'regeneration', rejectionSummary: 'Final candidate 1 is a compact tail with exactly three caps; 2 is similar but less clear, 3-4 expose hollow ends, and 4 also fails edge p95.' },
  extra_moth_wings: { file: 'exec-7aeade1a-754d-4172-bc9f-9fc367710926.png', selected: 1, attempt: 'regeneration', rejectionSummary: 'All final candidates are broad bilateral rear-wing pairs; 1 has the clearest center gap and simplest ribbing.' },
  extra_soft_tentacles: { file: 'exec-d4c3d980-2744-48d1-b68d-0bcf497b3a17.png', selected: 1, attempt: 'regeneration', rejectionSummary: 'First pass rejected all four for three instead of four appendages; regenerated 2-4 more curled.' },
  extra_side_fins: { file: 'exec-c4301cee-d339-4f49-82b7-f3c9e32765f2.png', selected: 1, attempt: 'regeneration', rejectionSummary: 'Both prior and final sheets rendered one side design per quadrant rather than a pair. Candidate 1 was selected for its soft five-lobe silhouette and assembled into a deterministic mirrored bilateral runtime layer; 2-4 are alternate single-side designs.' },
  surface_short_fur: { file: 'exec-718e639b-c89a-4288-afd0-13569dde7899.png', selected: 2, attempt: 'regeneration', rejectionSummary: 'Wispy sheet failed nearest-core, yellow-key sheet failed key validity, and cyan/plum sheet failed edge p95. Final pale tuft sheet contains only compact opaque short-fur marks; candidate 2 alone passes the complete independent gate.' },
  surface_gel_bubbles: { file: 'exec-22dff2f0-ca3e-4fb7-a651-1323f05c43d1.png', selected: 1, attempt: 'regeneration', rejectionSummary: 'First pass rejected all four for opaque whole-body fill; regenerated 2-4 varied distribution.' },
  surface_soft_scales: { file: 'exec-a6c4e10a-bb8d-404f-b90c-45cbba49e051.png', selected: 2, attempt: 'regeneration', rejectionSummary: 'Two preceding sheets were rejected as a full torso and raised pebbles. Final candidates are thin overlapping scale rows; 2 has the best edge p95 and balanced footprint.' },
  surface_mushroom_velvet: { file: 'exec-49e1f743-1d84-424a-9db5-c343acde36f3.png', selected: 1, attempt: 'regeneration', rejectionSummary: 'First pass rejected all four by edge-core distance (p95 40-56px); regenerated 2-4 had less even solid-centered patch distribution.' },
  pattern_soft_spots: { file: 'exec-f98f7f78-c33d-47e4-aa1a-f0aee22a7a0c.png', selected: 1, attempt: 'regeneration', rejectionSummary: 'First pass rejected all four for copied cyan guide cross; regenerated 2-4 less balanced twelve-spot layout.' },
  pattern_gentle_stripes: { file: 'exec-df31e342-00e8-4c12-a32f-f4f3537b170f.png', selected: 2, attempt: 'first-pass', rejectionSummary: '1,3,4: less convincing five-stripe volume flow.' },
  pattern_constellation: { file: 'exec-02fa31cf-020e-4d94-9eef-61059c5478b8.png', selected: 1, attempt: 'regeneration', rejectionSummary: 'Thin first sheet failed edge colour and a blue-key retry added divider lines. Final four pass; 1 has four readable chains and the strongest complete constellation.' },
  pattern_spore_rings: { file: 'exec-ae434eb9-40f9-4022-8c9e-b1c6bd6c91e9.png', selected: 1, attempt: 'regeneration', rejectionSummary: 'Thin first sheet had no opaque core. Final four pass; 1 has the clearest mixture of complete rings and dotted arcs.' },
  color_deep_sea_coral: { file: 'exec-ba714f94-1a48-49b8-adaa-2fa3503feaab.png', selected: 1, attempt: 'regeneration', rejectionSummary: 'Final four are broad flat three-region recolour masks without raised appliqué; 1 has the cleanest 65/27/8 grouping.' },
  color_fungal_amber: { file: 'exec-e96979dd-1095-40f4-a7e1-c43007535bde.png', selected: 4, attempt: 'regeneration', rejectionSummary: 'Final four are flat three-region masks; 1-3 exceed edge p95 or have weaker balance, while 4 passes and preserves all three zones.' },
  color_shadow_violet: { file: 'exec-8811687e-b0fb-426a-b137-72b7e132072c.png', selected: 2, attempt: 'regeneration', rejectionSummary: 'Final four are flat three-region masks; 2 has the cleanest machine edge metric and a balanced violet/lilac/gold layout.' },
  effect_bioluminescent_orbs: { file: 'exec-621273c2-760f-4d52-9a9c-769366b4a2dd.png', selected: 1, attempt: 'regeneration', rejectionSummary: 'The prior green-key sheet had correct counts only in 1-2 but all four failed nearest-core distance (~30px); a cyan retry rendered six per quadrant; a seven-count cyan retry used invalid #22FFFF key. Final green-key candidates all contain exactly seven separated opaque-core orbs and pass the independent gate; candidate 1 has the most balanced halo and nearest-core p95 7.81px.' },
  effect_spore_glow: { file: 'exec-3c33cb41-4944-41e2-b308-b7fa850839cb.png', selected: 1, attempt: 'first-pass', rejectionSummary: 'Candidate 2 was visually balanced but failed edge-core metrics; 3-4 also failed machine edge gates. Candidate 1 preserves the upward spore arc and passes extraction.' },
}

const PNG_OPTIONS = { compressionLevel: 9, adaptiveFiltering: false, palette: false } as const

async function sha256(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

async function componentProvenance(input: {
  role: AiComponentProvenance['role']
  sourceSheetPath: string
  sourcePath: string
  processedPath: string
  promptPath: string
}): Promise<AiComponentProvenance> {
  const prompt = (await readFile(input.promptPath, 'utf8')).trimEnd()
  return {
    role: input.role,
    sourceSheetPath: input.sourceSheetPath,
    sourceSheetSha256: await sha256(input.sourceSheetPath),
    sourcePath: input.sourcePath,
    sourceSha256: await sha256(input.sourcePath),
    processedPath: input.processedPath,
    processedSha256: await sha256(input.processedPath),
    promptPath: input.promptPath,
    prompt,
    promptSha256: sha256Text(prompt),
  }
}

export async function processAnglerCompositeCandidates(sourceRoot: string): Promise<{
  sheetPath: string
  candidates: Awaited<ReturnType<typeof processCandidateSheet>>
  candidateCompositions: Array<Awaited<ReturnType<typeof composeHeadShellWithLure>> & { index: 1 | 2 | 3 | 4 }>
  componentEvaluations: Record<string, unknown>
}> {
  const shellSheetPath = resolveOutputPath(sourceRoot, 'generation', 'part-sheets', 'head_shadow_hood-sheet.png')
  const lureSheetPath = resolveOutputPath(sourceRoot, 'generation', 'part-sheets', 'head_angler_bulb-lure-sheet.png')
  const shellPromptPath = resolveOutputPath(sourceRoot, 'prompts', 'head_angler_bulb-shell-component.txt')
  const lurePromptPath = resolveOutputPath(sourceRoot, 'prompts', 'head_angler_bulb-lure-component.txt')
  const componentRoot = resolveOutputPath(sourceRoot, 'generation', 'part-components', 'head_angler_bulb')
  const compositeRoot = resolveOutputPath(sourceRoot, 'generation', 'part-composites', 'head_angler_bulb')
  const shellCandidates = await processCandidateSheet({
    sourcePath: shellSheetPath,
    outputDirectory: resolveOutputPath(componentRoot, 'shell'),
    sourceId: 'head_angler_bulb-shell',
    safeBorderPixels: 16,
  })
  const lureCandidates = await processCandidateSheet({
    sourcePath: lureSheetPath,
    outputDirectory: resolveOutputPath(componentRoot, 'lure'),
    sourceId: 'head_angler_bulb-lure',
    safeBorderPixels: 16,
  })
  const shell = shellCandidates.find(candidate => candidate.index === 4)!
  if (!shell.extraction.approved) throw new Error('Approved compact head-shell component failed extraction')
  const metadata = await sharp(shell.rgbaPath).metadata()
  if (metadata.width === undefined || metadata.height === undefined) throw new Error('Cannot read approved head-shell dimensions')
  const shellProvenance = await componentProvenance({
    role: 'head-shell',
    sourceSheetPath: shellSheetPath,
    sourcePath: shell.sourcePath,
    processedPath: shell.rgbaPath,
    promptPath: shellPromptPath,
  })
  const candidates: Awaited<ReturnType<typeof processCandidateSheet>> = []
  const candidateCompositions: Array<Awaited<ReturnType<typeof composeHeadShellWithLure>> & { index: 1 | 2 | 3 | 4 }> = []
  for (const lure of lureCandidates) {
    const lureProvenance = await componentProvenance({
      role: 'lure',
      sourceSheetPath: lureSheetPath,
      sourcePath: lure.sourcePath,
      processedPath: lure.rgbaPath,
      promptPath: lurePromptPath,
    })
    const compositeRgbaPath = resolveOutputPath(compositeRoot, `head_angler_bulb-candidate-${lure.index}-composite-rgba.png`)
    const composition = await composeHeadShellWithLure({
      shellPath: shell.rgbaPath,
      lurePath: lure.rgbaPath,
      outputPath: compositeRgbaPath,
      attachment: { x: 313, y: 180 },
      lureScale: 0.42,
      outputSize: { width: metadata.width, height: metadata.height },
      componentProvenance: { shell: shellProvenance, lure: lureProvenance },
    })
    const sourcePath = resolveOutputPath(compositeRoot, `head_angler_bulb-candidate-${lure.index}-source.png`)
    const rgbaPath = resolveOutputPath(compositeRoot, `head_angler_bulb-candidate-${lure.index}-rgba.png`)
    await sharp({ create: { width: metadata.width, height: metadata.height, channels: 3, background: '#00ff00' } })
      .composite([{ input: compositeRgbaPath }])
      .png(PNG_OPTIONS)
      .toFile(sourcePath)
    const extraction = await extractChromaAlpha({ sourcePath, outputPath: rgbaPath, safeBorderPixels: 16 })
    candidates.push({ index: lure.index, sourcePath, rgbaPath, extraction })
    candidateCompositions.push({ index: lure.index, ...composition })
  }
  return {
    sheetPath: lureSheetPath,
    candidates,
    candidateCompositions,
    componentEvaluations: {
      shell: shellCandidates.map(candidate => ({ index: candidate.index, extraction: candidate.extraction })),
      lure: lureCandidates.map(candidate => ({ index: candidate.index, extraction: candidate.extraction })),
    },
  }
}

export async function processProductionParts(options: {
  sourceRoot?: string
  runtimeAssetRoot?: string
  sourceSheetRoot?: string
} = {}): Promise<void> {
  const sourceRoot = options.sourceRoot ?? defaultSourceRoot
  const runtimeAssetRoot = options.runtimeAssetRoot ?? defaultRuntimeAssetRoot
  const sourceSheetRoot = options.sourceSheetRoot ?? resolveOutputPath(sourceRoot, 'generation', 'part-sheets')
  const runtimeRoot = resolveOutputPath(runtimeAssetRoot, 'parts')
  const expectedRuntime = new Set(PRODUCTION_PARTS.flatMap(part => [`parts/${part.id}.png`, `parts/${part.id}.webp`]))
  await pruneStaleFiles({ root: runtimeAssetRoot, directory: 'parts', expected: expectedRuntime, extensions: new Set(['.png', '.webp']) })
  await pruneStaleFiles({ root: sourceRoot, directory: 'parts', expected: new Set(PRODUCTION_PARTS.map(part => `parts/${part.id}.png`)), extensions: new Set(['.png']) })
  const output: unknown[] = []
  for (const part of PRODUCTION_PARTS) {
    const masterPath = resolveOutputPath(sourceRoot, 'parts', `${part.id}.png`)
    const pngPath = resolveOutputPath(runtimeAssetRoot, 'parts', `${part.id}.png`)
    const webpPath = resolveOutputPath(runtimeAssetRoot, 'parts', `${part.id}.webp`)
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
    const anglerComposite = part.id === 'head_angler_bulb' ? await processAnglerCompositeCandidates(sourceRoot) : undefined
    const sheetPath = anglerComposite?.sheetPath ?? resolveOutputPath(sourceSheetRoot, `${part.id}-sheet.png`)
    const sourceSheet = sheetPath
    await mkdir(join(sourceRoot, 'generation', 'part-sheets'), { recursive: true })
    const candidates = anglerComposite?.candidates ?? await processCandidateSheet({ sourcePath: sheetPath, outputDirectory: join(sourceRoot, 'generation', 'part-candidates', part.id), sourceId: part.id, safeBorderPixels: 16 })
    const chosen = candidates.find(candidate => candidate.index === approved.selected)!
    if (!chosen.extraction.approved) throw new Error(`${part.id} selected candidate failed extraction: ${JSON.stringify(chosen.extraction.diagnostics)}`)
    const master = part.id === 'extra_side_fins'
      ? await normalizeBilateralMaster({ rgbaPath: chosen.rgbaPath, masterPath })
      : part.id === 'extra_soft_tentacles'
        ? await normalizeContainedAlignedMaster({ rgbaPath: chosen.rgbaPath, masterPath, contentScale: 1.5 })
      : part.id === 'extra_moth_wings'
        ? await normalizeContainedAlignedMaster({ rgbaPath: chosen.rgbaPath, masterPath, contentScale: 1.1 })
      : await normalizeAlignedMaster({
        rgbaPath: chosen.rgbaPath,
        masterPath,
      })
    if (!master.hasAlpha || master.boundaryAlphaPixels !== 0) throw new Error(`${part.id} master failed alpha/safe-border gate`)
    await mkdir(runtimeRoot, { recursive: true })
    await sharp(masterPath).resize(1024, 1024, { fit: 'contain' }).png(PNG_OPTIONS).toFile(pngPath)
    await sharp(masterPath).resize(1024, 1024, { fit: 'contain' }).webp({ lossless: true }).toFile(webpPath)
    const postProcess = part.id === 'head_angler_bulb'
      ? 'head-shell-lure-composite-v1'
      : part.id === 'extra_side_fins'
        ? 'mirrored-bilateral-assembly-v1'
      : part.id === 'extra_soft_tentacles'
          ? 'contained-aligned-scale-1.5-v1'
        : part.id === 'extra_moth_wings'
          ? 'contained-aligned-scale-1.1-v1'
          : 'aligned-canvas-v1'
    const chosenComposition = anglerComposite?.candidateCompositions.find(candidate => candidate.index === approved.selected)
    output.push({
      id: part.id,
      visible: true,
      ...approved,
      sourceSheet,
      sheetPath,
      sheetSha256: await sha256(sheetPath),
      candidates,
      postProcess,
      ...(anglerComposite === undefined ? {} : {
        composition: chosenComposition,
        candidateCompositions: anglerComposite.candidateCompositions,
        componentEvaluations: anglerComposite.componentEvaluations,
      }),
      master,
      pngPath,
      pngSha256: await sha256(pngPath),
      webpPath,
      webpSha256: await sha256(webpPath),
    })
  }
  await writeFile(resolveOutputPath(sourceRoot, 'generation', 'production-index.json'), `${JSON.stringify(output, null, 2)}\n`)
  console.log(JSON.stringify({ count: output.length, visible: output.filter(value => (value as { visible: boolean }).visible).length, none: output.filter(value => !(value as { visible: boolean }).visible).length }))
}

if (process.argv[1]?.endsWith('process-production-parts.ts')) {
  void processProductionParts({
    sourceRoot: process.argv[2],
    runtimeAssetRoot: process.argv[3],
    sourceSheetRoot: process.argv[4],
  }).catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}
