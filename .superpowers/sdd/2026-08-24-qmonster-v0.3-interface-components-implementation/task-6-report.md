# Task 6 biped vertical-slice report

Status: `APPROVED`

Date: 2026-08-25

## Approval gate

The current canonical 8-entry biped slice is machine-valid and was visually self-reviewed at 2048 px per entry and at 256 px per entry. After an explicit visual-approval question, the user replied exactly `ok`, approving the exact hashes recorded below. One canonical acceptance JSON has been created. Task 6 is ready for its requested commit.

- Canonical acceptance path: `packages/asset-catalog/review/v0.3.0/biped-vertical-slice-acceptance.json`
- Canonical acceptance SHA-256: `f1c14462fb4f14ad359cbe3cc029d13c1e85592bf5d25cb5630bd8b938be3520`
- Repository-wide `biped-vertical-slice-acceptance.json` count: `1`
- `review-record.json` is agent self-review metadata only: its status is `machine-valid-self-reviewed-awaiting-user-slice-approval` and `userApproved` is `false`.

## Canonical roster ruling

`head_round_dome` is temporarily retired from the v0.3 production manifest, public catalog, source index, selection surface, and review slice. Its source art, node art, four candidate images, candidate sheets, prompt, layout reference, guides, and review selection evidence remain preserved for future rework. The two retired guide PNGs were moved from the active exact-inventory root into `asset-source/v0.3.0/guides/retired/head_round_dome`; the four candidates remain in `asset-source/v0.3.0/generation/biped/head_round_dome`. No round-head evidence file was deleted.

The canonical Cartesian slice is now:

- 2 bodies: `body_biped_peanut`, `body_biped_tall`
- 1 head: `head_mushroom_cap`
- 2 arms: `arms_short_plush`, `arms_long_noodle`
- 2 legs: `legs_webbed`, `legs_mushroom`
- Total: 2 × 1 × 2 × 2 = 8 unique combinations

The rebuilt public catalog contains 7 structural parts and no `head_round_dome`. The rebuilt interface source index contains 7 structural sources plus 3 bridge sources and no `head_round_dome`.

## Review artifacts

| Artifact | Absolute path | SHA-256 |
| --- | --- | --- |
| 8-entry contact sheet, 512 px per tile | `C:\Project\QMonsterCreator\.worktrees\qmonster-v0.1\packages\asset-catalog\review\v0.3.0\biped-vertical-slice.png` | `58766df74141fae1abcb66f447529b8d32ede934b11394877c12d2c478feaef4` |
| 8-entry contact sheet, 256 px per tile | `C:\Project\QMonsterCreator\.worktrees\qmonster-v0.1\packages\asset-catalog\review\v0.3.0\biped-vertical-slice-256.png` | `0fa54d8968155465f84eec0de75303520bea637d1debae1f58e1f12301bd9974` |
| Slice manifest | `C:\Project\QMonsterCreator\.worktrees\qmonster-v0.1\packages\asset-catalog\review\v0.3.0\biped-vertical-slice-manifest.json` | `058dec48847ed6caa93dd58359c887c32c440de01f7522e14ee151d00ab7aa15` |
| Public catalog | `C:\Project\QMonsterCreator\.worktrees\qmonster-v0.1\packages\asset-catalog\catalog\v0.3.0\catalog.json` | `c231886b381c4b2e36f01cc90b8960ab72d04fc2349566edf2627ec30c8eb21b` |
| Interface source index | `C:\Project\QMonsterCreator\.worktrees\qmonster-v0.1\packages\asset-catalog\source-index-v0.3.0.json` | `fe9ad8331d741b030f2c43497237d2bf9b88cf1ca875c8bafb41ba023f436dd0` |
| Canonical interface manifest | `C:\Project\QMonsterCreator\.worktrees\qmonster-v0.1\asset-source\v0.3.0\interface-manifest.json` | `68851ef639b1d7fb170882044ebc1c74d5998b88f96a168fbb794cf022064d41` |
| Candidate/selection evidence | `C:\Project\QMonsterCreator\.worktrees\qmonster-v0.1\asset-source\v0.3.0\generation\biped-slice-evidence.json` | `26a08e6b1047ea050826edaa33325d4083077ccfac32a6e533a9b424a7ed8cec` |
| Agent self-review record | `C:\Project\QMonsterCreator\.worktrees\qmonster-v0.1\packages\asset-catalog\review\v0.3.0\review-record.json` | `70ff70f3f1dc6e01039fd3eb87f73f881c81b578a221be80f76eec0f6eb5cd5e` |
| User acceptance record | `C:\Project\QMonsterCreator\.worktrees\qmonster-v0.1\packages\asset-catalog\review\v0.3.0\biped-vertical-slice-acceptance.json` | `f1c14462fb4f14ad359cbe3cc029d13c1e85592bf5d25cb5630bd8b938be3520` |

The original-source sheet is 2048 × 1024 RGBA and the 256-per-entry sheet is 1024 × 512 RGBA. All eight standalone originals are 2048 × 2048 RGBA; all eight review entries are 256 × 256 RGBA.

