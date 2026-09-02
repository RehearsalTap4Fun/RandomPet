# Task 5 report: immutable QMonster 0.4.0 catalog release

## Outcome

Implemented and executed the copy-once `0.4.0` release transaction. The release clones the complete 808-file `0.3.0` asset inventory, overlays only Task 4's six staged PNG/WebP files, rewrites all catalog runtime prefixes, refreshes the three replacement part hashes and every matching attachment render-node hash, emits exact catalog shards/source evidence, and records `pending_user_review` with `userApproved: false`.

The assembler owns `packages/asset-catalog/audit/v0.4.0/evidence-manifest.json`. It is the production evidence-root manifest derived from `source-index-v0.4.0.json`; Task 7 may add separate statistics/acceptance evidence files under `audit/v0.4.0`, but must not rewrite this assembler-owned manifest.

## TDD RED evidence

The immutable-release tests were written before the production assembler. The test fixture uses the real committed `0.3.0` catalog/source index, real Task 4 staging/provenance and replacement bytes, real original assets, representative audit/review bytes, hand-derived literal hashes, and a temporary repository root.

```powershell
npx vitest run scripts/assemble-v04-catalog.test.ts --project=asset-production-heavy --maxWorkers=1
```

The first discovery attempt reported no matching test because the heavy Vitest project had an explicit file allowlist. After adding only the new test to that allowlist, the required RED run exited 1: the test file failed to load because `scripts/assemble-v04-catalog.ts` did not exist. No implementation or `0.4.0` release existed at RED.

The first exact production validation exposed two pre-existing `0.3.0`-specific gates in the validators. Regression tests were added before compatibility code:

```powershell
npx vitest run packages/generator-core/src/catalog-validation.test.ts --project=packages-node -t "accepts canonical v0.4 connector"
npx vitest run packages/asset-catalog/src/production-validation.test.ts --project=asset-production-heavy --maxWorkers=1 -t "applies retained interface production validation"
```

The generator-core RED failed with `CONNECTOR_RESOURCE_INVALID`; the production RED returned retained-interface metadata/source/resource/stale-runtime diagnostics. Minimal fixes parameterized canonical paths by catalog version, applied the established interface gates to `0.4.0`, projected the retained v0.3 interface manifest to v0.4 runtime prefixes for catalog comparison, decoded bridge masks with the actual catalog version, and allowed an unreferenced v0.4 asset only when it is byte-identical to the same full-tree-copy path in v0.3.

## GREEN and final verification

```powershell
npx tsx scripts/assemble-v04-catalog.ts
```

Result: exit 0, `{"catalogVersion":"0.4.0","verifyOnly":false}`. This was the single production assembly. No later command reassembled or overwrote the completed release.

```powershell
npx vitest run scripts/assemble-v04-catalog.test.ts --project=asset-production-heavy --maxWorkers=1
```

Final result: exit 0, 1 file passed / 3 tests passed. Coverage includes schema/policy/version, no v0.3 catalog prefix, exact replacement and render-node hashes, all five intensity classifications, full-tree identity except six overlays, shards/source/evidence/review, v0.3 pre/post byte identity, no-overwrite, read-only verify-only, and rollback after injected mid-publication failure.

```powershell
npx vitest run packages/generator-core/src/catalog-validation.test.ts --project=packages-node
```

Final result: exit 0, 1 file passed / 31 tests passed.

```powershell
npx vitest run packages/asset-catalog/src/production-validation.test.ts --project=asset-production-heavy --maxWorkers=1 -t "applies retained interface production validation to the derived v0.4 release"
```

Final result: exit 0, 1 passed / 48 skipped.

```powershell
npm run validate:v0.4.0 -w @qmonster/asset-catalog
npm run typecheck
```

Final results: both exit 0. The package command is exactly the required production catalog/source-index/evidence-manifest validation command.

```powershell
npx tsx scripts/assemble-v04-catalog.ts --verify-only
```

Result: exit 0, `{"catalogVersion":"0.4.0","verifyOnly":true}`. Independent pre/post SHA-256 maps confirmed that verify-only preserved all 817 release files byte-for-byte.

`npm run catalog:validate` reached its unchanged v0.3 interface-slice gate after the v0.1/v0.2 checks, then exited 1 with `LIMB_ACCEPTANCE_EVIDENCE_ROOT_INVALID`: `packages/renderer-canvas/src/render.ts` differs from the frozen Task-8 source projection in v0.3 evidence. Task 3 intentionally changed that renderer while preserving v0.3 evidence and documents the pre-existing/deferred v0.3 evidence/golden mismatch for Task 10. Task 5 changes neither that renderer nor any v0.3 byte, so the scoped exact v0.4 production command is the applicable green release validation.

