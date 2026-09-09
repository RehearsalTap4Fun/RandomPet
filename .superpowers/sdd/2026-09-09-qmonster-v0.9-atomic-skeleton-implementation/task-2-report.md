# Task 2 report — deterministic v0.9 generation

## Scope

Implemented only the v0.9 generation and reroll surface plus its public exports:

- `packages/generator-core/src/v09-generation.ts`
- `packages/generator-core/src/v09-generation.test.ts`
- `packages/generator-core/src/v09-reroll.ts`
- `packages/generator-core/src/v09-reroll.test.ts`
- `packages/generator-core/src/index.ts`

## RED

Before production implementation, ran:

```powershell
npx vitest run packages/generator-core/src/v09-generation.test.ts packages/generator-core/src/v09-reroll.test.ts
```

It failed as expected because `generateMonsterV09` (and reroll APIs) were not exported: `TypeError: generateMonsterV09 is not a function`.

## GREEN and verification

- Focused tests: `11 passed`.
- Required focused + legacy regression suite:

  ```powershell
  npx vitest run packages/generator-core/src/v09-generation.test.ts packages/generator-core/src/v09-reroll.test.ts packages/generator-core/src/generate.test.ts packages/generator-core/src/reroll.test.ts packages/generator-core/src/generate.property.test.ts
  ```

  Result: `5 files passed`, `89 tests passed`.

- `npm run typecheck`: passed.

## Behavior delivered

- Skeleton selection uses the isolated `[seed, 'v0.9', 'skeleton', roll]` random domain and the fixed base/legendary 8:1 pool weights.
- Each ordered appearance slot uses its own `[seed, 'v0.9', 'slot', slotId, roll]` domain and 8:4:1 rarity selection.
- Missing selected skeleton-family projections produce `SKELETON_PROJECTION_MISSING`; no resampling or cross-skeleton fallback is used.
- `oral-none` is derived for a closed mouth without an oral random draw.
- Slot rerolls only change the requested slot; skeleton rerolls increment the skeleton roll and reconstruct all twelve slots.

## Residual risk

The Task 1 `ResolvedV09Catalog` contract exposes sealed traits as a flat array rather than a pre-indexed `traitsBySkeleton` map. Generation therefore builds filtered candidate views per selection. This is deterministic and correct for the current bounded catalog, but a future large release loader may want to provide a validated index for efficiency.
