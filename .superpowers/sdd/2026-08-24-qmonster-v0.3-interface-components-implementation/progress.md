# SDD ledger — plan: docs/superpowers/plans/2026-08-24-qmonster-v0.3-interface-components-implementation.md

## Setup

- Workspace: `C:/Project/QMonsterCreator/.worktrees/qmonster-v0.1/.superpowers/sdd/2026-08-24-qmonster-v0.3-interface-components-implementation`
- Isolated checkout: linked worktree `feature/qmonster-v0.1`; not a submodule; no second worktree created.
- Baseline: `npm test` passed 55 files, 479 tests passed, 2 skipped.
- Ruling (superseded): The default `C:/Windows/System32/bash.exe` is an unconfigured WSL launcher, so the initial workspace and Task 1 brief were generated with exact PowerShell equivalents — cost if wrong: those two handoff artifacts must be regenerated.
- Ruling: `C:/Software/Git/bin/bash.exe` was subsequently located; use the bundled SDD scripts through Git Bash for all remaining briefs and review packages — cost if wrong: none beyond regenerating ignored handoff artifacts.

## Preflight consistency scan

| Tasks | Producer / consumer or shared surface | Finding / ruling |
| --- | --- | --- |
| 1 → 2–11 | Task 1 commits the dirty rejected-v0.2 snapshot; every later task assumes a clean baseline | Consistent. Task 1 must complete before any v0.3 implementation. |
| 2 → 3 | Connector contracts and `generator-core/src/index.ts` feed connector filtering | Consistent; Task 3 consumes only exported Task 2 types. |
| 2 → 4 | Connector profiles, structural variants, bridges, and exact renderer mapping feed the renderer | Consistent; renderer returns null connector metrics for v0.1/v0.2. |
| 2 → 5 | Catalog contracts define the source manifest/builder output | Consistent; Task 5 must emit exact-rig variants and declared resource hashes. |
| 3 → 4 | Pair compatibility decisions feed interface-tree resolution | Consistent; generator remains image-independent, renderer owns resource decoding. |
| 3 → 10 | Blocking selection diagnostics feed editor/manual/reroll behavior | Consistent; Task 10 exposes them without adding fallback. |
| 4 → 5 | Solver, mesh, masks, metrics define what pipeline validation must produce | Consistent; shared thresholds are literal global constraints. |
| 4 ↔ 10 | `App.test.tsx` and PreviewCanvas/result contracts are extended first for metrics, later for v0.3 registry/UI | Consistent; Task 10 builds on explicit test-double updates from Task 4. |
| 4 ↔ 11 | `App.test.tsx` first tests v0.3 capability, then default-version switch | Consistent; Task 11 test must remain red until full approval exists. |
| 5 → 6 | Guides, manifest parser, processor, catalog builder, and slice validator feed biped production | Consistent; full v0.3 validation is intentionally red only for missing assets before Task 6. |
| 5 ↔ 7/8/9 | `interface-manifest.json` is created by Task 5 and incrementally completed by asset tasks | Consistent; later tasks append exact variants and never rewrite approved biped bytes. |
| 5 ↔ 11 | `packages/asset-catalog/package.json` adds explicit v0.3 validation in Task 5; Task 11 changes only the default alias | Consistent. |
| 6 → 7 | Approved biped bridge grammar and eight slice assets seed remaining body/head work | Consistent; explicit user approval is a hard dependency. |
| 6 → 8 | Approved shoulder/hip grammar feeds remaining exact-rig limbs | Consistent; four biped slice limb assets are reused byte-for-byte. |
| 6 → 9 | Approved connector grammar feeds tail/extra production and full catalog | Consistent; none parts remain resource-empty. |
| 7 ↔ 8 | Both update `interface-manifest.json` and `production-evidence.json` | Consistent because execution is sequential; Task 8 must preserve Task 7 entries. |
| 7/8 → 9 | Complete body/head/limb matrices feed full structural catalog | Consistent; Task 9 is the first full-production validation point. |
| 9 → 10 | Complete v0.3 catalog/assets feed explicit registry and 21-entry review | Consistent; public default remains v0.2. |
| 10 ↔ 11 | `App.tsx`, `App.test.tsx`, and `spec-file.ts` first gain explicit v0.3 support, then flip defaults after approval | Consistent; the second commit is deliberately approval-gated. |
| Task 1 internal | Rejection tests, artifact move, snapshot verification, commit | Consistent. Expected `acceptance:verify` failure is specified and cannot be treated as suite failure. |
| Task 2 internal | Tests require the union/types that implementation defines | Consistent. Legacy branch accepts omitted `mode`; connector `rigId` must equal containing variant. |
| Task 3 internal | Tests cover exact rig, warp, and transactional manual replacement | Consistent. Four generator-time codes are distinct from renderer-time failures. |
| Task 4 internal | Pure solver/mesh/metric tests precede renderer integration | Consistent. Renderer adds both `CONNECTOR_COMPOSITE_FAILED` and `STRUCTURE_DISCONNECTED`. |
| Task 5 internal | Schema/guide/processor/builder/slice tests precede source pipeline | Consistent. Generated guide pixels are excluded from runtime assets. |
| Task 6 internal | Eight assets × four candidates plus three bridge classes produce the fixed 16 combinations | Consistent. Acceptance JSON is forbidden before the user's reply. |
| Task 7 internal | Five bodies and twelve exact-rig heads match the production matrix | Consistent. Re-anchoring applies to retained head features only after accepted shells. |
| Task 8 internal | Nine arms and twelve legs; four biped slice variants reused, seventeen generated | Consistent. Splitter tests cover paired-node roots. |
| Task 9 internal | Nine non-none tails, nine extras, explicit none, retained non-structural provenance | Consistent. Agent part reviews cannot satisfy user composite approval. |
| Task 10 internal | Exact v0.3 capability/goldens/metrics precede fixed 21-entry user sheet | Consistent. Default remains v0.2 throughout the task. |
| Task 11 internal | Approval hash validation precedes default flip and full verification | Consistent. Release evidence is committed only after all commands pass. |

