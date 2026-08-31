# QMonster Random Genome Design

**Status:** Approved in chat on 2026-08-31

**Scope:** Add deterministic four-layer random genetics without breeding

**Target:** `feature/qmonster-v0.1`

## 1. Goal

Give every newly generated creature a persistent genome inspired by the useful parts of CryptoKitties genetics, without reproducing its private gene-mixing algorithm and without adding breeding in this release.

Each of QMonster's 14 visual slots receives one dominant gene (`P`) and three hidden genes (`H1`, `H2`, `H3`). The dominant layer remains the rendered creature. Each hidden layer is also generated as a complete, internally compatible creature so that a later breeding or expression system has valid material to work with.

This release must preserve the current renderer, art catalog, generated appearance for an existing seed, legacy `MonsterSpec` compatibility, and existing hatchery consumers.

## 2. Non-goals

- Breeding, parentage, generations, mutation chains, cooldowns, ownership, blockchain, or token behavior.
- Reproducing the exact CryptoKitties `GeneScience` algorithm.
- Allowing users to edit gene values.
- Making hidden genes affect rendering, semantic traits, mutation, or aberration.
- Changing renderer composition, art assets, catalog format, theme weighting, or rarity rules.
- Fabricating hidden genes for an imported legacy spec.

## 3. Chosen Architecture

The genetics layer lives in `@qmonster/generator-core`. It reuses the existing rig selection, candidate selection, composition, connector, and validation rules rather than introducing a second selection engine or a new package.

Generation follows this flow:

```text
seed
  -> generate existing dominant phenotype (P)
  -> generate three domain-separated compatible hidden layers (H1/H2/H3)
  -> transpose four layer selections into MonsterGenome.genes
  -> project P to MonsterSpec.visualSlots
  -> existing semantic projection, validation, and rendering
```

The P layer is generated first with the current seed and current random streams. This preserves the current visible result for the same `seed`, `themeId`, `mode`, slot rolls, locks, and catalog. Hidden layers use named, domain-separated seeds so their random draws cannot perturb P.

The generator should extract a focused internal operation for producing one compatible visual layer. `generateMonster` invokes that operation four times, then continues through the existing phenotype pipeline. This is an internal refactor, not a second public generator.

## 4. Data Contract

Add the following public contracts to `@qmonster/generator-core`:

```ts
export const GENOME_LAYERS = ['P', 'H1', 'H2', 'H3'] as const
export type GenomeLayer = typeof GENOME_LAYERS[number]

export interface SlotGenes {
  P: string
  H1: string
  H2: string
  H3: string
}

export interface MonsterGenome {
  genomeVersion: '0.1.0'
  genes: Record<VisualSlotId, SlotGenes>
}
```

`MonsterSpec` gains:

```ts
genome?: MonsterGenome
```

Gene values are existing stable catalog `partId` strings. There is no parallel numeric gene registry and no gene-to-part mapping table.

`MonsterSpec.schemaVersion` remains `0.1.0` because the new field is additive and optional. `genomeVersion` versions the genetics contract independently.

For every newly generated spec:

- `genome` is present and complete.
- `genome.genes[slotId].P === visualSlots[slotId].partId` for every visual slot.
- Each layer contains exactly one part for every visual slot.
- Each part exists in the installed catalog and belongs to its recorded slot.
- There is at least one catalog rig under which every part in a hidden layer is compatible and its structural/composition constraints pass. A hidden rig is not persisted because genes remain part IDs only.

`visualSlots` remains the authoritative resolved phenotype consumed by the renderer. `genome` is the authoritative hereditary identity for new specs. The equality invariant prevents these representations from silently diverging.

## 5. Determinism and Random Streams

P retains all existing random inputs and behavior. Hidden layers use domain-separated seed components equivalent to:

```text
[seed, themeId, "genome", layer, slotId, slotRoll]
```

where `layer` is `H1`, `H2`, or `H3`. Exact helper signatures may follow the existing PRNG conventions, but these properties are required:

1. The same request and catalog produce byte-equivalent genomes.
2. Adding or changing hidden-layer generation never consumes the P random stream.
3. Rerolling an ordinary slot changes only that slot and the dependency descendants that the existing editor already regenerates.
4. Changing a hidden layer cannot change any other hidden layer.
5. Existing seeds keep their pre-genetics visible P selections.

Each hidden layer independently selects its rig, composition plan, and compatible parts. The stored layer is accepted only when it forms a valid complete combination under one rig.

## 6. Generation, Locks, and Rerolls

### New creature

`generateMonster` generates P using the existing behavior, then H1/H2/H3 as independent complete compatible layers. Hidden layers do not inherit P locks.

### Locks

Creator locks apply only to the visible P selection. A full regeneration preserves locked P slots exactly as today while regenerating all unlocked P slots and all hidden genes.

### Ordinary slot reroll

Rerolling a slot other than `bodyFrame`:

- increments the existing slot roll counter;
- preserves the existing dependency-aware editing behavior rather than introducing a target-only reroll mode;
- regenerates the target plus the dependency descendants that the current generator already treats as affected;
- runs that same dependency closure independently in P/H1/H2/H3 so every stored layer remains coherent;
- obeys P locks exactly as the current editor does, preserving and revalidating locked P descendants;
- applies no locks to hidden layers, so affected hidden descendants are regenerated;
- preserves every gene outside the dependency closure.

### Body-frame reroll

