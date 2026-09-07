# Feline Independent Rarity Parts Design

## Goal

Extend the feline visual library so every one of the fourteen visual categories exposes an independently selectable normal, rare, and legendary part set. The result must retain a recognizable cat silhouette and the existing reliable body-to-head, limb-to-body, and tail-to-body connections. Rare and legendary parts are local visual genes, not a replacement for the whole-creature collection rarity.

## Product Rules

- The first delivery targets `feline`. Future animals such as canine and rabbit use the same data contract, but their parts, anatomy interfaces, and counts remain separate from feline.
- Each feline category must expose exactly thirteen reachable options: eight normal (`N`), four rare (`R`), and one legendary (`L`). This applies to all fourteen categories: `bodyFrame`, `headShape`, `arms`, `legs`, `tail`, `extraAppendage`, `eyes`, `mouthShape`, `oralDetail`, `headAppendage`, `surfaceMaterial`, `pattern`, `colorScheme`, and `effect`.
- At generation time each visual gene draws independently with the per-part ratio `N:R:L = 8:4:1`. There is deliberately no per-creature limit on rare or legendary genes.
- The whole-appearance anatomy-bundle rarity stays a distinct collection-level concept. Its existing selection policy is not reinterpreted as the part-level `8:4:1` policy.
- The generated genome records the exact selected part identifier per slot, so a result can be reproduced, inspected, locked, and rerolled deterministically.

## Visual Direction

Every component follows the same art direction: a familiar plush, sitting domestic cat with one clear abnormal change. Normal parts establish the recognizable baseline; rare parts introduce a clear but singular mutation; legendary parts can make a stronger material, silhouette, or glow statement while preserving cat readability.

The delivery excludes multi-head creatures, fish-tail silhouettes, and free-floating surface treatment. Tails remain long, continuous cat/dog-style tails. Texture, material, pattern, and effect parts must be clipped or masked to their assigned body region; they cannot look like stickers placed over the creature.

## Composition and Interface Strategy

The anatomy bundle remains the base pose and connectivity contract. It supplies the compatible rig, default structural component, attachment anchors, draw ordering, and safe local regions for one coherent sitting cat.

Every rare or legendary structural candidate is interface-compatible with its target bundle and has the same validated bridge definition as the normal candidate: connector anchors, background/contour/foreground layers, bounding region, and layer order. A selected structure may replace the matching base component only after the catalog declares it compatible with that bundle's rig and interfaces. It may not be composited as an unconstrained overlay.

Local parts declare an anchor and permitted mask/safe zone. The renderer applies the part inside that zone, maintaining the base creature's silhouette unless the category explicitly owns a validated silhouette edge. This keeps facial features in front of the head, the head visibly above the body, and material/pattern/effect details embedded in their intended surface.

Future archetypes reuse this schema but declare their own poses, anchors, connector bridges, masks, and part IDs. No feline part becomes eligible for a canine or rabbit bundle merely because the rarity names match.

## Catalog and Generator Design

Create a new versioned catalog rather than mutating the shipped v0.6 catalog. The new catalog adds a bundle-scoped, fourteen-slot eligible-part pool and preserves the existing default/base component relationship. Each eligible part has a rarity, archetype restriction, render asset references, and, where applicable, rig/interface compatibility metadata.

Generation proceeds in this order:

1. Select the anatomy bundle using the separate whole-appearance policy.
2. For each of the fourteen slots, resolve the selected bundle's compatible candidate pool.
3. Use a slot-specific deterministic random stream to choose a rarity by weights `8`, `4`, and `1`, then choose a candidate inside that tier.
4. Respect a locked gene when present; otherwise record the actual candidate ID in the genome.
5. Render the selected structural and local parts only through their declared interfaces, anchors, and masks.

The generator must use a dedicated part-rarity constant rather than reusing the existing whole-bundle rarity weights. This prevents a future tuning change in one system from silently changing the other.

## Assets

The expansion introduces seventy feline rare/legendary parts: five additions for each of the fourteen categories. Each production part ships a transparent source/render asset and its metadata. Structural assets also ship their required connector bridge layers; local assets ship their anchor/mask metadata.

An asset is considered complete only when it has a catalog reference, a packaged renderable image, declared compatibility data, and passes the same interface validation as the current normal anatomy. Placeholder or missing images do not count toward the `8:4:1` totals.

## Catalog Report

The standalone catalog report remains the refreshable source of truth. It must derive counts and contents from the highest valid installed catalog and, for each selected archetype, show all fourteen category galleries with actual part thumbnails, display names, and `N/R/L` badges. The existing whole-appearance gallery remains explicitly labelled as a separate collection-level rarity view.

The report validates and displays only parts reachable from the currently selected archetype's bundle pools. A feline view therefore cannot count future canine/rabbit items, and an unavailable asset must render an explicit unavailable state rather than a fabricated preview.

## Validation and Acceptance Criteria

The implementation is accepted when all of the following are true:

- For every enabled feline bundle and all fourteen categories, validation finds exactly `8 N / 4 R / 1 L` reachable, renderable candidates.
- Part-level selection is deterministic for a seed, honors locks, uses the independent `8:4:1` weights for every slot, and never imposes a cap on high-rarity genes.
- Whole-bundle rarity remains separately configurable and tests demonstrate that changing it does not alter part-level selection weights.
- Structural replacement candidates pass connector/interface and draw-order validation; representative generated batches show no detached head, limb, or tail seams.
- Local material, pattern, and effect assets are masked to their owner region and cannot visually float outside it.
- The report presents correct per-category `8/4/1` counts and usable thumbnails for all reachable feline parts, then refreshes cleanly when a later valid catalog version adds another archetype.
- Existing v0.6 catalog consumers continue to work unchanged until they intentionally opt into the new versioned catalog.

## Non-Goals

- Breeding, inheritance, marketplace economy, or changing collection odds.
- Adding canine or rabbit art in this delivery.
- Reworking user-owned v0.6 connector, renderer, script, test, or plan changes already present in the worktree.
