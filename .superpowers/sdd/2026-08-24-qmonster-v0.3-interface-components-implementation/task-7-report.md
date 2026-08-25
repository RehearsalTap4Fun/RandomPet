# Task 7 body/head variant report

Status: `WAITING_FOR_USER_APPROVAL`

Date: 2026-08-25

## Baseline

- Branch: `feature/qmonster-v0.1`
- Base commit: `f0292476de84c5c17b5fd8a392f8b00d0cdf3f7d`
- Worktree clean before Task 7 changes.
- All four frozen Task 6 hashes matched the approved values before Task 7 changes.

## User ruling

The user selected `A`: re-author `head_round_dome` now as a new connection-aware component.

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
