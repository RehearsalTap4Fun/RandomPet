# Task 7 body/head variant report

Status: `APPROVED_COMPLETE`

Date: 2026-08-25

## Baseline

- Branch: `feature/qmonster-v0.1`
- Base commit: `f0292476de84c5c17b5fd8a392f8b00d0cdf3f7d`
- Worktree clean before Task 7 changes.
- All four frozen Task 6 hashes matched the approved values before Task 7 changes.

## User ruling

The user selected `A`: re-author `head_round_dome` now as a new connection-aware component.

The user subsequently selected `B` on 2026-08-26, rejecting all three first-round body/head matrices. The exact feedback is to weaken or hide the exposed organic connector tongue so heads read as naturally grown from bodies. The rejected original, 256, and manifest bytes are preserved immutably under `packages/asset-catalog/review/v0.3.0/rejected/task7-visible-tongue-round-1/`; `rejection-record.json` binds the decision to all nine SHA-256 values. No Task 7 approval JSON exists.

### Rework root cause and frozen boundary

- Root cause: the head plug's lower pixels were still allocated to the head foreground mask. Because composition is `head background -> body -> head foreground`, this repainted the plug over the body as a tongue/chin/stem even though continuity and gap metrics passed.
- The exact Task 6 approved input boundary was reconstructed from final Task 6 commit `f0292476de84c5c17b5fd8a392f8b00d0cdf3f7d`: 132 distinct source/runtime input files, including the approved biped bodies, mushroom head, arms, legs, bridges, connector masks, render nodes, and retained facial parts.
- Every one of those 132 current bytes matches its Task 6 SHA-256. The exact path/hash manifest is `packages/asset-catalog/review/v0.3.0/task6-approved-input-integrity.json` (SHA-256 `e9b55e1f52d89bb022c2515dd6bb987ae76a61770422b38f84393bc4c824d650`). Rework must use Task 7-versioned masks/geometry for any frozen biped input rather than mutating these bytes.

### Rework TDD RED

- Added a connector-local, composition-aware regression metric. `visibleTongueDepthRatio` measures the visible head-attributed span inside the declared inward plug envelope divided by declared plug depth; `visibleTongueAreaRatio` measures visible head-attributed alpha in that envelope divided by structural head alpha there after `background -> body -> foreground` occlusion attribution. This uses connector geometry and layer masks, not screenshot coordinates.
- Frozen limits: depth `<= 0.25`, area `<= 0.25`.
- RED command: `npx vitest run scripts/body-head-contact-metrics.test.ts`.
- RED result: all 20 rejected pairs fail. Nineteen pairs report depth `0.65` and area `0.65–0.681008040160278`; the frozen Task 6 biped mushroom pair reports depth `1` and area `1` on both biped bodies. This isolates the causal foreground allocation instead of merely rechecking connectivity.

## Evidence log

### TDD

- RED: `npx vitest run scripts/build-interface-catalog.test.ts -t "five body variants"` failed because the real manifest contained only the two approved biped bodies.
- GREEN: the same focused command passed after the grouped exact-rig manifest/catalog implementation.
- The body/head review validator was also introduced RED-first: the focused test failed with `validateBodyHeadReview is not a function`, then passed after exact roster, metric, dimension, and SHA-256 validation was implemented.

### Image generation and selection

- 18 distinct built-in `image_gen` calls: 14 exact first-pass structural candidates and 4 targeted regenerations.
- Accepted first pass: three bodies; biped round/angler/shadow; blob shadow; all four floating heads.
- Targeted rework:
  - blob round candidate 1 rejected for a baked cylindrical pedestal; candidate 2 accepted.
  - blob mushroom candidate 1 rejected for a rectangular conventional stem; candidate 2 accepted.
  - blob angler candidate 1 rejected for baked eye cavities; candidate 2 rejected for plastic lure/base ring/palette drift; candidate 3 accepted.
- Every generated candidate and every final original/256 review sheet was inspected. Candidate, extraction, prompt, guide, selection, and metric evidence is preserved below `asset-source/v0.3.0/generation/`.
- The approved Task 6 biped mushroom pixels were reused unchanged; Task 7 added only its required face-safe-zone and feature-socket metadata.

### Production result

