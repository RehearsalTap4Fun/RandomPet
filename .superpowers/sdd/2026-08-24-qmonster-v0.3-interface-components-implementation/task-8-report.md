# Task 8 exact-rig limb report

Status: `APPROVED_COMPLETE`

Date: 2026-08-27

## Baseline

- Branch: `feature/qmonster-v0.1`
- Base commit: `a3552c756bb4e5839dcb07c251263e1ed8f5f19c`
- Worktree was clean at dispatch.
- The SDD `task-brief` helper could not run because this Windows host exposes only a WSL launcher without `/bin/bash`; the exact Task 8 plan text and controller constraints were copied into `task-8-brief.md` instead.

## Progress

- Requirements and applicable skill instructions read.
- Manifest inventory proves the four reusable exact biped variants are `arms_short_plush`, `arms_long_noodle`, `legs_webbed`, and `legs_mushroom`; no other rig-specific limb variant exists at the baseline.
- Completeness TDD RED: `npx vitest run scripts/build-interface-catalog.test.ts -t "every arm and leg identity"` failed with `arms:blob` receiving `[]` instead of the literal three-arm roster.
- Secured-splitter TDD RED: `npx vitest run scripts/split-paired-part.test.ts -t "canonical v0.3.0 output root"` failed because the hardened path whitelist admitted v0.2 roots only.

## Production and bounded-exhaustion checkpoint

- The exact 17 new rig variants were generated and processed; the four approved Task 6 biped variants remain reused at their original paths.
- Generation used 22 successful distinct image calls: 17 first-pass variants, four targeted blob-paddle candidates, and one targeted blob-mushroom regeneration. Two parallel batch attempts were rejected by the image service before producing artifacts.
- Every selected source passed two-principal-component extraction, authored proximal-alpha coverage, two independent secured splitter runs, decoded RGBA/metadata equality, ordinary-file and realpath containment checks.
- Prototype matrices passed their causal gates and were inspected at original and 256 sizes before fan-out.
- The third full 60-cell audit reached 34 passing cells: floating 12/12, biped 18/24, blob 4/24. All connector coverage, plug coverage, root continuity, centerline-gap, resolver-count, and outside-alpha failures were eliminated for the passing cells. The remaining biped failures are the new stub/shadow legs ending at y=1964 against the fixed y<=1952 safe frame; the bounded next scale, 0.89, remains connector-warp compatible but was not promoted after the decisive blob conflict below.
- Blob residual outside-alpha minima after bounded identity normalization were webbed 0.6221, mushroom 0.6371, and shadow 0.5736. These remain below the fixed 0.65 product threshold; no threshold was weakened.

### Decisive frozen-grammar conflict

The blob short-arm candidate is hash-bound to `e996134613441a7478d7935776102c6161bdf12ff360644d5c318482f0d84851`; the sweep catalog is hash-bound to `ab5e523b38146ec6aacc6e9b3f8313d6b5feea0904a839b186dc71bcb93961a5`. The preserved 98-render sweep is:

`C:/Project/QMonsterCreator/.worktrees/qmonster-v0.1/packages/asset-catalog/review/v0.3.0/rejected/task8-option-a-pre-rework/task8-arms_short_plush-blob-transform-sweep.json`

No scale in 0.85..1.15 crossed with rotation -12..12 degrees passed both approved blob bodies. The only common safe-frame result was scale 0.85, rotation 0 degrees:

- round bounds x=204..1848; arm outside ratios 0.88198/0.88737; receiver coverage 0.85256/0.85256.
- wide bounds x=104..1948; arm outside ratios 0.70183/0.71181; receiver coverage 0.85256/0.85256.
- plug coverage >=0.99285, connected structural alpha >=0.9999844, gap=0.

Thus the allowed transform clears the fixed x=96..1952 frame and outside-alpha gates but necessarily drops the fixed receiver-coverage gate below 0.90. At scale 1 the receiver gate passes, but the wide-body visible bounds are x=32..2020 and fail the safe frame. Rotation 4 degrees at scale 0.85 clears bounds but destroys receiver/plug coverage (minima 0.23295/0.18340). The search was stopped rather than expanded or the thresholds weakened.

## Mutually exclusive architecture options