## Generated release hashes

| File | SHA-256 |
|---|---|
| `catalog/v0.4.0/catalog.json` | `6a4b1a70e672060e9b3f3ea85f213fd3af3172282652c92b6266c096ccfb72b2` |
| `catalog/v0.4.0/themes.json` | `7a3aa5e07334e9b4be546fc1b68a7405fd7049156e707150c070d766ab97e547` |
| `catalog/v0.4.0/rigs.json` | `74e756d389a515554f88ece24864f127fb4c6f6235f9f41fb059f9b1dc1a56af` |
| `catalog/v0.4.0/parts.json` | `ab9d569f48977c7f8be577f9ca9e1aeaac543dd4e35d7a482c5e8b21ec3b319f` |
| `catalog/v0.4.0/semantic-traits.json` | `7f81665d8ca44c21d53a5a9d4f47f71c981539ffe5e6c41aeb7d138946361964` |
| `catalog/v0.4.0/modifiers.json` | `dd24a6304e0fd333b2bf58098b338638503e5e3b5c8ac4969526b863cf1ab507` |
| `source-index-v0.4.0.json` | `97e0fa8600d43093e5e35da7ef1560452b9c2fc99d33461725f1f34a71323fc3` |
| `audit/v0.4.0/evidence-manifest.json` | `ad80486a9cfa90453bc63d813633eb1e936a0678d7c5ae1522ebc170f74c1a7e` |
| `review/v0.4.0/review-record.json` | `3835eed985f6cac8ef720f9454c0d3246b5730156b56eb9a756f6830b1f5eeae` |
| `surface_soft_scales.png` / `.webp` | `9b3c9fc4b82edc389552efc895f1958ba07b9bce29d0215a6224231db816d8ec` / `6ffc00c5ff4a7dfa3ac73d78b0b5fc0fca2234337be03e6383b0ac0a04ff35f8` |
| `pattern_gentle_stripes.png` / `.webp` | `3e4797bf34665e1cbbbce8ca8ed7e6d7835027c90d9faa72dff37f55ac4e923b` / `5da7fd70f27d56e2205629274e089e811659bc71cd9ce676b8da7a8100cc2b92` |
| `effect_bioluminescent_orbs.png` / `.webp` | `ba5a4e3e16d5ca51d3c81c6b0fbc42e5965161d89a755c38d7a76ab4acf619f1` / `0f5fbb06c9279f0e9bc6d0f0dc0be96047aa11300c2ba3d1c07b7f219a72f793` |

## v0.3 immutability proof

The pre/post literal hashes asserted by the real-file test remained:

| v0.3 file | SHA-256 |
|---|---|
| catalog | `58ca2ff0d91ee72fb6da788cdea7346daa77c2e400bc8dbe7ad156e87d4eb465` |
| `surface_soft_scales.png` | `122f0cb016b5e4c62007df9dd50e9956736174696340a8adb38ff0b29b080e67` |
| `pattern_gentle_stripes.png` | `d473dbfd9a29eb170972deced3f72e95c7644f105151603d48f941bef3014fa0` |
| `effect_bioluminescent_orbs.png` | `c2a7ad732ae8ee96d4ce5bff3e5d167919d345529dc8c68ae4d01b5217e42d2f` |

`git diff --exit-code HEAD -- packages/asset-catalog/catalog/v0.3.0 packages/asset-catalog/assets/v0.3.0 packages/asset-catalog/audit/v0.3.0 packages/asset-catalog/review/v0.3.0` exited 0. There are no tracked or untracked changes under those four v0.3 trees.

## Transaction and self-review

- All repository inputs are canonical, contained, direct single-link files; asset trees reject links/reparse points and hardlinked files.
- All five final targets must be absent. The asset tree is staged, verified, and published before the catalog directory, so `catalog.json` is the completion marker.
- Publication records filesystem identities. A failure rolls back only identity-matching targets created by the current transaction and cleans the transaction staging root.
- An existing completion marker rejects normal execution; verify-only reads and hashes existing outputs without publication or mutation.
- The assembled model is validated both before and after publication. Post-publication verification checks full inventory equality, retained-byte identity, replacement hashes, shards, source provenance, evidence root, pending review, schema, policy, and intensity.
- `git diff --check` passed before staging. No task code modifies Task 4 staging bytes, v0.3 release bytes, renderer code, approved evidence, or subjective acceptance state.

## Concern

The only remaining repository-level concern is the frozen v0.3 renderer evidence mismatch described above and already delegated by the implementation plan to Task 10. The immutable v0.4 release itself has no known scoped failure.