- Manifest: 5 exact body variants and four head identities for each of `blob`, `biped`, and `floating`.
- Real catalog build: 46 parts.
- Body/head scope validation: 49 production source assets checked; blob 8, biped 8, floating 4 matrix entries; zero diagnostics.
- Matrix legend: rows are exact body identities; columns, in order, are `head_round_dome`, `head_mushroom_cap`, `head_angler_bulb`, `head_shadow_hood`.

Canonical review artifacts:

| Rig | Original sheet SHA-256 | 256 sheet SHA-256 | Manifest SHA-256 | Machine metrics |
| --- | --- | --- | --- | --- |
| blob | `24fd7568094399343a7e274fa557a4a08bf694e5380c3fbc7785a055af4da787` | `b89833969528e24efe16704349025c8f6af2ae83b0bf33145f299b0d9335eeb2` | `2f0e231776d7928fe15c0c171cdc392e79a546c214bf860b128bb6355ab85cc2` | 8/8 pass; min component ratio `0.999978641704952`; max centerline gap `0` |
| biped | `f7cb497c270076a19cb367592e7c49687db32be6dfc8fa1093b40dfa9ca4e4d1` | `a6e5e7e654078c2de927aab10b6ffd0b6dc6eb6576dc50a73c2794f0518bb591` | `24175e37a49590f6483f8b4108a06ccf4ee02c9d16240f20682263edc43b5fbf` | 8/8 pass; min component ratio `0.999987115154997`; max centerline gap `0` |
| floating | `621685b5dd955cc8aa731941e2fec9fe613a49940f66ab059de3033b78001cbc` | `19b3f17de3ae2cf00a6d84324243f6f2dbc014dab8873e761ccc59f2c367be91` | `8d6f50bd55cd2e88af06b2f4d34e811750956b79cb535e70c376ebc0d40e6624` | 4/4 pass; min component ratio `0.999980598342751`; max centerline gap `0` |

### Verification

- `npx vitest run scripts/build-interface-catalog.test.ts scripts/process-interface-asset.test.ts packages/renderer-canvas/src/interface-tree.test.ts`: 15/15 passed.
- `npx vitest run scripts/validate-interface-slice.test.ts`: 8/8 passed.
- `npx tsx scripts/validate-interface-slice.ts --version 0.3.0 --scope body-head`: zero diagnostics.
- `npm run typecheck`: passed.
- `npx vitest run --maxWorkers=1`: 71/71 files passed; 592 passed, 2 skipped.
- `git diff --check`: passed (only configured CRLF conversion warnings).

### Frozen Task 6 checkpoint

All frozen hashes remain byte-identical:

- sheet `58766df74141fae1abcb66f447529b8d32ede934b11394877c12d2c478feaef4`
- 256 sheet `0fa54d8968155465f84eec0de75303520bea637d1debae1f58e1f12301bd9974`
- manifest `058dec48847ed6caa93dd58359c887c32c440de01f7522e14ee151d00ab7aa15`
- acceptance `f1c14462fb4f14ad359cbe3cc029d13c1e85592bf5d25cb5630bd8b938be3520`

### User review concerns

- The new heads use a deliberately visible tapered organic connector tongue so the three-layer hierarchy is auditable. The join is continuous and body-occluded at its lower region, but the tongue/chin prominence is a visual decision for the user.
- The reused approved biped mushroom retains its narrow cylinder-like stem. It was required to remain byte-identical, so Task 7 did not redraw it.
- The 256 sheets preserve silhouette/identity readability, but long labels are truncated; the canonical matrix order above is the unambiguous legend.

No Task 7 approval/acceptance JSON was created and no user approval is claimed. The nonapproval selection record remains explicitly `WAITING_FOR_USER_APPROVAL` with `userApproved: false`.

## Superseding natural-neck rework after user rejection B

This section supersedes the first-round visual result and its obsolete tongue/stem concerns above. The user rejected the original three matrices with decision `B`. The rejected bytes remain immutable under `packages/asset-catalog/review/v0.3.0/rejected/task7-visible-tongue-round-1/`; its rejection record SHA-256 is `4207566342c7a89b8181922e66ba6b180231bb3eda3dcd1b42e270a375f7e746`.

### Root cause and causal regression