1. **Re-author only the five blocked blob limb identities (recommended):** replace blob short/long arms and webbed/mushroom/shadow legs with compact candidates whose distal alpha is outside the body while the proximal plug stays broad. This preserves every approved Task 6/7 byte and every global product gate, but requires five targeted generation/review cycles and new rejected-round evidence.
2. **Reapprove blob body connector grammar:** move the wide body's shoulders inward and its hips outward, then rerun Task 7 body/head approval and every downstream matrix bound to those body profiles. This can retain the current limb art but invalidates the frozen Task 7 connector/catalog/acceptance boundary.
3. **Revise the product gates:** broaden the horizontal safe frame from x=96..1952 to the final 0..2048 canvas and lower or specialize the 0.65 outside-alpha rule for the three blob leg identities. This avoids art/body reapproval but changes global composition semantics and weakens the fixed causal contract.
4. **Retire the incompatible blob identities:** omit short/long arms and the blocked leg variants from blob. This keeps existing approvals and gates but abandons Task 8's exact 3-arm/4-leg identity matrix.

Recommendation: option 1. It is the narrowest reversible change and does not invalidate approved bodies or lower product-quality thresholds.

No incomplete Task 8 commit or user-approval JSON was created.

## User decision A and rework restart

- The user explicitly selected architecture option `A`: re-author only the five blocked blob limb identities.
- Scope is fixed to `arms_short_plush`, `arms_long_noodle`, `legs_webbed`, `legs_mushroom`, and `legs_shadow_tiptoe` for rig `blob` only.
- The 34/60 pre-rework matrix, its original/256 sheets and manifests, the failed selected candidates, and the 98-render short-arm transform sweep were preserved under `packages/asset-catalog/review/v0.3.0/rejected/task8-option-a-pre-rework/` with live hash binding in `rejection-record.json`.
- Prototype order is the hardest horizontal and vertical failure pair: `arms_short_plush:blob` and `legs_shadow_tiptoe:blob`. No other image generation is authorized until both pass both blob bodies at original and 256.
- Option-A prototype c2 passed extraction, proximal-alpha, double-split determinism/security, receiver/plug coverage, continuity, gap, and safe bounds. It failed only visible independence: short arms passed round at `0.70952/0.71817` but failed wide at `0.41870/0.43035`; shadow legs failed round at `0.53809/0.53926` and wide at `0.52715/0.53004`. The exact originals, 256 sheet, manifest, index, candidates, hashes, and rejection reasons are preserved under `review/v0.3.0/rejected/task8-option-a-prototype-c2/`. Fan-out remained blocked and only these two identities entered targeted c3 regeneration.

## Option-A final prototype exhaustion

- `legs_shadow_tiptoe:blob` candidate 3 (`ce80fdd4013984739f4a3bc69432eff9e970f6dda4adb895852508b901bff7f5`) passes both blob bodies: outside alpha `0.698169..0.705357`, receiver coverage `0.981948`, connected structural alpha `>=0.999985`, and gap `<=0.009804`.
- A generic proximal-root bug was isolated with a synthetic lower-root regression: arm root detection had searched only the upper 60% and could mistake an upper paw for the shoulder root. The test failed first, then passed after the detector searched the full safe arm-node height. This is slot grammar, not a seed/body/identity special case; focused preparation/render tests now pass `9/9`.
- Short-plush candidates 3 through 6 explored upward curvature, explicit root pads, and outward mass. Candidate 6 (`d2764d72ee40bab4bccb43d5656ac890404dfb8d7405d3d3da7b597c61a51c1b`) correctly anchored and passed the round body at baseline (`0.684970/0.693306`) but remained `0.485402/0.488110` on the wide body. Its fixed 98-cell sweep had zero full-pass cells; best eligible scale `1.15`, rotation `0` reached only `0.538475/0.543592` on wide.
- The controller authorized one final distinct mass-distribution candidate and no c8. Candidate 7 (`2d2776b2b94d7cb993c7ac6fa3402c315967fab409790cdef0d5507cca7abbe7`) uses a minimal broad root pad, narrow connected outward-up bridge, and outer-upper fuzzy mitten. It passed source identity, two-node separation, authored root, double-split determinism/security, connector coverage, continuity, gap, and safe bounds.
- Candidate 7 baseline outside ratios were round `0.589547/0.595503` and wide `0.455269/0.458656`. Its hash-bound fixed 98-cell sweep also produced zero full-pass cells. The best eligible point was scale `1.15`, rotation `0`: round `0.607759/0.615227`, wide `0.487976/0.491966`, receiver `>=0.982087`, plug `>=0.991126`, connected alpha `>=0.9999864`, gap `<=0.007844`, bounds round x=`224..1827`, wide x=`124..1927`. Rotated points never reached the outside gate and reduced receiver/plug coverage to roughly `0.35`.
- Candidate 6 evidence is preserved under `review/v0.3.0/rejected/task8-option-a-short-arm-exhaustion/`; candidate 7 evidence is under `review/v0.3.0/rejected/task8-option-a-prototype-c7/`. Both records bind candidates, original/256 sheets, manifests/indexes, and exact sweep inputs/hashes. No remaining three-identity fan-out, c8, acceptance JSON, or incomplete commit was created.