## Progress

- Task 1: reviewer ⚠ resolved by controller — pre-move/RED-GREEN commands are preserved in the implementer report; post-commit `git status --short` is empty; archived artifact and manifest hashes are present in the reviewed commit.
- Task 1: complete (commits c6578ad..a11adca, review clean)
- Task 2: in progress
- Task 2: Ruling: renderer selection must use an explicit `0.1.0`/`0.2.0`/`0.3.0` version switch and reject unsupported versions; the spec's no-fallback guarantee overrides the plan's legacy `compositionPolicy` inference snippet — cost if wrong: malformed in-memory catalogs will fail earlier instead of being routed heuristically.
- Task 2: Ruling: pairwise receiver/plug warp and joint material-family compatibility is owned by Task 3, not duplicated in the Task 2 shape validator — cost if wrong: Task 2 alone cannot guarantee a generated pair, so Task 3 is load-bearing and may not be skipped.
- Task 2: Ruling: reject `mode: interface` in any v0.2 catalog now to preserve old-version semantics; byte/hash/stale-resource validation for valid v0.3 interface assets remains owned by Task 5 — cost if wrong: a previously nonexistent malformed v0.2 shape becomes an explicit parse error, while v0.3 cannot be production-released before Task 5.
- Task 2: fix round 1/5 started (exact-version switch, v0.2 interface rejection, focused negative tests; fix base cc9530c)
- Task 2: fix round 1/5 (3 addressed, 0 open; commit 4113f48)
- Task 2: complete (commits a11adca..4113f48, review clean)
- Task 3: in progress
- Task 3: fix round 1/5 started (actual selection rig enforcement, concrete connector diagnostics, structural-preserving local reroll; fix base 4b7667e)
- Task 3: fix round 1/5 (3 addressed, 0 open; commit ffefb3e)
- Task 3: complete (commits 4113f48..ffefb3e, review clean)
- Task 4: in progress
- Task 2: Ruling: exact registry support is limited to installed `0.1.0`, `0.2.0`, and `0.3.0`; arbitrary `0.0.9`, prerelease, or build-tag catalog versions must produce a structured unsupported-renderer/catalog diagnostic rather than borrow v0.1 behavior or throw — cost if wrong: historical non-exact catalogs that old tests treated as importable will now be rejected and require an explicit future migration path.
- Task 2: supplemental fix round 2/5 started after Task 4 full-suite audit (structured unsupported-version diagnostics and exact-version import tests; fix base 66e8ed0)
- Task 2: supplemental fix round 2/5 (3 addressed, 0 open; commit 046cb72)
- Task 2: complete remains valid after supplemental review (commits a11adca..046cb72, review clean)
- Task 4: fix round 1/5 started (connector masks/metrics, blocking diagnostics, transformed placement/zones/sampling, explicit node mapping, affine failure cleanup; fix base 046cb72)
- Task 4: Ruling: use the separately reviewed current head `046cb72` as the scoped re-review base instead of historical Task-4 head `66e8ed0`, because the interleaved Task-2 import fix is already independently approved and including it would pollute the renderer fix diff — cost if wrong: the re-review relies on the initial Task-4 review for unchanged renderer code and the separate Task-2 re-review for the omitted interleaved commit.
- Task 4: fix round 1/5 (7 addressed, 2 open; commit 97bc337 — real raster seam/metric evidence still missing)
- Task 4: fix round 2/5 started (renderer-level asymmetric mask pixels and metrics from actual raster; remove/integrate dead seam helper; fix base 97bc337)
- Task 4: fix round 2/5 (2 addressed, 1 partial; commit 278ee4c — raster proof variants changed seed and swapped both mask classes together)
- Task 4: fix round 3/5 started (same-seed, independently varied foreground/background causal pixel proof; fix base 278ee4c)
- Task 4: fix round 3/5 (1 addressed, 0 open; commit 9ccae9b)
- Task 4: complete (commits ffefb3e..9ccae9b, review clean after 3 fix rounds)
- Task 5: in progress
- Task 5: fix round 1/5 started (canonical runtime namespace, node byte/stale validation, exact manifest/index provenance, deterministic guide validation, paired-node uniqueness, realpath containment; fix base c5d2b93)
- Task 5: fix round 1/5 (3 addressed, 3 partial; commit 3e8b6be — runtime format, bridge duplicate/path canonicality, source-root containment remain)
- Task 5: Ruling: remove the staged biped body part-ID whitelist introduced in round 1 and derive required receiver connectors from actual compatible non-none structural child capabilities in the catalog — cost if wrong: a catalog with no active tail/extra variants will no longer be forced to carry unused receivers, so future full catalogs depend on completeness validation to ensure those active variants are present.
- Task 5: fix round 2/5 started (encoding-extension match, duplicate bridge/canonical path rejection, source-root realpath containment, data-driven receiver requirements; fix base 3e8b6be)
- Task 5: fix round 2/5 (4 addressed, 0 open; commit 0b69527)
- Task 5: complete (commits 9ccae9b..0b69527, review clean after 2 fix rounds)
- Task 6: Ruling: the plan names a nonexistent aggregate `biped-structure-guide.png`; use and inspect Task 5's exact per-asset/per-connector guide PNGs as the layout references for each generation call — cost if wrong: prompts lack one holistic overlay, but each declared connector envelope remains exact and machine-verifiable.
- Task 6: Ruling: transition bridges are non-visible structural-solver and continuity evidence; final visual occlusion is defined by each connector's data-declared organic foreground/background split. Replace the obsolete final-contour-pixel assertion with a real connector-metric/bridge-geometry causal assertion — cost if wrong: bridge contour changes remain machine-verifiable but are intentionally not exposed as visible final-color pixels.
- Task 6: Ruling: temporarily retire `head_round_dome` from the v0.3 production catalog, selection surface, and review slice while preserving its source and candidate evidence for future rework; the canonical slice is now 2 bodies × 1 mushroom head × 2 arms × 2 legs = 8 combinations — cost if wrong: v0.3 exposes only the visually accepted mushroom head and round-head evidence remains intentionally non-selectable until rebuilt.
- Task 6: Ruling: the user's exact reply `ok` to the explicit visual-approval question approves the current canonical 8 sheet bound to contact-sheet SHA-256 `58766df74141fae1abcb66f447529b8d32ede934b11394877c12d2c478feaef4`, 256-sheet SHA-256 `0fa54d8968155465f84eec0de75303520bea637d1debae1f58e1f12301bd9974`, and manifest SHA-256 `058dec48847ed6caa93dd58359c887c32c440de01f7522e14ee151d00ab7aa15` — cost if wrong: approval would be bound to different visual bytes, so any later byte change requires a new explicit user decision.
- Task 6: complete (user-approved canonical 8-entry biped slice; exact hash-bound acceptance record and production evidence finalized for the Task 6 commit)
- Task 6: fix round 1/5 started (catalog boost closure, executable acceptance binding, complete slice metrics, temporary browser inputs, and obsolete-artifact cleanup; fix base 500d800)
- Task 6: Ruling: Task 5 Step 7 explicitly expects full `validate:v0.3.0` to remain red before the later production matrix and audit tasks; for this Task 6 fix round, require the generated catalog structure/interface-production stage to report zero diagnostics, but do not copy non-structural assets, fabricate `audit/v0.3.0/evidence-manifest.json`, or broaden the interface-only source index to hide the downstream Task 7–9 gaps — cost if wrong: Task 6 would either counterfeit future production evidence or weaken the package command's eventual full-production gate.
- Task 6: fix round 1/5 complete (5 addressed, 0 open; approved slice/sheet/manifest bytes unchanged from 500d800)
- Task 6: fix round 2/5 started (semantic visual-mapping closure, canonical acceptance identity/version/timestamp enforcement, and clean-checkout retired-runtime residue; fix base a19b619)
- Task 6: fix round 2/5 complete (3 addressed, 0 open; approved sheet/256-sheet/manifest/acceptance bytes unchanged from a19b619)