- The authored head rasters, not only their masks, contained long central lobes outside the declared plug envelope. Receiver-depth/mask-only sweeps therefore could not make the joins natural.
- The fixed causal gates are: visible connector depth ratio `<= 0.10`, visible connector area ratio `<= 0.10`, and silhouette-relative central-lobe depth ratio `<= 0.20`. Connectivity remains `>= 0.99` and centerline gap remains `<= 2 px`.
- The rejected old biped mushroom source exceeds the central-lobe limit, proving the test detects the original stem independently of receiver depth.
- All 12 exact rig/head variants now use new Task7-versioned natural-neck source/runtime paths. No frozen Task6 head/body source, runtime image, or connector mask was overwritten.

### Image generation and selection

- One biped mushroom prototype passed both biped bodies at original and 256 before fan-out.
- Eleven further distinct rig/head candidates were produced in eleven separate built-in image-generation calls.
- Blob round candidate 1 failed the fixed central-lobe metric at `0.215`; candidate 2 removed the lobe but was rejected on visual inspection for a near-straight lower cut; candidate 3 passed the same unchanged threshold and the full matrix gate.
- Rework total: 14 built-in image-generation calls, comprising 12 prototype/fan-out calls and 2 targeted blob-round regenerations.
- Every selected output was extracted to true alpha with zero boundary-alpha pixels and retained partial alpha. Prompt, extraction, candidate-selection, and mask evidence are recorded in `task7-head-natural-neck-production.json`, `task7-body-head-occlusion-rework.json`, and `task7-head-natural-neck-rework.json`.

### Current canonical review artifacts

Matrix legend: rows are exact body identities. Columns are `head_round_dome`, `head_mushroom_cap`, `head_angler_bulb`, and `head_shadow_hood`, in that order.

| Rig | Original SHA-256 | 256 SHA-256 | Manifest SHA-256 | Metric extrema |
| --- | --- | --- | --- | --- |
| blob | `a3c60b8d67b3721bcac3aa5c95212aed18016b77df0c3b46100d2a5fba3038e6` | `8bcab56a62aa05a7466d1ca82c6fb9af3744d6bc44a91406c9a3f95e3678d479` | `955fd4203b790459ec8b84bce662a790560b48be7dc726b106a9844fa0da1eab` | 8/8; component `>=0.999993467308602`; gap/depth/area `0`; lobe `<=0.185` |
| biped | `69615b11a7bb796eabbe287d5992e19211fa4775171131905f57895381ef79b1` | `e26d9f0b7dec2ddcfb206990fe9e61287968451ecc1ca8d96ead9cbfa08d9758` | `2721544327105e3503f626e00a4e6f6283c6f008b5a8051e4270ccc718783bf0` | 8/8; component `>=0.999983550555017`; gap/depth/area `0`; lobe `<=0.188888888888889` |
| floating | `6cb4f5abfc019e2584f73614223a322279c30e334eba76f2097014ef7d2a64c9` | `38ca09c7ebe5cae15b69a704057e2c306d1d499eb5d98e2b88240b08121b9ae6` | `aee93449185eedadb602a2a66d1903dd1896b57aad12bf5a57c053df1794faa3` | 4/4; component `>=0.99998889946106`; gap/depth/area `0`; lobe `<=0.188888888888889` |

All six sheets were inspected. Twenty of twenty entries pass the natural-neck visual gate. Known concern for user review: at 256 px, `body_biped_tall × head_round_dome` retains a dark shallow curved crease; it is connected (`0 px` gap) and exposes no structural plug.

### Rework verification

- Focused: `6` files, `27` tests passed.
- Validator: `49` production source assets checked; blob `8`, biped `8`, floating `4`; zero diagnostics.
- TypeScript: `npm run typecheck` passed.
- Full single-worker: `73/73` files passed; `596` tests passed and `2` skipped.
- Exact frozen Task6 input audit: `132/132` files unchanged; integrity record SHA-256 `e9b55e1f52d89bb022c2515dd6bb987ae76a61770422b38f84393bc4c824d650`.
- Frozen Task6 review hashes remain: original `58766df74141fae1abcb66f447529b8d32ede934b11394877c12d2c478feaef4`, 256 `0fa54d8968155465f84eec0de75303520bea637d1debae1f58e1f12301bd9974`, manifest `058dec48847ed6caa93dd58359c887c32c440de01f7522e14ee151d00ab7aa15`, acceptance `f1c14462fb4f14ad359cbe3cc029d13c1e85592bf5d25cb5630bd8b938be3520`.