### New mutually exclusive architecture options

1. **Reapprove the wide blob shoulder/body grammar (recommended):** move the wide body's shoulder receivers laterally toward the silhouette and rerun Task 7 body/head acceptance plus Task 8. This preserves the exact short-plush identity and every global causal threshold, but deliberately invalidates the frozen Task 7 body connector/catalog/acceptance boundary.
2. **Revise visible-independence semantics:** lower or body/identity-specialize the `0.65` outside-alpha product gate (c7 needs at most `0.487976`, c6 needs `0.538475` at their best eligible transforms). This avoids reapproving body art but weakens a global product rule and makes a mostly occluded short arm acceptable.
3. **Retire or replace `arms_short_plush` for blob:** remove this exact matrix identity or substitute a paddle-like lateral identity already proven compatible. This preserves approved bodies and thresholds but abandons the required three-arm exact-identity roster.
4. **Introduce a body-specific wide-blob arm variant:** allow `body_blob_wide` to resolve a separately authored short-plush asset while the round body keeps its passing candidate. This can preserve the identity label and threshold, but breaks the one-exact-rig-asset contract and multiplies catalog/provenance/testing combinations.

Recommendation remains option 1 because it fixes the causal shoulder/silhouette conflict without lowering the quality gate or redefining the identity/catalog model.

## Wide-blob shoulder amendment (user decision A)

- The user authorized moving only `body_blob_wide` shoulder receiver origins laterally. The approved body raster, neck/hip receivers, connector class/material/width/depth/tangent/normals/warp limits, global thresholds, Task 6 inputs, and Task 7 natural-neck heads remain unchanged.
- The old Task 7 acceptance (`f69608e9361d4dd05e79bfe9e7edeb316633b92528185927ec9532707ecf2759`) and approved review record (`c1fd5afef7d4cedc73f205b17a9978b64486f5b650df27a6ff7365308efbc2bc`) were removed from the live approval boundary and preserved with 29 additional exact artifacts under `review/v0.3.0/superseded/task7-pre-wide-shoulder-amendment/`. The live review state is `WAITING_FOR_USER_REAPPROVAL`, `userApproved: false`; no amendment acceptance JSON exists.
- TDD RED/GREEN added live-alpha derivation. At shoulder band y=`870`, the outermost symmetric body-supported left origin is x=`353`; c7's actual decoded alpha reach and x=`96..1952` safe frame require x=`424`. The selected origins are therefore x=`424/1624`, receiver alpha support is `1.0/1.0`, and projected c7 source bounds are x=`98..1952`. The old body/source/runtime PNG hash remains exactly `95a8f7fbddfa84ce120f849ab541d2bd8f9f2e59a1ce4ae0a6813c604372510a`; decoded RGBA is `be29b5332db77a892c842fe3bb30b58321425daf46758b69b42c3bbadcc0e071`.
- Task 7 rerendered all 20 body/head cells. All nine original/256/manifest artifacts are byte-identical to the pre-amendment approved bytes. Metrics reproduce exactly: component min `0.999983550555017`, gap max `0`, tongue depth/area max `0`, lobe max `0.188888888888889`.
- The required c7 rerun still fails the fixed outside-alpha gate. Round remains `0.589547/0.595503`; wide improves to `0.550456/0.554176`, with receiver `>=0.912877`, plug `>=0.989469`, connected alpha `>=0.999987`, gap `0`, and wide visible bounds exactly x=`96..1951`. The shoulder position cannot move farther laterally without violating the fixed safe frame. Evidence is preserved under `review/v0.3.0/rejected/task8-wide-shoulder-amendment-c7-failure/`.
- Because the explicit c7 prototype condition did not pass, no remaining-three generation, c8, biped `.89` promotion, strict full-60 rerender, acceptance JSON, or commit was performed.

