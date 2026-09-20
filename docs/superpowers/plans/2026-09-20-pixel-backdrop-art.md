# Irregular Pixel Backdrop Art Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate three deterministic 64×64 irregular doodle backdrops and a 21-sample review page without changing the production phenotype, catalog, coverage, or renderer.

**Architecture:** A small reusable art module owns deterministic raster generation and constraint analysis. A build entry point writes three PNG layers, while a separate QA entry point temporarily prepends each layer as the first `frame` operation to plans resolved from approved catalog 1.5.0. The temporary backdrop operation exists only in QA and does not alter production schemas.

**Tech Stack:** Node.js ESM, `sharp`, `esbuild`, `node:test`, approved pixel catalog v3, `pixel-rgba-v1` through `composePixelArt`.

**Spec:** `docs/superpowers/specs/2026-09-20-pixel-backdrop-art-design.md`

## Global Constraints

- Produce exactly three 64×64 PNG layers with binary alpha.
- Every layer has exactly one four-neighbor-connected opaque component.
- Every canvas edge keeps at least one transparent pixel; maximum opaque `y` is 59.
- Each layer contains 2,400–2,850 opaque pixels and keeps all four corners transparent.
- L base relative luminance is at least 0.55; every L decoration color is at least 0.35.
- Decorations recolor pixels inside the opaque base and never create detached alpha islands.
- The QA matrix contains 3 backdrops × 6 coats plus 3 full-stack samples, exactly 21 outputs.
- Production `approved-1.5.0`, phenotype types, profiles, coverage, renderer code, and `rendererVersion` remain byte-for-byte unchanged.
- Candidate art remains uncommitted until the user reviews the QA page; approval evidence and the art commit happen only after explicit acceptance.

## Review Focus

- A scanline reaching `x=0`, `x=63`, `y=0`, or `y=60+` must fail validation rather than produce a rim with a missing edge.
- A single detached opaque pixel must raise the connected-component count to two and fail validation.
- A dark L base or decoration color must fail with the measured relative luminance in the error.
- Recoloring decorative strokes must preserve the original alpha mask and opaque-pixel count exactly.
- The QA composer must put the backdrop before all catalog operations so every cat and part remains in front of it.

---

### Task 1: Deterministic raster module and constraint tests

**Files:**
- Create: `scripts/lib/pixel-backdrop-art.mjs`
- Create: `scripts/pixel-backdrop-art.test.mjs`

**Interfaces:**
- Produces: `BACKDROP_DEFINITIONS`, `renderBackdrop(definition): Uint8ClampedArray`, `analyzeBackdrop(pixels): BackdropStats`, `validateBackdrop(definition, pixels): BackdropStats`, and `relativeLuminance(hex): number`.
- `BackdropStats` is a plain object containing `bounds`, `opaquePixels`, `components`, `edgeClear`, `alphaValues`, `palette`, and `luminance`.

- [ ] **Step 1: Write constraint-focused tests**

Create `scripts/pixel-backdrop-art.test.mjs` with tests that exercise the five review risks rather than mirror drawing code:

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BACKDROP_DEFINITIONS,
  analyzeBackdrop,
  renderBackdrop,
  relativeLuminance,
  validateBackdrop,
} from './lib/pixel-backdrop-art.mjs'

const blank = () => new Uint8ClampedArray(64 * 64 * 4)
const put = (pixels, x, y, color = [255, 255, 255, 255]) => pixels.set(color, (y * 64 + x) * 4)

test('approved definitions satisfy every backdrop invariant', () => {
  assert.equal(BACKDROP_DEFINITIONS.length, 3)
  for (const definition of BACKDROP_DEFINITIONS) {
    const pixels = renderBackdrop(definition)
    const stats = validateBackdrop(definition, pixels)
    assert.equal(stats.components, 1)
    assert.ok(stats.opaquePixels >= 2400 && stats.opaquePixels <= 2850)
    assert.deepEqual(stats.alphaValues, [0, 255])
  }
})

test('edge contact and a detached island are rejected', () => {
  const edge = blank(); put(edge, 0, 20)
  assert.throws(() => validateBackdrop(BACKDROP_DEFINITIONS[0], edge), /edge|component|area/i)
  const pixels = renderBackdrop(BACKDROP_DEFINITIONS[0]); put(pixels, 62, 1)
  assert.equal(analyzeBackdrop(pixels).components, 2)
  assert.throws(() => validateBackdrop(BACKDROP_DEFINITIONS[0], pixels), /component/i)
})

