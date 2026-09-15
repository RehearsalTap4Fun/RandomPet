# Mutation batch 1 implementation plan

**Goal:** Generate and integrate the five requested mutation sprites using the supplied prompts.
**Spec:** docs/art/2026-09-15-mutation-tiers-batch1.md and its dated prompts JSON.
**Scope:** This repository's resources, enum/schema, projections, transform selection, workbench, SDK snapshot and verification. Preserve unrelated docs/research and existing artwork. External hatchery synchronization is documented, not assumed completed.

- [x] Generate five assets with the built-in image tool, regenerate solid backgrounds, and use user-authorized offline keying/placement for final 1254×1254 RGBA. Archive inputs, prompts and hashes; inspect native images and light/dark 200px samples. User approved the five final sprites on 2026-09-15; pin the exact hashes in approval.json.
- [x] Cover representative options, same-slot exclusion, six-coat shared projections and identity transforms. Count the option space arithmetically without enumerating it in tests.
- [x] Dispatch transforms by mutation ID; apply old coat registrations only to the existing coat-bound variants. Preserve the registration JSON and original assets.
- [x] Add five resources and 30 shared projections; update labels/counts and exact pre-batch snapshot compatibility. Restore saved selections without rerandomizing.
- [x] Follow the user's reduced scope: stop the full traversal, render/replay only 18 representative cases, compare 6 legacy samples, and provide 36 native-resolution visual review images. Run unit tests, typecheck, build and bounded SDK checks. No claim of full-space validation.
- [x] Update arithmetic, integration guide, snapshot, provenance and QA evidence. Five new sprites now have explicit user approval. External hatchery synchronization remains with the integrator.
