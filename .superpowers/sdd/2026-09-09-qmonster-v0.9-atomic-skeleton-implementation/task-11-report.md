# Task 11 report — incubator adapter v0.9

Status: **COMPLETE**.

## Scope guard

- Worktree: `C:\Project\QMonsterCreator\.worktrees\qmonster-v0.1`.
- Starting HEAD: `cc27dfb07f77b6e7c5528cdc8bffec4a7e1e3026`.
- Only the five planned adapter source/test paths, the integration guide, and this report belong to Task 11.
- Pre-existing Task 10 report edits, v0.6 connector/assets, Task 9 projection work, renderer/tests, scripts, diagnostics, generated dist, and unrelated plan files were preserved and excluded.
- No v0.9 asset, catalog, candidate manifest, renderer, approval, or audit content was modified.
- `packages/asset-catalog/releases/active-release.json` remained absent; Task 11 did not activate v0.9.

## Contract ruling

Task 11's plan/brief still named `rendererVersion` as the v0.9 tuple's third field. That wording is superseded drift: Task 1 review froze and shipped the exact tuple as `schemaVersion/catalogVersion/generatorVersion = 0.4.0/0.9.0/0.9.0`, and the strict parser rejects `rendererVersion` as an unknown field. Task 10 and the resolved release contract already use `generatorVersion`.

Task 11 therefore follows the reviewed contract without adding a parallel alias or changing generator-core. The integration guide now states this explicitly.

## TDD ledger

The test change was written before production changes. It added coverage for:

- exact v0.9 request seed/theme normalization and fixed `speciesRigId`;
- isolation from legacy risk/mutation inputs;
- existing strict egg-boundary and archetype diagnostics;
- exact release/species/skeleton/template identity output;
- all twelve trait selections with rarity and roll;
- mixed tuple and legacy-shaped v0.9 rejection with no partial value;
- missing identity rejection;
- resolved release tuple mismatch;
- forged trait/catalog mismatch;
- deep-copy isolation in both directions;
- byte/shape-exact v0.8 record regression.

Initial RED command:

```powershell
npx vitest run packages/incubator-adapter/src/adapter.test.ts
```

Observed: 1 failed suite, 8 expected v0.9 failures because `toV09GenerationRequest` and `toIncubatorRecordV09` did not exist; all 22 pre-existing legacy tests passed.

After the minimal implementation, the focused command passed 30/30 tests.

## Implementation

- Added `IncubatorGenerationRequestV09` and `IncubatorCreatureRecordV09` as separate types; the legacy record type was not widened.
- Added `toV09GenerationRequest(input)`. It reuses `parseIncubatorEggInput`, maps `deep_sea` to `deep-sea`, normalizes numeric seed to string, fixes `speciesRigId` to `feline-sit-v2`, and deliberately emits no mode, mutation, aberration, structural override, or legacy selection fields.
- Added `toIncubatorRecordV09(input, catalog)` with existing `AdapterResult<T>` fail-closed behavior.
- The output boundary strictly parses the v0.9 spec, preserves `VERSION_TUPLE_MISMATCH`, maps other malformed-spec failures to `ADAPTER_SPEC_INVALID`, and never returns a partial record.
- Before output, it verifies the resolved release tuple and canonical content identity, skeleton pool candidate/class, skeleton family/species/template binding, assembly template ownership, every selected trait's slot/ID/rarity/skeleton/template uniqueness and strict sealed schema, plus mouth/oral socket compatibility.
- The returned extension contains the exact version tuple, release manifest digest, species rig, skeleton family, assembly template, skeleton selection, and twelve visual selections. Skeleton and selection objects are copied with no mutable aliases to the input.
- Legacy `toGenerationRequest` and `toIncubatorRecord` implementation and output shape remain unchanged. The v0.9 APIs are additive exports.
- Updated the integration guide to version 1.6 with exact request/result JSON, tuple dispatch, active-release semantics, immutable content IDs, diagnostics, skeleton-wide reroll behavior, and v0.8 replay compatibility.

## Review round 1 — resolved snapshot identity closure

Review found that the first implementation checked only SHA-256 formatting and therefore trusted caller-provided resolved bodies. That was a real fail-open boundary. The repair was again test-first:

- RED: 11 focused tamper cases failed while the prior 30 adapter cases stayed green. They covered arbitrary release hashes, a changed manifest under its old hash, family/template/trait body mutation, swapped refs, unknown bodies/refs, and selected trait/template neutral-master cross-binding.
- A further RED reproduced a thrown `TypeError` when an entire resolved body collection was absent; the adapter now returns a structured `RESOURCE_HASH_MISMATCH` with no partial value.
- The positive fixture now constructs every manifest ref from the canonical body hash and derives the release identity from the canonical manifest. It no longer uses unrelated 64-hex placeholders.
- `toIncubatorRecordV09` now recomputes the canonical manifest SHA-256 and requires equality to `releaseManifestSha256`. It then hashes and positionally identity-maps every public resolved body for `skeletonPool`, `skeletonFamilies`, `assemblyTemplates`, `sealedTraits`, and `compositionGraph`; the `speciesRig` ref must match exactly. Count differences, missing collections, duplicate identities, swapped order, unknown bodies/refs, or ref/body divergence fail before selection or output.
- After snapshot verification, the selected family/template and twelve visual selections are checked against that verified snapshot. Selected trait artifacts must bind the canonical selected template hash and selected family neutral-master hash; the template must bind the same family neutral master.
- The adapter uses a synchronous browser-portable canonical JSON + SHA-256 implementation, so the output boundary does not import Node crypto or the asset-catalog package's server/sharp entrypoint.
- A real candidate probe loads the loader-verified v0.9 candidate, generates a monster, and round-trips it through the adapter with the actual release identity and frozen tuple.

The public `ResolvedV09Catalog` does not expose assembly approval, trait approval, or trait inventory bodies. The shared production loader validates those bodies, approval states, allowlist, and complete matrix before constructing the resolved catalog. The adapter revalidates the opaque refs for self-consistency but does not claim to hash unavailable approval/inventory bodies; the integration guide now states this trust boundary explicitly.

## Verification

- `npx vitest run packages/incubator-adapter/src/adapter.test.ts`: PASS, 1 file / 46 tests, including the real candidate round-trip.
- `npx vitest run packages/incubator-adapter/src/adapter.test.ts packages/generator-core/src/spec-validation.test.ts apps/creator-web/src/v09-production-release.test.ts`: PASS, 3 files / 84 tests.
- `npm run typecheck`: PASS.
- `git diff --check`: PASS; only existing CRLF conversion notices.
- Active release audit: absent.

## Commit

Commit message: `feat: integrate v0.9 with hatchery adapter`.

Review round 1 commit message: `fix: close v0.9 incubator identity chain`.