## Post-amendment joint feasibility exhaustion

- The initially computed x=`565/1483` shoulder pair was rejected before adoption: it incorrectly treated the old `arms_long_noodle:blob` art as retained even though Option A requires that identity to be re-authored. That temporary catalog state was restored to the prior pending-reapproval x=`424/1624` amendment after the joint search. No commit contains x=565.
- The corrected search treated `body_blob_wide` body-alpha support as immutable, allowed one identity-level transform shared by both blob bodies for paddle and each archived short candidate, and did not let the future long-noodle art constrain the receiver. The full body-supported left-origin interval x=`353..1023`, seven scales `0.85..1.15`, and seven rotations `-12..12` were searched with 256-alpha/bounds pruning followed by hash-bound 2048 browser renders.
- Evidence: `.superpowers/sdd/2026-08-24-qmonster-v0.3-interface-components-implementation/task8-blob-joint-shoulder-search.json`, SHA-256 `fc538e40d78dd72c6b6ac4daf2883e753d0fe1a47aa3d3be76a1ca035431b295`.
- Counts: `29,498` preflight cells, `2,622` preflight-eligible cells, `23` shortlisted origins, `137` exact round-body transform renders, `36` exact wide-body grid renders, plus `24` paddle/short safe-boundary pairs resolved by `30` exact renders. No image generation or new candidate occurred.
- Five wide-body grid cells passed every gate, all for retained `arms_paddle:c4` (x=`488/496/512/536/552` with scale `1.0/1.0/1.05/1.10/1.15`, rotation 0). No c2-c7 short candidate passed wide.
- The round body admitted only c2 scales `1/1.05/1.10`, c3 scale `1.15`, c4 scale `1.15`, and c6 scale `1.15`, all at rotation 0; c5 and c7 admitted no transform. Every such short transform was then paired with every round-passing paddle transform and rendered at the pair's exact common outermost integer-safe shoulder position, filling the gaps in the fixed 8px origin grid.
- The best and decisive cell is `arms_short_plush:c3`, scale `1.15`, rotation `0`, wide shoulder x=`490/1558`. It passes receiver coverage (`0.982087/0.982092`), plug coverage (`0.991126/0.991129`), connected alpha (`0.999991`), gap (`0/0.007844`), and final safe bounds x=`96..1951`, but outside alpha is only `0.639886/0.644351`. Paddle c4 scale 1 passes at the same shoulder origin with wide outside alpha above `0.68`. Therefore no origin plus one fixed transform per identity satisfies all gates for paddle and any archived short candidate on both bodies.
- Production was restored to the pending x=`424/1624` amendment. Body source hash remains `95a8f7fbddfa84ce120f849ab541d2bd8f9f2e59a1ce4ae0a6813c604372510a`, decoded RGBA remains `be29b5332db77a892c842fe3bb30b58321425daf46758b69b42c3bbadcc0e071`, and all nine Task 7 original/256/manifest artifacts are still byte-identical to the pre-amendment approved bytes. The amendment record now binds the rejected joint-search evidence and remains `WAITING_FOR_USER_REAPPROVAL`; no acceptance JSON exists.

### New mutually exclusive architecture options

