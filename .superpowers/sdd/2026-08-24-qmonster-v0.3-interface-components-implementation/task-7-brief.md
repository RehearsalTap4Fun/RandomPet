# Task 7 brief — Produce Remaining Body and Head Variants

Plan: `docs/superpowers/plans/2026-08-24-qmonster-v0.3-interface-components-implementation.md`

## Exact scope

- Produce five body variants total: preserve the accepted biped bodies and add `body_blob_round`, `body_blob_wide`, and `body_floating_drop`.
- Produce four head identities for every rig: `head_round_dome`, `head_mushroom_cap`, `head_angler_bulb`, and `head_shadow_hood` for each of `blob`, `biped`, and `floating`.
- Reuse the accepted biped `head_mushroom_cap` unchanged.
- Re-author `head_round_dome` as a new connection-aware component. The retired Task 6 round-head runtime art must not be restored or reused; its sources and candidates are historical evidence only.
- Every exact-rig head requires a neck plug, data-declared organic foreground/background seam masks, face safe zones, and eyes/mouth/head-appendage sockets.
- Every body requires exact-rig neck/shoulder/hip receivers so Task 8 can extend the same grammar.
- Generate exactly one first-pass candidate per new structural variant with one built-in `image_gen` call per candidate. Regenerate only variants that fail extraction, connector, identity, hierarchy, original-size, or 256 review.
- Do not use a flat horizontal cut, baked neck pedestal, rectangular notch, simple alpha stacking, or seed/pair/screenshot special cases.
- Render every body x four-head matrix for `blob`, `biped`, and `floating` at original and 256 review sizes. Require exact connector metrics, structural continuity, face metrics, bounds, zero diagnostics, and an organic head/body hierarchy.

## TDD and verification

1. Add a real completeness test for five bodies and four exact-rig head identities.
2. Run the focused test and preserve the expected RED because only the biped slice exists.
3. Add the minimum schema/catalog/pipeline/rendering behavior required by the test and production matrices.
4. Verify:
   - `npx vitest run scripts/build-interface-catalog.test.ts scripts/process-interface-asset.test.ts packages/renderer-canvas/src/interface-tree.test.ts`
   - `npx tsx scripts/validate-interface-slice.ts --version 0.3.0 --scope body-head`
   - `npm run typecheck`
   - appropriate fresh full-suite verification before any completion claim

## Approval boundary

Stop at `WAITING_FOR_USER_APPROVAL` after writing the three canonical original/256 contact sheets, manifests/evidence, hashes, test evidence, and concerns. Do not create a Task 7 approval JSON and do not claim user visual approval.

## Frozen Task 6 artifacts

- `biped-vertical-slice.png`: `58766df74141fae1abcb66f447529b8d32ede934b11394877c12d2c478feaef4`
- `biped-vertical-slice-256.png`: `0fa54d8968155465f84eec0de75303520bea637d1debae1f58e1f12301bd9974`
- `biped-vertical-slice-manifest.json`: `058dec48847ed6caa93dd58359c887c32c440de01f7522e14ee151d00ab7aa15`
- `biped-vertical-slice-acceptance.json`: `f1c14462fb4f14ad359cbe3cc029d13c1e85592bf5d25cb5630bd8b938be3520`

## User rejection rework ruling

- The first Task7 matrices were rejected with decision `B` because too much of the head plug remained visible as a tongue, chin, or stem. Preserve those bytes and their exact hashes as rejected evidence; do not overwrite the rejection record and do not create approval evidence.
- Stop receiver-depth/mask-only sweeps. Re-author all 12 exact rig/head identities into Task7-versioned natural-neck paths, including a new Task7 biped mushroom, because the original raster silhouettes themselves encode excessive central lobes.
- The visible head shell must end in a shallow, soft, curved collar with no protruding central lobe. The hidden structural plug stays behind the shell and must be occludable by data-declared body foreground geometry.
- Add a causal silhouette-relative central-lobe test in addition to exposed plug depth/area. Fixed limits: visible depth `<=0.10`, visible area `<=0.10`, central lobe `<=0.20`, connectivity `>=0.99`, and centerline gap `<=2 px`.
- Prove one biped mushroom prototype on both biped bodies at original and 256 before fan-out. Generate remaining exact candidates only after the prototype passes, and regenerate only the exact failed variant without weakening thresholds.
- Treat the 132-file Task6 approved input boundary recorded at commit `f0292476de84c5c17b5fd8a392f8b00d0cdf3f7d` as immutable. New Task7 source/runtime/masks must be versioned outside those frozen paths.
