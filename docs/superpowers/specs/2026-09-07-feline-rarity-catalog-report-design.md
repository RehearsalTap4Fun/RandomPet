# Feline Rarity Catalog Report Design

## Goal

Add a standalone, local web report that shows the currently installed feline catalog by rarity, including the number of selectable types in every visual category and the actual silhouette of every whole-appearance bundle. The report must derive its content from the catalog and packaged assets so that later catalog extensions appear after the development server updates and the page is refreshed.

## Scope

- Add a dedicated Vite entry page named `catalog-report.html`; do not change the creator workbench flow.
- Read the v0.6 production `catalog.json` through the same `parseCatalog` validation used by the creator.
- Build the report model from `Catalog.anatomyBundles`, `Catalog.parts`, `Catalog.modifiers`, and `RARITY_WEIGHTS`; no rarity count, bundle name, or trait total may be manually encoded in the UI.
- Render each anatomy bundle with its packaged `structural.png` through the existing production asset resolver, plus pose, whole-appearance rarity, and the resolved display names of its body, head, limbs, tail, and local feature pools.
- Show category-by-rarity tables for whole appearances, local visual slots, and mutations. The report must state when a category presently has no `R` or `L` entries rather than implying those tiers exist.
- Include an accessible N/R/L filter, an "all" state, a catalog-version label, current tier weights, and empty/asset-unavailable fallbacks.

## Current Catalog Baseline

The report will compute, rather than hardcode, the following current values:

- Whole feline appearance bundles: 5 normal (`N`), 2 rare (`R`), 1 legendary (`L`).
- Each of the 14 visual slots currently exposes 8 normal entries; the eight local slots belong to the selected whole appearance and are not independently rare today.
- Mutations currently expose 4 rare entries.
- Whole-appearance selection uses the shared `RARITY_WEIGHTS` of `N: 70`, `R: 25`, and `L: 5` before choosing a bundle inside the selected tier.

## Architecture

`catalog-report.html` loads a small React entry that imports the validated production catalog. A pure report-model module groups definitions and resolves the human-readable values used by the view. A report component renders the counters, filter, category table, and bundle gallery. It receives the existing `resolveProductionAssetUrl` function as an image-url dependency so report visuals use the identical Vite asset graph as the creator preview.

The report is intentionally a separate Vite entry instead of a workbench tab or router. This keeps it refreshable, bookmarkable, and independent from editing state. Vite observes imported catalog JSON and asset files in development; refreshing after a catalog update shows the rebuilt model. For a built distribution, the normal `npm run build` step packages the updated data and assets before the refreshed page is served.

## User Experience

The first viewport is a working reference surface: catalog version and tier odds, then three rarity counters. The category table immediately answers "which part has how many types at each tier?" A tier selector filters the gallery without discarding the table context. Each visual card shows the real bundled cat silhouette on a neutral checkerboard, tier badge, generated/fallback display label, pose, structural component labels, and the available local feature labels. Copy must distinguish whole-appearance rarity from local trait rarity.

The report uses the established tactile laboratory tokens and rounded cards, but has its own scrollable document layout so it remains readable at narrow widths and does not inherit the fixed, full-screen workbench behavior.

## Failure and Empty States

- Invalid catalog data fails at module initialization exactly as the creator does; the page never renders unvalidated catalog records.
- Missing structural image URLs retain the card and display a concise unavailable-image state rather than hiding the bundle or changing its counts.
- A selected tier with no entries displays an explicit empty state.
- Definitions without `displayName` render their stable identifier as a fallback; this keeps future catalog entries visible before editorial naming is added.

## Non-Goals

- Do not edit rarity weights, add gameplay rarity rules, or manufacture new assets.
- Do not add a hosted service, persistence layer, report editing UI, or duplicate asset manifest.
- Do not alter the 40 pre-existing uncommitted connector, renderer, script, test, or plan changes in this worktree.

## Validation

- Unit-test the report-model grouping, current-catalog baseline, fallback labels, and correct separation of bundle/local/modifier rarity.
- Component-test the N/R/L filter, visible category counts, localized tier copy, and unavailable-image fallback.
- Run the focused report tests, `npm run typecheck`, and `npm run build` to prove the second Vite entry packages the report and its source assets.