Close-ups used for final inspection:

- Peanut/mushroom/plush/webbed: `packages/asset-catalog/review/v0.3.0/biped-vertical-slice-entries/00.png`
- Peanut/mushroom/noodle/mushroom legs: `packages/asset-catalog/review/v0.3.0/biped-vertical-slice-entries/03.png`
- Tall/mushroom/plush/webbed: `packages/asset-catalog/review/v0.3.0/biped-vertical-slice-entries/04.png`
- Tall/mushroom/noodle/mushroom legs: `packages/asset-catalog/review/v0.3.0/biped-vertical-slice-entries/07.png`
- Their 256 px counterparts are under `biped-vertical-slice-entries-256`.

## Machine metrics

All 8 fixed unique structural combinations rendered at 2048 × 2048 and 256 × 256. The slice manifest contains 40 connector measurements and zero diagnostics.

| Metric | Final extremum | Required threshold |
| --- | ---: | ---: |
| Receiver coverage | min `0.917136` | `>= 0.90` |
| Plug coverage | min `0.921261` | `>= 0.90` |
| Largest alpha-mass component | min `0.999978` | `>= 0.99` |
| Normalized centerline gap | max `0.011765` | `<= 2` |
| Limb alpha outside body | min `0.663997` | `>= 0.65` |
| Eyes inside safe zone | min `0.999756` | passing |
| Eyes visible | min `1.000000` | passing |
| Mouth inside safe zone | min `0.901090` | passing |
| Mouth visible | min `0.935643` | passing |
| Visible bounds | x `300..1740`, y `64..1920` | inside 2048 frame |

The first canonical-8 render exposed a shared tall-body neck metric failure: `plugCoverage=0.825074`. A real Canvas2D regression fixture reproduced the cause: structural metrics were incorrectly clipped by the visual transition-front/back and connector-foreground/background pairing. The final shared fix measures the solved warped neutral bridge geometry, while final visible color continues to use the data-declared organic head foreground/background split. After the shared fix, all 8 entries were rerendered once and both validators returned zero diagnostics.

## Candidate and production evidence

The original candidate roster contains 44 distinct built-in image-generation calls: four candidates for each of the original eight structural assets and each of three bridge classes. Two later built-in targeted image-edit calls healed shared body receiver artifacts without changing selected identities, for 46 built-in calls total. All project-bound candidates and edits remain under `asset-source/v0.3.0/generation/biped`.

Production selections:

- `body_biped_peanut`: candidate 3, followed by targeted clean-surface edit
- `body_biped_tall`: candidate 2, followed by targeted clean-surface edit
- `head_mushroom_cap`: candidate 3
- `arms_short_plush`: candidate 4
- `arms_long_noodle`: candidate 4
- `legs_webbed`: candidate 3
- `legs_mushroom`: candidate 3
- Bridges: neck 3, shoulder 2, hip 4

Retired evidence retained for future rework: `head_round_dome` candidate 3 and all four original candidate PNGs, without production-catalog or review-slice exposure.

The deterministic extraction results preserve genuine transparent alpha. Guide/profile stamps remain evidence and metadata only; clean runtime nodes contain no guide lines, arrows, receiver holes, rings, rectangular bands, or contour colors. Structural child roots overlap behind the body. Neutral transition bridge geometry participates only in structural solver/continuity metrics and is not drawn as final color.

## Verification

- Option-B catalog/roster TDD RED: 4 expected failures, each caused by the old round-head/16-entry behavior.
- Option-B catalog/roster GREEN: 4 files, 12 tests passed.
- Retired-guide inventory TDD: exact `INTERFACE_GUIDE_STALE` RED for the two retained round guides, then GREEN after moving them into the round-head evidence directory without weakening stale-guide validation.
- Structural-metric decoupling TDD: real Canvas2D RED with `CONNECTOR_COMPOSITE_FAILED` under deliberately misaligned visual occlusion masks, then GREEN after measuring neutral bridge geometry.
- Focused Vitest suite: 8 files, 29 tests passed.
- Chromium interface suite: 6 tests passed.
- Production head-mask validation: 1 passed, 32 skipped.
- Renderer structural ordering validation: 1 passed, 50 skipped.
- `npm run typecheck`: passed.
- Default-concurrency `npm test` exposed two distinct 5-second resource-contention timeouts during final verification and neither is hidden: before the prompt-validation boundary extraction, `scripts/validate-interface-slice.test.ts` timed out at `5013 ms` and `5026 ms`; after that extraction was GREEN, `scripts/extract-chroma-alpha.test.ts` timed out once at `5958 ms`. The prompt file passed alone (7/7), its extracted prompt-only behavior passed in `2..4 ms`, and the chroma file passed alone (9/9, `2.49 s` test time). No timeout threshold was changed.
- Resource-isolated full suite: `npx vitest run --maxWorkers=1` passed all 71 files; 585 tests passed, 2 skipped (`106.37 s`).
- `npx tsx scripts/validate-biped-slice-review.ts --version 0.3.0`: 8 entries, 0 diagnostics.
- `npx tsx scripts/validate-interface-slice.ts --version 0.3.0 --rig biped --production`: guides valid, 21 production sources checked, 8 biped entries checked, 0 diagnostics.

