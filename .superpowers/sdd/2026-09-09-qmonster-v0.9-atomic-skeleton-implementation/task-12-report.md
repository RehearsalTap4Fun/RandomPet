# Task 12 report — COMPLETE

## Outcome

QMonster v0.9.0 is active through the canonical minimal pointer. The official acceptance attempt contains the ten frozen seeds exactly once, with no retries, replacements, or subjective filtering. Audit remediation never reran the official batch or activation and did not replace any of the ten PNGs.

## Release identity

- Release canonical SHA-256: `e9ec104f13c2fcc2559cfddb648f3e5af18daf910a890d4c3c7ed80aecb6fb21`
- Immutable release raw SHA-256: `f76ae2caafa322c5686c2336d9e40dab0c5dc735c972ffed7bd7d2974dc3e568`
- Candidate pointer raw SHA-256: `3acec5b6ef6f8b6ab0ff10bd5d83abdf4cc1c4a0ca36e931a2fe334f8ca63887`
- Active pointer raw SHA-256: `1338f39ec97de57de03fb668d20c995f4a317a376b1c4d543f15604bf8121053`
- Attempt canonical SHA-256: `9598dc7d32390547c982901f24c49a892dd0452b9a028e133597ad43fcb4c91b`
- Contact sheet SHA-256: `f3e2679e10195f974b154e4e0d284313bef89beff1253dda42f1c5d9d2670a67`

## Reproducibility closure

The original preactivation receipt remains immutable evidence that all six gates were green before official generation. Because lifecycle fixes followed activation, the final source is separately bound by host-independent LF-normalized code manifest SHA-256 `8c8df79cf109f89f682b2fc68443ae8e50bb6d15796544cc6bde632bdca0d13e`.

`deterministic-replay-verification.json` records a verification-only render of the same ten frozen seeds. It explicitly declares `officialGeneration: false` and `officialAttemptWrites: false`. Each replay output was held in memory, compared against the official attempt by canonical spec bytes, raw PNG SHA-256, decoded PNG SHA-256, exact 21-node trace, identity transforms, resource IDs, and incubator identity, then discarded. The official attempt tree SHA-256 was `d0e12b75e05924fc4c4be8a4af45efc8aa710121bb63be969495c181a42a38ce` before and after.

The activation validator now rejects mutations to renderer build identity, assembly templates, assembly approvals, trait approvals, per-entry resource IDs, spec paths/hashes/content, PNG raw/decoded hashes, seed/version identity, 21-node order, identity transforms, and incubator projection.

## Verification

- Focused mutation/contract tests: 21 passed, exit 0.
- Final six-command verification: all six exits 0; receipt raw SHA-256 `5662059d35f96776092af99acada8c945bd45e07083b7d8099a5c40d3ff45a9a`.
- Postactivation verification: all four exits 0; receipt raw SHA-256 `ebd63d1ad05e5d6e545629fcfb7ae7e0555c65dcad712c9255f90d287eb22856`.
- Read-only active verification: exit 0; release, attempt, active pointer, and deterministic replay receipt identities matched.
- Historical v0.8 replay PNG: `9bc20b5a768a0968dcd1c9cb3dc840b2294b4c928527437ad48a3380ade9114a`.

Every postactivation command has an independent log path and log SHA-256 in `postactivation-verification.json` and `release-evidence.json`.

## Clean snapshot method

The final snapshot is audited from Git, not from a copied directory:

1. `git ls-files` enumerates the exact tracked closure.
2. `git cat-file --batch` reads committed/index blobs without worktree newline conversion.
3. `git check-attr text` proves the immutable candidate and by-SHA release JSON are not subject to `-text` rewriting, while hash-bound evidence remains `-text`.
4. `git diff --cached --binary` is hashed as the staged payload diff.
5. `git diff --check` verifies whitespace integrity.
6. `git status --short` and explicit path allowlists prove no polluted gate logs or approved master overlays are staged.

Machine-readable clean snapshot evidence is stored at `artifacts/acceptance/v0.9.0-feline/clean-snapshot-verification.json`. Its staged payload tree and diff intentionally exclude that receipt itself to avoid a self-hash cycle; the receipt states this explicitly.