test('legendary palette meets explicit luminance floors', () => {
  const legendary = BACKDROP_DEFINITIONS.find(item => item.rarity === 'L')
  assert.ok(relativeLuminance(legendary.base) >= 0.55)
  for (const color of legendary.decorations) assert.ok(relativeLuminance(color) >= 0.35)
})

test('decorations never alter the alpha mask', () => {
  for (const definition of BACKDROP_DEFINITIONS) {
    const pixels = renderBackdrop(definition)
    const stats = analyzeBackdrop(pixels)
    assert.equal(stats.opaquePixels, definition.expectedOpaquePixels)
    assert.equal(stats.components, 1)
  }
})
```

- [ ] **Step 2: Run the tests and confirm the module is missing**

Run:

```powershell
node --test scripts/pixel-backdrop-art.test.mjs
```

Expected: FAIL because `scripts/lib/pixel-backdrop-art.mjs` does not exist.

- [ ] **Step 3: Implement raster generation and analysis**

Create `scripts/lib/pixel-backdrop-art.mjs`. Use deterministic scanline bounds and recolor-only decoration helpers:

```js
import assert from 'node:assert/strict'

const SIZE = 64
const rgba = hex => {
  const value = Number.parseInt(hex.slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255, 255]
}

const shapes = {
  N: { top: 7, bottom: 59, center: 31, width: 24, leftWave: [0, 1, -1, 0], rightWave: [1, 0, -1, 1] },
  R: { top: 6, bottom: 59, center: 32, width: 24, leftWave: [1, -1, 0, -2], rightWave: [0, 2, -1, 0] },
  L: { top: 5, bottom: 59, center: 31, width: 25, leftWave: [-1, 1, -2, 0], rightWave: [2, 0, 1, -1] },
}

export const BACKDROP_DEFINITIONS = [
  { id: 'doodle-horizon', rarity: 'N', base: '#EEE7D7', decorations: ['#CBBFAE', '#E6B981'], shape: shapes.N },
  { id: 'doodle-leaf-shadow', rarity: 'R', base: '#CDE4CB', decorations: ['#91BA91', '#F4EEDC'], shape: shapes.R },
  { id: 'doodle-rainbow-trail', rarity: 'L', base: '#DCCFF1', decorations: ['#78CAD0', '#F0A66D', '#F4EBD0'], shape: shapes.L },
]

function scanline(shape, y) {
  const t = (y - shape.top) / (shape.bottom - shape.top)
  const bulge = Math.sin(Math.PI * t)
  const waveIndex = Math.floor((y - shape.top) / 4)
  const half = Math.round(9 + shape.width * bulge)
  const left = Math.max(1, shape.center - half + shape.leftWave[waveIndex % shape.leftWave.length])
  const right = Math.min(62, shape.center + half + shape.rightWave[waveIndex % shape.rightWave.length])
  return [left, right]
}

function paintInside(pixels, x, y, color) {
  if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return
  const offset = (y * SIZE + x) * 4
  if (pixels[offset + 3] === 255) pixels.set(color, offset)
}

function line(pixels, x0, y0, x1, y1, color, thickness = 1) {
  let dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1
  let dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1
  let error = dx + dy
  const radius = Math.floor(thickness / 2)
  while (true) {
    for (let oy = -radius; oy <= radius; oy++) for (let ox = -radius; ox <= radius; ox++) {
      paintInside(pixels, x0 + ox, y0 + oy, color)
    }
    if (x0 === x1 && y0 === y1) break
    const twice = 2 * error
    if (twice >= dy) { error += dy; x0 += sx }
    if (twice <= dx) { error += dx; y0 += sy }
  }
}