1. **Re-author the wide-body lateral silhouette/body raster (recommended):** keep the exact c3 short-plush identity, x=490 connector grammar, paddle compatibility, and every global gate, but remove enough local wide-body overlap to lift the limiting left outside ratio from `0.639886` to `>=0.65`. This changes approved body pixels and therefore requires full Task 7 visual reapproval plus downstream rerenders.
2. **Explicitly revise the outside-alpha product rule:** lower the global or declared blob-short threshold below `0.639886`. This preserves body/art bytes and makes the measured c3 composition admissible, but weakens or specializes the causal product contract.
3. **Retire or replace `arms_short_plush` for blob:** use the passing paddle-like identity or remove short plush from the blob roster. This preserves bodies and global thresholds, but abandons the required exact 3-arm identity matrix.
4. **Allow a body-specific short-arm asset:** generate a separate wide-body short-plush variant while retaining the round-body variant. This can preserve the label and threshold, but breaks the one-exact-rig-asset rule and expands catalog/provenance/test combinations.

Recommendation: option 1. The measured deficit is only `0.010114` on the limiting side at a composition where every connector, continuity, gap, and bounds gate already passes; a reviewed body-silhouette amendment addresses the actual occlusion cause without weakening the quality contract or exact-rig identity model.

## User decision B and post-threshold bounded exhaustion

- The user selected option `B`: the visible-limb outside-alpha product threshold is globally and exactly `0.63`; `0.629999` is rejected. The prior `0.65` rule remains preserved as superseded decision evidence. No body/rig/identity override exists.
- The evidence-derived wide-blob shoulder origins are x=`490/1558`. The hash-bound short-plush c3 transform is scale `1.15`, rotation `0`; its wide minima reproduce at `0.6398863319545027/0.6443505816004901`. Task 7 body pixels and all nine body/head original/256/manifest review artifacts remain byte-identical to their pre-amendment approved bytes, while connector metadata remains pending reapproval.
- Three post-decision blob sources were generated in separate built-in image calls: long-noodle c2 (`324eb219...`), webbed c2 (`506ee312...`), and mushroom c3 (`857544f7...`). Mushroom c3 failed the authored-root gate and was replaced by c4 (`c9db67de...`); c4 passed root/connector gates. One final targeted mushroom c5 (`4ae1182f...`) was generated after c4 missed outside alpha and was rejected because it regressed to `0.589457..0.592718` on wide.
- Reprocessing changed the retained paddle c4 runtime-node geometry relative to the earlier joint-search node hashes even though source c4 remained exact at `97863dc6...`. Live 98-cell uniform scale/rotation sweeps found zero legal cells for paddle and long. Their evidence hashes are `d34b8f63...` and `c779f7c2...`; shrinking enough for the safe frame necessarily reduced receiver coverage below `0.9`.
- A shared connector-local root-preserving distal warp was implemented under TDD. It leaves every RGBA byte in the full `220×120` plug envelope unchanged, deterministically compresses only the outward distal region, and is identity-provenanced at ratio `0.78` for blob paddle/long. The resulting live matrix clears both identities: receiver `>=0.912877`, plug `>=0.989468`, connected alpha `>=0.99999`, gap `0`, outside minima about `0.73` paddle / `0.68` long, and bounds x=`100..1948`.
- With c4 at scale `1.15`, the strict audit reached `54/60`; the only six failures were mushroom cross-product rows. c4 outside alpha is round `0.615324981/0.626694426` and wide `0.614777780/0.627114119`; all other gates pass.
- The single valid hash-bound c4 leg sweep tested 98 scale/rotation/body cells. Evidence: `.superpowers/sdd/2026-08-24-qmonster-v0.3-interface-components-implementation/task8-legs_mushroom-blob-transform-sweep.json`, SHA-256 `a29834178ca0d83d9ba39f0b0cfeec38720cd793d64ac27214fabb31a0e58dea`. Seven cells preserved all non-outside gates, but none passed both-side outside alpha. The best outside cell (scale `1.15`, mirrored rotation `-12`) reached at most `0.620377..0.631837` while destroying the opposite hip coverage; the root-safe 0-degree cell retained the `0.614778/0.627114` limiting result.

Status: `BLOCKED_AFTER_OPTION_B_MUSHROOM_EXHAUSTION`. Per the bounded instruction, no mushroom c6, acceptance JSON, final approval claim, or incomplete commit was created. The selected live source is restored to c4; c5 and every failed sweep remain preserved as rejection evidence.

## User decision C and final review boundary

