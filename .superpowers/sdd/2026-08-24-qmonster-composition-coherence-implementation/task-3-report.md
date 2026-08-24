# Task 3 Report: Hierarchical Attachment Renderer and Face Protection

## Status

DONE

Implementation commit: `c98b197d237e629a2f0197b1b1704ea5f3ddf7cd`

## Delivered

- Added recursive, structure-first composition attachment resolution with signed mirrored parent transforms, rig-compatible render-node filtering, paired-node expansion, explicit missing-socket diagnostics, parent chains, and world-space face safe zones.
- Added complete double-head subtree cloning and misplaced-eye relocation using the body `head -> headAlternate` world delta, including translated face safe zones.
- Added pure alpha measurement for in-zone ratio, post-occluder visible ratio, and exact visible bounds.
- Added the isolated composition Canvas path with body clipping, protected-face clipping, multi-node layer ordering, reusable browser surfaces, eye/mouth occluder sampling, and blocking face/bounds diagnostics.
- Kept `expandRenderLayers()` and `resolvePartPlacement()` as the legacy `0.1.0` path. Composition rendering is selected only for a catalog with `compositionPolicy` and renderer `0.2.0`.
- Made spec renderer validation catalog-derived and composition modifier socket validation composition-geometry-aware.
- Added catalog rejection for ambiguous socket-provider nodes.
- Made `RenderResult.compositionMetrics` required and updated all creator-web `PreviewRenderer` doubles to return `null` for legacy renders.
- Did not modify assets, the production catalog, or workbench UI.

## TDD Red Evidence

1. Attachment API absent:

   `npx vitest run packages/renderer-canvas/src/attachment-tree.test.ts`

   Exit `1`; suite failed with `Cannot find module './attachment-tree.js'`.

2. Pure metrics API absent:

   `npx vitest run packages/renderer-canvas/src/composition-metrics.test.ts`

   Exit `1`; suite failed with `Cannot find module './composition-metrics.js'`.

3. Mutation handling absent:

   `npx vitest run packages/renderer-canvas/src/attachment-tree.test.ts`

   Exit `1`; `2 failed | 4 passed`: complete head-subtree clone remained length 1, and misplaced eyes remained at the original placement.

4. Catalog-derived renderer and composition modifier sockets absent:

   `npx vitest run packages/generator-core/src/spec-validation.test.ts`

   Exit `1`; `2 failed | 15 passed`: composition spec was rejected as renderer `0.2.0`, and validation incorrectly consulted the legacy rig socket.

5. Ambiguous provider validation absent:

   `npx vitest run packages/generator-core/src/catalog-validation.test.ts`

   Exit `1`; `1 failed | 19 passed`: two body provider nodes produced no diagnostic.

6. Composition render integration absent:

   `npx vitest run packages/renderer-canvas/src/render.test.ts`

   Exit `1`; `5 failed | 29 passed`: legacy metrics were undefined, `0.2.0` still rendered through the legacy path, metrics/bounds were absent, and attachment failure did not short-circuit.

7. Rig-specific node filtering absent:

   `npx vitest run packages/renderer-canvas/src/attachment-tree.test.ts`

   Exit `1`; `1 failed | 6 passed`: a biped-only arm node was incorrectly expanded for blob.

## Green and Final Verification

Focused Task 3 verification:

`npx vitest run packages/renderer-canvas/src/attachment-tree.test.ts packages/renderer-canvas/src/composition-metrics.test.ts packages/renderer-canvas/src/render.test.ts packages/generator-core/src/spec-validation.test.ts`

Exit `0`:

```text
Test Files  4 passed (4)
Tests       61 passed (61)
Duration    1.05s
```

Additional provider validation was included in the full suite and previously passed in the five-file focused run (`80 passed`).

Legacy synthetic golden:

`npm run test:render-golden`

Exit `0`:

```text
Running 4 tests using 1 worker
4 passed (4.1s)
```

The reviewed RGBA golden passed unchanged; no golden was updated.

TypeScript:

`npm run typecheck`

Exit `0`:

```text
> tsc -b --pretty false
```

Full Vitest suite:

`npm test`

Exit `0`:

```text
Test Files  45 passed (45)
Tests       401 passed | 1 skipped (402)
Duration    19.92s
```

The previously observed `scripts/process-rig-sheets.test.ts` concurrency failure did not occur in this run.

Creator-web test-double verification was also run directly:

`npx vitest run apps/creator-web/src/App.test.tsx apps/creator-web/src/components/PreviewCanvas.test.tsx`

Exit `0`: `2 passed` files, `14 passed` tests.

`git diff --check` reported no whitespace errors (only the repository's Windows LF-to-CRLF checkout warnings).

## Concerns / Boundaries

- Per scope, no production `0.2.0` catalog or composition assets were added. Composition raster behavior is covered by Canvas test doubles plus browser-independent alpha-mask tests; the available browser golden exercises and preserves the production legacy `0.1.0` path.
- No known Task 3 test, typecheck, golden, or full-suite failure remains.
