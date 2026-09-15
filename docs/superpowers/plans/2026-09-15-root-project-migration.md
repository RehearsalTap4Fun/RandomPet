# Root Project Migration Implementation Plan

**Goal:** Make C:/Project/QMonsterCreator a self-contained, normally named project for the accepted feline combination implementation.
**Architecture:** Move the current application, three runtime packages, current resources and focused verification into the repository root. Keep historical experiments in the existing worktree; copy immutable provenance into the root release record before removing migrated originals. Runtime imports, installs and builds must not depend on a worktree.
**Tech Stack:** TypeScript, React, Vite, Canvas, Vitest, Playwright, PowerShell.
**Spec:** User request to move the files required by the formal version from .worktrees to the project root and use formal directory names.

## Constraints

- Root app entry: apps/creator-web/index.html; source: src/main.tsx and styles.css.
- Runtime packages retain generator-core, asset-catalog and renderer-canvas names; resources/catalog use v0.10.0 directories.
- Preserve the existing wire schema/catalog identifier and random algorithm, so directory relocation cannot change saved selections or seed results. This is a filesystem/entrypoint migration, not a silent wire protocol upgrade.
- Preserve art resource bytes and original scoped approval records. Do not broaden historical approvals.
- Root dependency install must be physical and independent of worktree node_modules.
- Do not move .git, node_modules, dist, historical source inventories or unrelated legacy implementations.

## Steps

- [x] Inventory exact source-to-destination mappings and hashes. Copy only required files into absent destinations, preserving existing root documentation.
- [x] Create root package/TypeScript/Vite/test configuration and focused package exports. Rename app entry and catalog/resource paths; archive provenance with an explicit path map. Update the integration example, snapshot and guide for the root project.
- [x] Install dependencies at root. Run type checks, core/catalog/renderer tests, and production build. Verify browser export/import/locking and integration save/restore/error paths from root.
- [x] Render all 864 combinations through the root runtime and compare each RGBA hash against the pre-migration baseline. Confirm every resource byte is unchanged and no runtime/build dependency points to .worktrees.
- [x] After verification, remove only the inventoried dedicated source files from the worktree, using absolute path guards and source hash checks. Preserve shared legacy utilities and immutable historical evidence there.
- [x] Recheck root independence, document final layout and migration results, and open the root application.