- The user selected option `C`: the global visible-limb outside-alpha minimum is exactly `0.614`; `0.613999` is rejected. The complete `0.65 -> 0.63 -> 0.614` decision history and both superseded contracts remain hash-preserved. No rig, body, part, or identity override exists.
- Live composition keeps wide-blob shoulders x=`490/1558`, short-plush c3 at scale `1.15`, mushroom c4 at scale `1.15`, connector-local distal warp `0.78` for blob paddle/long, and biped tall stub/shadow scale `0.89`. Mushroom c5 remains rejected; no c6 was generated.
- Deterministic reprocessing produced all 17 new exact-rig variants; the four approved Task 6 biped variants (`arms_short_plush`, `arms_long_noodle`, `legs_webbed`, `legs_mushroom`) remain reused. Production evidence records 35 successful distinct image calls and 18 targeted regeneration calls across retained and rejected rounds.
- The one final strict audit passed `60/60` cells with zero diagnostics: blob `24`, biped `24`, floating `12`. Extrema across visible shoulder/hip connectors are receiver coverage `0.9018838507625272`, plug coverage `0.9222820884723295`, connected structural alpha `0.999977511237958`, outside alpha `0.6147777796310275`, gap `0.011764705882352955px`; final bounds remain x=`96..1952`, y=`136..1948`. The limiting mushroom c4 margin is `+0.0007777796310275` over the exact global threshold.
- All six canonical Task 8 sheets were visually inspected at original and 256. No cropped, disconnected, isolated, or incorrectly layered limb remains. Known concern: wide-blob mushroom's left leg is deliberately close to the selected threshold and visually tucked under the body; biped noodle hands and floating legs retain their intentionally exaggerated silhouettes.

Canonical Task 8 evidence:

- blob original `482193fd33505284e764b814e6cbc03be5b5b32399e76c1afe765f621000e699`; 256 `3727a7d2837b3dd4bface6f756286be66ddd4a0b015e41f2922d3d8eeaa390d6`; manifest `86a2799685294805f17bbe64fe9c61b1287749b62c6b0c1e7549f9f7091e0c7c`.
- biped original `4a6024bda8ee955f8d69512509630123244a3aea7dfab8cc6fec28aefd9e0c05`; 256 `ba7238ea42b18d72ddd4edb1e65bd786e9a66e1905d37ed554be3ad78f5c34b1`; manifest `68fe6cc9b92a5febe183028d5ad0d2bfc01d641df19ea9a8ca73da36a5ca60ee`.
- floating original `62384d0d8b7aca079b6112efa01c6c8bbd4ee377579d621246553874cacef0bb`; 256 `d80bf4a13468afc60ac712276ec8e713b8fa12223447744adb3b91d5aa62f103`; manifest `c83d16ea0ff7e14d88d9200c4de7624d3460e88316d5ece2f40d1134a8d67115`.

Task 7 amendment evidence remains honestly pending reapproval. The old acceptance/review hashes are `f69608e9361d4dd05e79bfe9e7edeb316633b92528185927ec9532707ecf2759` / `c1fd5afef7d4cedc73f205b17a9978b64486f5b650df27a6ff7365308efbc2bc`; the live pending review/amendment hashes are `6ce29251ae7b1ac85964f6ca7dc1472e7a504681a9350c30e1e27dd6a4d8f03e` / `6de418aabea31a79aaeab7e7404b6bb3ee096d34c0043ebe1c9e2c39d10d7062`. All 20 live metrics pass, and all nine current original/256/manifest bytes are identical to the pre-amendment archive. The body PNG remains `95a8f7fbddfa84ce120f849ab541d2bd8f9f2e59a1ce4ae0a6813c604372510a`; only shoulder connector metadata/masks changed. No live acceptance JSON exists.

Verification: exact-threshold and amendment tests recorded RED then GREEN; `--scope limbs` checks 100 production sources plus `24/24/12` cells with zero diagnostics; `--scope body-head` live-recomputes `8/8/4` pairs and validates the pending amendment with zero diagnostics; typecheck and `git diff --check` pass; single-worker full suite passes `76/76` files, `624` tests with `2` skipped. Frozen Task 6 132-file integrity, Task 7 rejected/superseded evidence, natural-neck inputs, and live metric reproduction are covered by the passing suite. No Task 8 approval JSON or Task 7 amendment acceptance JSON was created.