function decorate(definition, pixels) {
  const colors = definition.decorations.map(rgba)
  if (definition.rarity === 'N') {
    line(pixels, 14, 46, 27, 42, colors[0], 2)
    line(pixels, 35, 50, 49, 47, colors[1], 1)
  } else if (definition.rarity === 'R') {
    for (const [x, y, lean] of [[16, 48, -5], [32, 44, 4], [47, 49, -4]]) {
      line(pixels, x, y, x + lean, y - 15, colors[0], 2)
      line(pixels, x + Math.round(lean * 0.35), y - 6, x - 5, y - 10, colors[1], 2)
      line(pixels, x + Math.round(lean * 0.65), y - 10, x + 5, y - 14, colors[1], 2)
    }
  } else {
    for (let x = 10; x <= 53; x++) {
      const t = (x - 10) / 43
      paintInside(pixels, x, Math.round(43 - 22 * Math.sin(Math.PI * t)), colors[0])
      paintInside(pixels, x, Math.round(47 - 19 * Math.sin(Math.PI * t)), colors[1])
    }
    line(pixels, 15, 49, 48, 31, colors[2], 1)
    for (const [x, y] of [[22, 45], [31, 40], [40, 35]]) {
      paintInside(pixels, x - 1, y, colors[2]); paintInside(pixels, x + 1, y, colors[2])
      paintInside(pixels, x, y - 1, colors[2]); paintInside(pixels, x, y + 1, colors[2])
    }
  }
}

export function renderBackdrop(definition) {
  const pixels = new Uint8ClampedArray(SIZE * SIZE * 4)
  const base = rgba(definition.base)
  for (let y = definition.shape.top; y <= definition.shape.bottom; y++) {
    const [left, right] = scanline(definition.shape, y)
    for (let x = left; x <= right; x++) pixels.set(base, (y * SIZE + x) * 4)
  }
  decorate(definition, pixels)
  return pixels
}

export function relativeLuminance(hex) {
  const channels = rgba(hex).slice(0, 3).map(value => {
    const channel = value / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

export function analyzeBackdrop(pixels) {
  assert.equal(pixels.length, SIZE * SIZE * 4)
  const opaque = new Set(), alphaValues = new Set(), palette = new Set()
  let left = SIZE, top = SIZE, right = -1, bottom = -1
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const offset = (y * SIZE + x) * 4, alpha = pixels[offset + 3]
    alphaValues.add(alpha)
    if (!alpha) continue
    opaque.add(y * SIZE + x)
    palette.add(`#${[pixels[offset], pixels[offset + 1], pixels[offset + 2]].map(value => value.toString(16).padStart(2, '0')).join('')}`)
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y)
  }
  let components = 0
  const unseen = new Set(opaque)
  while (unseen.size) {
    components++
    const queue = [unseen.values().next().value]
    unseen.delete(queue[0])
    while (queue.length) {
      const value = queue.pop(), x = value % SIZE, y = Math.floor(value / SIZE)
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const next = (y + dy) * SIZE + x + dx
        if (x + dx < 0 || x + dx >= SIZE || y + dy < 0 || y + dy >= SIZE || !unseen.has(next)) continue
        unseen.delete(next); queue.push(next)
      }
    }
  }
  return {
    bounds: { left, top, right, bottom }, opaquePixels: opaque.size, components,
    edgeClear: left >= 1 && top >= 1 && right <= 62 && bottom <= 59,
    alphaValues: [...alphaValues].sort((a, b) => a - b), palette: [...palette].sort(),
  }
}