### User approval and completion

- On 2026-08-26, the user replied `A` to the natural-neck rework review and approved the exact current 20-entry matrices (`blob` 8, `biped` 8, `floating` 4), authorizing continuation to Task 8 limbs.
- Canonical acceptance: `packages/asset-catalog/review/v0.3.0/body-head-contact-sheets-acceptance.json` (SHA-256 `f69608e9361d4dd05e79bfe9e7edeb316633b92528185927ec9532707ecf2759`).
- The acceptance binds the nine canonical original/256/manifest paths and exact SHA-256 values listed above, catalog and renderer version `0.3.0`, the first-round rejection record, the fixed causal thresholds/results, and the exact 132-input Task 6 integrity manifest.
- The body/head approval validator enforces the exact canonical acceptance location, uniqueness, approval fields, valid review time, all nine live artifact hashes, exact 20-entry rig counts, metric thresholds/results, rejection reference, and the live 132-file Task 6 integrity boundary.
- No approved review artifact, Task 7 natural-neck source/runtime input, or frozen Task 6 input byte was modified while recording approval.
- Approval verification: focused approval/catalog tests `26/26` passed; approval CLI checked 49 production sources and 20 approval entries with zero diagnostics; `npm run typecheck` passed; fresh single-worker full suite passed `73/73` files and `598` tests with `2` skipped.

Status: `APPROVED_COMPLETE`. `userApproved` is `true`; approval response is `A`.

## Independent-review evidence fix round

The independent Task 7 review returned `CHANGES_REQUIRED` for provenance, rejection-evidence validation, metric anti-gaming, and stale review wording. This round changed evidence/validation only; it did not regenerate or modify any approved/rejected image, natural-neck source/runtime asset, or frozen Task 6 input.

- Provenance root cause: the natural-neck preparation script updated prompt ID/path/hash but not `reviewRecordPath`, so the newly authored `head_mushroom_cap:biped` inherited the old Task 6 self-review record with `userApproved: false`. The script now assigns the canonical Task 7 body/head review path for every natural-neck head. The manifest, processed source index, package source index, and catalog bind all 12 natural-neck heads (and the three Task 7 bodies) to approved review SHA-256 `4030a4a75d5b01b60ba51fe3595035466395e0f9665039ce03fc02c7d5916bc4`; no natural-neck source retains the old unapproved record.
- Rejection evidence: the approval validator now reads the immutable rejection record and requires status `REJECTED`, user decision `B`, `userApproved: false`, exactly three rig declarations, and the exact nine canonical contained original/256/manifest files. It recomputes all nine live SHA-256 values and rejects missing, tampered, misplaced, extra/duplicate, or path-escaping evidence. The rejection record and nine artifact bytes remain unchanged.
- Metric root cause: visible-tongue and central-lobe sampling/normalization previously used the candidate's mutable connector width/depth. On the rejected biped mushroom, widening width by `1.2×` and depth by `10×` reduced lobe/depth/area from `0.76875 / 0.21875 / 0.12997983870967741` to false-pass values `0.09125 / 0.03625 / 0.02385886437908497` without changing any alpha.
- Metric fix: scales are frozen to the approved exact-rig neck grammar (`blob 400×200`, `biped 310×180`, `floating 300×180`) and are independent of tested connector width/depth declarations. The identical baseline/scaled rejected biped mushroom now scores `0.6833333333333333 / 0.19444444444444445 / 0.11553763440860215` in both cases, remaining above the unchanged `0.20 / 0.10 / 0.10` limits. Current 20-entry natural-neck classification remains passing.
- Review wording now records that explicit user approval response `A` was received on 2026-08-26.

Fix-round verification: focused `5` files / `34` tests passed; approval CLI checked `49` production sources and `20` approval entries with zero diagnostics; `npm run typecheck` passed; fresh single-worker full suite passed `73/73` files and `602` tests with `2` skipped. Canonical acceptance bytes remain unchanged because they bind the unchanged nine visual artifacts and unchanged rejection record, not the corrected review-record provenance hash.