## User approval A

- The user selected `A` and approved all 60 Task 8 limb cells, and reapproved the unchanged nine Task 7 review artifacts under the `body_blob_wide` shoulder x=`490/1558` connector amendment.
- Initial formal Task 7 reapproval: `packages/asset-catalog/review/v0.3.0/body-head-contact-sheets-acceptance.json`, SHA-256 `74714be881de769c03a609008b960f7c4cbc8e6ce808ee7c50b2dbf2f8ed7ba8` (superseded only by the clean-checkout evidence-root refresh below).
- Initial formal Task 8 approval: `packages/asset-catalog/review/v0.3.0/limb-contact-sheets-acceptance.json`, SHA-256 `1a35c1a7f968def3a4822b14af57e29cb0d3b49c62b837b8d99164249d67b882` (superseded only by the clean-checkout evidence-root refresh below).
- The approvals bind the exact current sheets/manifests, review records, connector amendment, global `0.614` contract, prior Task 7 approval/history, production evidence, and causal extrema. Finalization verified all 18 Task 7/8 original/256/manifest hashes before and after writing; none changed.
- Approval verification passes: focused approval tests `2/2`; limb CLI 100 sources / `24/24/12` / 60 approved / 0 diagnostics; body-head CLI 100 sources / `8/8/4` / 20 approved / 0 diagnostics; typecheck and `git diff --check` pass.

## Independent-review P1 integrity fix

- The clean-checkout dependency audit found that `.gitignore` excluded the authoring closure required by the approved Task 8 catalog. A data-derived collector now resolves the 17 exact-rig production keys and force-tracks exactly 191 previously ignored dependencies: 17 selected masters, 34 split nodes, 102 connector masks, 35 production-record candidates, the Task 8 prompt catalog, `task8-limb-production.json`, and the hash-bound joint-feasibility record. The already tracked interface manifest completes the 192-file dependency closure. Every path is realpath-contained, ordinary, and single-link.
- Limb validation no longer trusts stored manifest metrics. The contact-sheet renderer exposes one shared read-only reconstruction path, and the production validator rebuilds all 60 cells from the live catalog, runtime nodes/masks, renderer, and resolver. It compares four limb connectors per cell across receiver coverage, plug coverage, largest connected component, centerline gap, and outside-body alpha at `1e-12`, plus safe bounds, diagnostics/gate errors, normalized resolver calls, catalog hash, and resolved input hashes. The live 60-cell baseline passed in `162.626s`; a stored receiver-coverage mutation was rejected.
- Negative coverage also rejects a live transform drift, a live one-pixel connector-mask drift, renderer hash drift, acceptance aggregate drift, missing evidence-root data, a deleted production record, and a tampered processed index. Targeted transform/mask cases reconstruct one representative live cell; the production validator always reconstructs the complete 60-cell matrix.
- Task 8 acceptance now binds an acyclic `task8-evidence-root-v1`: canonical `source-index-v0.3.0.json`, canonical `processed-index.json`, `task8-limb-production.json`, and four renderer inputs. The closure is intentionally one-way: acceptance hashes inputs; source/processed indexes hash review records and never acceptance, so there is no self-referential hash.
- Approval remains valid and no visual or metric value changed. All 18 Task 7/8 original, 256, and manifest artifacts remained byte-identical. A Windows clean checkout exposed one historical Task 6 integrity-record line-ending mismatch: the acceptance had bound the CRLF working bytes `e9b55e1f52d89bb022c2515dd6bb987ae76a61770422b38f84393bc4c824d650`, while the committed canonical LF blob is `1ff6879d1444d96661a064ad9f2c55219f3a1aca275a14fd4c446f4cde898a23`. The 132 paths and hashes are semantically identical; canonicalizing that evidence hash refreshes Task 7 acceptance to `86d7666a33964abf2d848d3b8f6f64e3231b94687634a9d9b8ee723677d3d8e3` and Task 8 acceptance to `869d3366b53bf73cc95bf4eab83e527518f9461b83ebb1eb62bf592a4951673e` before final tracked-only checkout verification.