export function validateBackdrop(definition, pixels) {
  const stats = analyzeBackdrop(pixels)
  assert.deepEqual(stats.alphaValues, [0, 255], `${definition.id}: alpha must be binary`)
  assert.equal(stats.components, 1, `${definition.id}: expected one component`)
  assert.ok(stats.edgeClear, `${definition.id}: opaque pixels touch a forbidden edge`)
  assert.ok(stats.opaquePixels >= 2400 && stats.opaquePixels <= 2850, `${definition.id}: area ${stats.opaquePixels}`)
  if (definition.rarity === 'L') {
    assert.ok(relativeLuminance(definition.base) >= 0.55, `${definition.id}: dark base`)
    for (const color of definition.decorations) assert.ok(relativeLuminance(color) >= 0.35, `${definition.id}: dark decoration ${color}`)
  }
  return { ...stats, luminance: { base: relativeLuminance(definition.base), decorations: definition.decorations.map(relativeLuminance) } }
}
```

After the first successful render, add each definition’s measured `expectedOpaquePixels` and assert exact equality in `validateBackdrop`; this freezes the alpha silhouette so later palette edits cannot silently change geometry.

- [ ] **Step 4: Run the constraint tests**

Run:

```powershell
node --test scripts/pixel-backdrop-art.test.mjs
```

Expected: 4 tests PASS. If the scanline formula misses the 2,400–2,850 area, adjust only the shape `width` and `top` constants; do not relax the range.

- [ ] **Step 5: Review the task diff**

Run:

```powershell
git diff --check
git diff -- scripts/lib/pixel-backdrop-art.mjs scripts/pixel-backdrop-art.test.mjs
```

Expected: no whitespace errors; exports and test names exactly match the Interfaces block.

---

### Task 2: PNG build entry point and candidate layers

**Files:**
- Create: `scripts/build-pixel-backdrop-art.mjs`
- Create: `docs/qa/pixel-backdrop-batch/layers/doodle-horizon.png`
- Create: `docs/qa/pixel-backdrop-batch/layers/doodle-leaf-shadow.png`
- Create: `docs/qa/pixel-backdrop-batch/layers/doodle-rainbow-trail.png`

**Interfaces:**
- Consumes: `BACKDROP_DEFINITIONS`, `renderBackdrop`, and `validateBackdrop` from Task 1.
- Produces: three deterministic palette PNGs at the exact paths above.

- [ ] **Step 1: Add the build entry point**

Create `scripts/build-pixel-backdrop-art.mjs`:

```js
import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { BACKDROP_DEFINITIONS, renderBackdrop, validateBackdrop } from './lib/pixel-backdrop-art.mjs'

const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'docs/qa/pixel-backdrop-batch/layers')
await fs.rm(output, { recursive: true, force: true })
await fs.mkdir(output, { recursive: true })

for (const definition of BACKDROP_DEFINITIONS) {
  const pixels = renderBackdrop(definition)
  validateBackdrop(definition, pixels)
  await sharp(Buffer.from(pixels), { raw: { width: 64, height: 64, channels: 4 } })
    .png({ palette: true, colours: 16, dither: 0 })
    .toFile(path.join(output, `${definition.id}.png`))
}

console.log(`Built ${BACKDROP_DEFINITIONS.length} pixel backdrops in docs/qa/pixel-backdrop-batch/layers`)
```

- [ ] **Step 2: Generate and inspect the three layers**

Run:

```powershell
node scripts/build-pixel-backdrop-art.mjs
```

Expected: exactly three PNG files and `Built 3 pixel backdrops...`.

Open a nearest-neighbor contact sheet or inspect all three with `view_image`. Confirm that N reads as a restrained horizon, R as leaf shadow, and L as a bright multicolor rainbow trail. Adjust only definition constants and decoration coordinates, then rerun Task 1 tests.

- [ ] **Step 3: Verify deterministic PNG bytes**

Run the builder twice and compare SHA-256 values:

```powershell
$backdropFiles = Get-ChildItem docs/qa/pixel-backdrop-batch/layers -File | Sort-Object Name
$first = @{}; foreach ($file in $backdropFiles) { $first[$file.Name] = (Get-FileHash -Algorithm SHA256 -LiteralPath $file.FullName).Hash }
node scripts/build-pixel-backdrop-art.mjs
foreach ($file in $backdropFiles) { if ($first[$file.Name] -ne (Get-FileHash -Algorithm SHA256 -LiteralPath $file.FullName).Hash) { throw "Non-deterministic backdrop: $($file.Name)" } }
```

Expected: no exception.

---

### Task 3: Approved-catalog QA composer and 21-sample report

**Files:**
- Create: `scripts/review-pixel-backdrop-art.mjs`
- Create: `docs/qa/pixel-backdrop-batch/index.html`
- Create: `docs/qa/pixel-backdrop-batch/report.json`
- Create: `docs/qa/pixel-backdrop-batch/samples/01.png` through `21.png`

**Interfaces:**
- Consumes: the three PNGs from Task 2 and `packages/asset-catalog/pixel/v3/approved-1.5.0/catalog.approved.json`.
- Produces: `composeWithBackdrop(phenotype, backdropId): Uint8ClampedArray`, 21 deterministic PNGs, and a machine-readable report.

- [ ] **Step 1: Build the review script around the existing SDK**

Create `scripts/review-pixel-backdrop-art.mjs`. Bundle the v3 SDK with `esbuild`, validate the catalog, and keep the temporary operation ordering explicit:

```js
const catalogPath = 'packages/asset-catalog/pixel/v3/approved-1.5.0/catalog.approved.json'
const coats = ['orange-white', 'brown-tabby', 'tuxedo', 'calico', 'colorpoint', 'rosetted']
const backdrops = BACKDROP_DEFINITIONS.map(item => item.id)