## Visual self-review

The two contact sheets plus entries 00, 03, 04, and 07 at original resolution and entries 00, 04, and 07 at 256 px were inspected after the final rerender. The mushroom head remains in front of the body with an organic curved lower edge; facial features remain in front of the head. No round-head notch, guide/grid pixel, synthetic rectangular bridge, exposed connector socket, ring/patch, straight noodle connector bar, or full-width horizontal cut is visible. Plush/noodle arm roots and both leg classes emerge from behind the body as intended.

## Approval decision

The user's exact reply `ok` approves only the canonical 8-entry contact sheet SHA-256 `58766df74141fae1abcb66f447529b8d32ede934b11394877c12d2c478feaef4`, the 256-sheet SHA-256 `0fa54d8968155465f84eec0de75303520bea637d1debae1f58e1f12301bd9974`, and manifest SHA-256 `058dec48847ed6caa93dd58359c887c32c440de01f7522e14ee151d00ab7aa15`. Any later visual or manifest byte change requires a new explicit user decision.

## Independent review fix round 1

The post-approval independent review returned five actionable findings. All five were fixed without invoking the slice renderer and without changing the approved sheet, 256-sheet, manifest, or acceptance bytes.

1. Catalog closure: a real generated-catalog RED reproduced four dangling semantic boost keys after the structural roster was reduced. `buildInterfaceCatalog` now determines the final part-ID set first and removes only semantic-trait and modifier boost keys that target absent parts. Retained boost keys and `excludes` remain unchanged. The rebuilt catalog reports zero structural/interface diagnostics.
2. Acceptance enforcement: `validateBipedSliceReview` now recursively finds the exact acceptance filename outside dependency metadata, requires exactly one record, verifies the user-approval fields, entry count, and live sheet/256/manifest hashes, and rejects missing, tampered, or duplicate records. The existing acceptance bytes remain unchanged.
3. Metric completeness: every entry must contain exactly one `neck`, `shoulderLeft`, `shoulderRight`, `hipLeft`, and `hipRight` metric; every existing connector threshold remains enforced. Face ratios and visible bounds are checked against the canonical catalog's loaded `compositionPolicy`, not duplicated threshold literals. RED mutations covered missing/duplicate connectors plus face and bounds tampering.
4. Temporary browser inputs: render-only browser JSON now lives below an OS `mkdtemp` directory and is removed in `finally`, including failure paths. The tracked review `biped-vertical-slice-inputs/00..07.json` delivery was removed; the test proves the temporary root is outside review and absent after failure.
5. Obsolete artifacts: after resolving and verifying every target below this worktree, 47 exact Task-6 files and four empty directories were removed. These comprised retired round-head runtime copies, obsolete review entries 08–15 at both sizes, all obsolete browser inputs, three `tdd-*` review directories, and `debug-half.png`. Round-head source art, four candidates, prompt/selection evidence, and retired guides remain preserved.

Task-boundary ruling: Task 5 Step 7 explicitly expects the full package `validate:v0.3.0` command to remain red before later production tasks. Its generated-catalog/interface stage is now green with zero diagnostics. The subsequent full-production CLI still reports the intentionally absent non-structural v0.3 runtime/source/audit matrix owned by Tasks 7–9; this fix round did not copy those assets, fabricate the future audit manifest, broaden the interface-only source index, or weaken that later gate.

Fix-round verification:

- Catalog RED/GREEN: removed-part semantic/modifier boost behavior reproduced, then `scripts/build-interface-catalog.test.ts` passed 2/2.
- Acceptance and metrics RED/GREEN: missing/tampered/duplicate acceptance, missing/duplicate connectors, and face/bounds mutations reproduced, then `scripts/validate-biped-slice-review.test.ts` passed 7/7.
- Temporary-input RED/GREEN: missing helper and the old review input directory reproduced, then `scripts/render-biped-interface-slice.test.ts` passed 2/2.
- Combined focused Vitest: 4 files, 18 tests passed.
- `npm run typecheck`: passed.
- Chromium interface suite: 6/6 passed.
- Resource-isolated full Vitest: 71/71 files; 589 passed, 2 skipped (`98.99 s`).
- `validate-interface-slice --version 0.3.0 --rig biped --production --catalog-if-present ...`: 21 sources, 8 entries, 0 diagnostics.
- Canonical acceptance validator: 8 entries, 0 diagnostics.
- Leftover/preservation audit: obsolete targets absent; all four retired round-head candidates and both retired guides present.
- Approved hashes rechecked unchanged: sheet `58766df74141fae1abcb66f447529b8d32ede934b11394877c12d2c478feaef4`, 256 sheet `0fa54d8968155465f84eec0de75303520bea637d1debae1f58e1f12301bd9974`, manifest `058dec48847ed6caa93dd58359c887c32c440de01f7522e14ee151d00ab7aa15`, acceptance `f1c14462fb4f14ad359cbe3cc029d13c1e85592bf5d25cb5630bd8b938be3520`.