`bodyFrame` is the only full-layer cascade. Rerolling it rebuilds all four complete layers, because a new body frame can change the legal rig, sockets, connectors, and compatible descendants. Existing P locks are respected during the P-layer rebuild. Hidden layers remain unlocked and are rebuilt completely.

### Manual selection

Current manual selection changes P only. It must update the selected P gene and every P descendant regenerated by the existing dependency behavior in the same successful transaction as `visualSlots`. Hidden layers are unchanged unless `bodyFrame` is manually changed; a body-frame manual change rebuilds hidden layers for the same compatibility reason as a body-frame reroll.

Failed generation, reroll, or manual selection remains atomic: the editor must not retain a partially updated genome/phenotype pair.

## 7. Validation and Import Behavior

`MonsterSpecSchema` accepts `genome` as optional. If present, its shape is strict: version `0.1.0`, all 14 slots, and all four non-empty part IDs per slot.

Catalog validation adds genome-specific diagnostics with paths rooted at:

```text
genome.genes.<slotId>.<layer>
```

Validation rejects:

- unsupported `genomeVersion`;
- missing or extra slots/layers;
- a part ID absent from the catalog;
- a part assigned to the wrong slot;
- a layer for which no common valid rig and compatible composition exists;
- any P gene that differs from its corresponding `visualSlots` part.

No invalid gene is silently substituted or repaired during import.

A legacy spec with no `genome` continues to parse, validate, render, edit, persist, and export. The application displays that it is a legacy phenotype with no genetic record. It does not synthesize H1/H2/H3, because doing so would create hereditary data that was not part of the original creature.

If a legacy creature is regenerated as a new creature, the newly generated result receives a genome normally. Ordinary editing of a legacy spec does not implicitly upgrade it.

## 8. Creator UI and Persistence

Add a read-only genome panel to `creator-web`.

- Tabs or equivalent controls select P, H1, H2, or H3.
- The panel lists all 14 slots using existing slot labels and shows each selected `partId`.
- P is identified as the expressed layer; hidden layers are identified as stored but not expressed.
- A legacy spec shows a compact “no genome data” state.
- No gene editing, swapping, promotion, breeding, or probability display is included.

The panel reads directly from `session.spec.genome`; it does not duplicate genetics into editor state.

Existing session persistence and JSON import/export preserve the optional genome through `MonsterSpec`. PNG and WebP exports continue to render only `visualSlots` and remain visually unchanged.

## 9. Hatchery Adapter

Extend the hatchery output type so `visualExtension` includes optional genome data:

```ts
visualExtension: Pick<
  MonsterSpec,
  'schemaVersion' | 'catalogVersion' | 'visualSlots' | 'genome'
>
```

The adapter copies the genome instead of sharing mutable nested references. New generated specs include it; legacy specs omit it. Existing consumers that only read the original fields remain compatible.

Update `docs/integration/qmonster-hatchery-integration.md` with:

- the new optional field;
- the P-to-phenotype equality invariant;
- legacy behavior;
- guidance to persist genome and resolved phenotype together;
- a warning not to manufacture or silently repair missing hidden genes.

## 10. Error Handling

Generation and validation continue to use `Diagnostic[]` and `blocked` rather than exceptions for expected catalog/spec problems.

New diagnostic codes should distinguish at least:

- unsupported genome version;
- missing gene part;
- gene/slot mismatch;
- incompatible layer;
- P/phenotype mismatch.

Diagnostics must identify the exact slot and layer. UI export remains blocked whenever an error-severity genome diagnostic is present. Unexpected programmer errors are not converted into valid-looking fallback genes.

## 11. Testing and Acceptance

### Generator unit tests

- Same request produces the same complete genome.
- Existing fixture seeds retain their exact P `visualSlots`.
- P always equals `visualSlots`.
- Hidden random streams do not alter P or one another.
- All four layers contain all 14 slots and each layer is compatible.
- Locks affect P only.
- Ordinary reroll changes only the existing dependency closure across four layers and preserves genes outside it.
- Body-frame reroll rebuilds each complete layer.
- Manual selection updates P and phenotype atomically.

### Schema and validation tests

- New spec round-trip succeeds.
- Legacy spec without genome succeeds.
- Malformed shapes and unsupported versions fail at precise paths.
- Missing, wrong-slot, incompatible, and P-mismatch genes are rejected.
- Catalog validation never silently replaces a gene.

### Property tests

Across representative seeds, all themes, and all modes:

- generated specs are unblocked;
- genomes are deterministic;
- every layer has a valid shared rig and compatible composition;
- reroll invariants hold;
- visible composition invariants remain unchanged.

### Creator tests

- P/H1/H2/H3 can be inspected read-only.
- Legacy empty state renders.
- JSON and session persistence round-trip genomes.
- invalid genome imports surface diagnostics and block export.
- existing lock, reroll, manual selection, and preview tests continue to pass.

### Adapter tests

- New specs deep-copy genome into `visualExtension`.
- Legacy specs omit genome.
- malformed or catalog-invalid genomes are rejected.
- existing legacy record fields are unchanged.

### Completion gate

- All workspace tests pass.
- Type checking and production build pass.
- The same fixed seeds render the same P creatures as before this feature.
- No renderer or asset-catalog file changes are required.

## 12. Delivery

Implementation will remain on `feature/qmonster-v0.1`. After the implementation and verification gates pass, commit the change and push the branch to `origin` as previously authorized.