function planFor(phenotype) {
  const profile = catalog.profiles.find(item =>
    item.body === phenotype.body && item.coat === phenotype.coat &&
    item.eyes === phenotype.eyes && item.expression === phenotype.expression)
  assert.ok(profile, `Missing profile: ${JSON.stringify(phenotype)}`)
  const operations = []
  for (const step of profile.steps) {
    const selected = step.slot === 'body' ? phenotype.expression : phenotype[step.slot]
    if (selected === 'none') continue
    const rendering = step.variants?.[selected] ?? step
    const resourceId = step.resources[selected]
    assert.ok(resourceId, `Missing ${step.slot}/${selected} in ${profile.id}`)
    if (rendering.clear.length) operations.push({ kind: 'clear', polygons: rendering.clear })
    operations.push({ kind: 'draw', resource: resourceId, target: rendering.target, occlusion: rendering.occlusion })
  }
  return { size: 64, key: JSON.stringify(phenotype), operations, resources: {} }
}

function composeWithBackdrop(phenotype, backdropId) {
  const plan = planFor(phenotype)
  plan.operations.unshift({
    kind: 'draw', resource: `candidate-${backdropId}`,
    target: 'frame', occlusion: [],
  })
  assert.equal(plan.operations[0].resource, `candidate-${backdropId}`)
  return composePixelArt(plan, layers)
}
```

Load every approved resource by catalog SHA-256 and each candidate backdrop by its actual PNG SHA-256. The first 18 rows iterate backdrop-major then coat-major with this fixed phenotype:

```js
{
  body: 'standard', eyes: 'round', expression: 'parted-mouth',
  crown: 'none', ears: 'none', neck: 'none', back: 'none', tailTip: 'none',
  coat,
}
```

The final three rows use `orange-white / standard / round / parted-mouth` with `halo`, `frill-neck`, `feathered-wings`, and `flame-tail`; keep `ears: 'none'` so the test emphasizes background overflow rather than a coat-bound ear resource.

- [ ] **Step 2: Add assertions and report fields**

For every sample, compose twice from separately cloned phenotype/plan input and require equal bytes. Record:

```js
{
  label,
  backdropId,
  phenotype,
  profileId,
  file,
  pngSha256,
  rgbaSha256,
}
```

Write `report.json` with:

```js
{
  schemaVersion: 'pixel-backdrop-review-v1',
  status: 'engineering-passed-art-review-pending',
  baseCatalog: catalogPath,
  rendererVersion: catalog.rendererVersion,
  productionSchemaChanged: false,
  candidates: candidateStats,
  sampling: { total: 21, coatMatrix: 18, fullStack: 3, rows: samples },
}
```

Assert `samples.length === 21`, all six coat IDs occur once per backdrop, all three backdrop IDs occur in full-stack rows, and every backdrop draw is operation index zero.

- [ ] **Step 3: Generate the page and samples**

Run:

```powershell
node scripts/review-pixel-backdrop-art.mjs
```

Expected: `QA: wrote 21 samples to docs/qa/pixel-backdrop-batch/index.html`.

The HTML must group cards into N, R, L coat sections plus a full-stack section. Each card shows a 192px nearest-neighbor preview and a native 64px image. Include a deep/light page-background toggle and state clearly that the candidates are not registered in a production catalog.

- [ ] **Step 4: Inspect the complete QA output**

Open `docs/qa/pixel-backdrop-batch/index.html` in the in-app browser. Check:

- tuxedo remains readable on all three backgrounds;
- rosetted markings do not merge with R leaf shadows;
- L cyan/orange/cream details remain visible without becoming a dark night scene;
- each full-stack cat and every overflowing part remains above the background rim;
- no background reads as a square card.

If visual tuning changes any definition, rerun Task 1 tests, Task 2 build, and Task 3 review in that order.

---

### Task 4: Documentation and final candidate verification

**Files:**
- Modify: `docs/art/pixel-backdrop-batch/README.md`
- Create: `docs/qa/pixel-backdrop-batch/README.md`

**Interfaces:**
- Consumes: the final layers and report from Tasks 2–3.
- Produces: review instructions and a clear `art-review-pending` boundary for the user.

- [ ] **Step 1: Update candidate status documentation**

At the top of `docs/art/pixel-backdrop-batch/README.md`, add:

```markdown
> 状态：三档候选美术已生成，等待用户验收；尚未新增 backdrop 性状或登记正式像素包。
```

Create `docs/qa/pixel-backdrop-batch/README.md` documenting the three IDs, 21-row matrix, automatic constraints, base catalog 1.5.0, and the boundary that QA prepends a temporary frame operation without changing production schema.

- [ ] **Step 2: Run the complete verification set**

Run:

```powershell
node --test scripts/pixel-backdrop-art.test.mjs
node scripts/build-pixel-backdrop-art.mjs
node scripts/review-pixel-backdrop-art.mjs
npm run typecheck
git diff --check
```

Expected: all backdrop tests pass, builders report 3 layers and 21 samples, typecheck exits zero, and diff check is silent.

- [ ] **Step 3: Verify full-output determinism**

Hash all files under `docs/qa/pixel-backdrop-batch/layers` and `samples`, plus `report.json` and `index.html`; rerun the two scripts; require every hash to remain equal. This includes dynamic HTML cache-buster hashes, so any order instability is caught.

- [ ] **Step 4: Present the candidate for art review**

Open the QA page in the browser and report the constraint measurements and verification results. Leave the candidate files uncommitted while awaiting the user’s visual decision. Do not create `approval.json`, modify the exchange file, register a catalog, or push until the user approves the art.

---

### Task 5: Approval evidence after explicit user acceptance

**Files:**
- Create after approval: `docs/qa/pixel-backdrop-batch/approval.json`
- Modify after approval: `docs/art/pixel-backdrop-batch/README.md`
- Modify after approval: `docs/qa/pixel-backdrop-batch/README.md`
- Modify after approval: `docs/qa/pixel-backdrop-batch/report.json`
- Modify after approval: `scripts/review-pixel-backdrop-art.mjs`
- Modify after approval: `docs/integration/nutri-codex-exchange.md`

**Interfaces:**
- Consumes: the user’s exact acceptance text and all final candidate hashes.
- Produces: immutable art approval evidence with state `art-approved-registration-pending`.

- [ ] **Step 1: Change generated status at its source**

Change the review script’s report status from `engineering-passed-art-review-pending` to `art-approved-registration-pending`, rerun it, and update both READMEs with the approval date and exact user response.

- [ ] **Step 2: Generate and verify approval evidence**

Write `approval.json` with this exact top-level shape, filling arrays directly from the validated report and re-reading every referenced file before writing:

```js
{
  schemaVersion: 'pixel-backdrop-approval-v1',
  approvedAt: approvalDate,
  decision: userDecision,
  scope: report.candidates.map(candidate => ({
    id: candidate.id,
    rarity: candidate.rarity,
    file: candidate.file,
    sha256: candidate.sha256,
    stats: candidate.stats,
  })),
  evidence: {
    reviewPage: 'docs/qa/pixel-backdrop-batch/index.html',
    report: 'docs/qa/pixel-backdrop-batch/report.json',
    samples: report.sampling.rows,
  },
  baseCatalog: report.baseCatalog,
  rendererVersion: report.rendererVersion,
  productionSchemaChanged: false,
  state: 'art-approved-registration-pending',
  runtime: 'unchanged',
}
```

Set `approvalDate` from the approval turn’s local date and `userDecision` to the user’s exact acceptance text. Recompute and compare every source, layer, page, report, and sample SHA-256 before accepting the evidence.

- [ ] **Step 3: Update the Claude exchange entry**

Append a Codex → Claude entry stating that three backdrop images are art-approved but schema/catalog registration remains pending. Include the approval SHA-256 and the exact luminance/connectivity/edge constraints.

- [ ] **Step 4: Commit and synchronize according to the existing authorization**

Run final tests and deterministic rebuild, fetch `origin/master`, preserve any remote update, commit the approved art batch, and push the exchange update under the user’s standing authorization for that communication file.
