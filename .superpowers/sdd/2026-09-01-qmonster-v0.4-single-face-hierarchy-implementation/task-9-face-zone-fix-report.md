# Task 9 v0.4 face-zone contract fix

## Root cause

`head_shadow_hood:floating` inherited the immutable v0.3 face-safe zone
`{ x: 800, y: 1050, width: 448, height: 234 }` directly into v0.4.  For the
deterministic deep-sea/aberration case `qmonster-v04-user-review-007`, this
became world zone `{ x: 800, y: 270, width: 448, height: 234 }`; its lower
edge was 504 while `mouth_wide_grin` reached 537.704.  The existing 0.84
inside threshold consequently produced `COMPOSITION_FACE_OUT_OF_ZONE` with
mouth ratio `0.8140117860513222`.

The v0.4 override is deliberately narrow: it changes only
`head_shadow_hood:floating` to height 326, the pre-existing biped envelope for
the same head.  The resulting world lower edge is 596.  Objective pure-tree
alpha geometry for the exact spec confirms eyes end at 412.280, oral detail at
508.991, and mouth at 537.704, leaving the lower mouth edge 58.296px inside
the selected v0.4 zone.  No threshold, selector, or renderer behavior changed.

Because a face-safe zone is also required to be foreground in the head
occlusion split, the v0.4 release deterministically derives exactly two
floating hood mask files.  It promotes node-alpha pixels inside the attested
326px rectangle from background to foreground, preserving the binary,
disjoint node-alpha partition.  The v0.3 node and masks are read only and have
their exact source hashes recorded in the overlay.

## TDD evidence

- RED before the release fix: `npx vitest run tests/render/v04-face-zone-regression.spec.ts --project=production-browser-v03` failed with `0.8140117860513222 < 0.84` for the exact mouth metric.
- RED during integrity validation after the initial metadata-only change:
  `npx vitest run packages/asset-catalog/src/production-validation.test.ts --project=asset-production-heavy -t "derived v0.4 release"` reported `PRODUCTION_INTERFACE_HEAD_OCCLUSION_INVALID`, `invalidFace=26982`.
- GREEN final focused run:
  - assembler: 3/3 passing;
  - v0.4 derived-release plus missing-overlay-provenance validation: 2/2 passing;
  - exact browser scenario: 1/1 passing with eyes, mouth, and oral inside/visible ratios at the unchanged 0.84 thresholds.

## Changed release contract

- `asset-source/v0.4.0/interface-face-zone-overrides.json` is the ignored-but-committed v0.4 overlay.  It binds the canonical v0.3 manifest SHA, the one permitted head/rig/zone mutation, the three immutable v0.3 mask inputs, and the deterministic derivation rule.
- `packages/asset-catalog/src/v04-interface-face-zone-overlay.ts` parses the closed-scope contract, derives the two PNG masks, and applies only the attested metadata/hash changes.
- Assembly and production validation independently rederive the mask bytes, validate their hashes, source-index provenance, review provenance, evidence root, aggregate catalog, and shards.
- The updated v0.4 foreground/background masks and their aggregate/shard/source-index hashes are the only asset changes.  All v0.3 catalog, asset, audit, and review bytes remain unchanged.

## Verification

- `npm run typecheck` passed.
- `npx tsx scripts/assemble-v04-catalog.ts --verify-only` returned `{ "catalogVersion": "0.4.0", "verifyOnly": true }`.
- `npm run validate:v0.4.0 -w @qmonster/asset-catalog` passed.
- `git diff --check` passed.

No `batch:v0.4:user-review` command, production batch code, or 18-input renderer run was invoked for this fix (count: 0).  No visual image review was performed.
